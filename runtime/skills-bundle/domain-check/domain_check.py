#!/usr/bin/env python3
"""Open Science — domain-correctness gates (P0-5).

A deterministic, pluggable validator layer: one rule set per scientific field
that intercepts that field's classic error classes — code that *runs* but is
scientifically *wrong*. Findings are structured and dismissible; this NEVER
promises correctness, only flags known-dangerous patterns for a human.

Stdlib only (ast, re, json). It analyses the code the agent generated — it does
not trust model recall. Add a discipline by writing a `check_<field>(ctx)`
function and appending it to VALIDATORS; no other change is needed.

Usage:
    python domain_check.py file1.py notebook.ipynb analysis.R ...
    python domain_check.py            # scan code files under the cwd

Output: one ```review fenced JSON block on stdout (the app's reviewer contract).
"""
from __future__ import annotations

import ast
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------- #
# Findings + file context
# --------------------------------------------------------------------------- #


@dataclass
class Finding:
    level: str  # "warn" | "error" | "ok"
    tag: str  # discipline · rule, e.g. "physics · units"
    title: str
    evidence: str


@dataclass
class Ctx:
    """One code file, parsed once and shared across every validator."""

    path: str
    src: str
    lang: str  # "python" | "r"
    tree: ast.AST | None = None  # populated for python
    lines: list[str] = field(default_factory=list)

    def line_of(self, node: ast.AST) -> int:
        return getattr(node, "lineno", 0)

    def snippet(self, lineno: int) -> str:
        if 1 <= lineno <= len(self.lines):
            return f"{self.path}:{lineno}  {self.lines[lineno - 1].strip()}"
        return f"{self.path}:{lineno}"


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #


def _suffix(name: str) -> str:
    """Last underscore-delimited token, lowercased: `t_secs` -> `secs`."""
    return name.rsplit("_", 1)[-1].lower() if name else ""


def _names_in(node: ast.AST) -> list[str]:
    """Every identifier referenced under `node` (Name ids + attribute tails)."""
    out: list[str] = []
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            out.append(n.id)
        elif isinstance(n, ast.Attribute):
            out.append(n.attr)
    return out


def _call_name(node: ast.Call) -> str:
    """`np.hypot(...)` -> `hypot`; `sqrt(...)` -> `sqrt`."""
    f = node.func
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return ""


# --------------------------------------------------------------------------- #
# Physics — units & dimensional consistency
# --------------------------------------------------------------------------- #

# A curated unit taxonomy. Suffix token -> dimension family. Kept to units that
# are unambiguous as a *trailing* name token in scientific code.
_UNIT_FAMILY: dict[str, str] = {}


def _reg(family: str, *units: str) -> None:
    for u in units:
        _UNIT_FAMILY[u] = family


_reg("length", "m", "meter", "meters", "metre", "metres", "km", "cm", "mm",
     "um", "nm", "mi", "mile", "miles", "ft", "feet", "yd", "au", "pc",
     "kpc", "mpc", "ly", "angstrom", "angstroms")
_reg("time", "s", "sec", "secs", "second", "seconds", "ms", "msec", "us",
     "ns", "min", "mins", "minute", "minutes", "hr", "hrs", "hour", "hours",
     "day", "days", "yr", "yrs", "year", "years", "gyr", "myr")
_reg("mass", "kg", "kgs", "gram", "grams", "mg", "ug", "lb", "lbs", "tonne",
     "tonnes", "amu", "msun", "solarmass")
_reg("angle", "deg", "degree", "degrees", "rad", "radian", "radians",
     "arcsec", "arcmin", "mas")
_reg("temperature", "kelvin", "celsius", "fahrenheit", "degc", "degk")
_reg("energy", "ev", "kev", "mev", "joule", "joules")
_reg("pressure", "pa", "kpa", "mpa", "gpa", "bar", "kbar")
_reg("amount", "mol", "mole", "moles")
_reg("frequency", "hz", "khz", "mhz", "ghz")

_TRIG = {"sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan",
         "sinh", "cosh", "tanh"}


def _unit_family(name: str) -> str | None:
    return _UNIT_FAMILY.get(_suffix(name))


def check_physics(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    if ctx.tree is None:
        return _physics_regex(ctx)

    for node in ast.walk(ctx.tree):
        # (1) Add / subtract / compare across dimension families.
        pairs: list[tuple[ast.AST, ast.AST]] = []
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)):
            pairs.append((node.left, node.right))
        elif isinstance(node, ast.Compare) and len(node.comparators) == 1:
            pairs.append((node.left, node.comparators[0]))
        for left, right in pairs:
            lf = _operand_family(left)
            rf = _operand_family(right)
            if lf and rf and lf != rf:
                op = "compare" if isinstance(node, ast.Compare) else "add/subtract"
                out.append(Finding(
                    "error", "physics · units",
                    f"Dimensional mismatch: {op} of {lf} and {rf}",
                    ctx.snippet(ctx.line_of(node))
                    + f"\n  left is a {lf} quantity, right is a {rf} quantity — "
                    "the result has no consistent unit.",
                ))

        # (2) Trig on a degree-named quantity (trig expects radians).
        if isinstance(node, ast.Call) and _call_name(node) in _TRIG:
            for arg in node.args:
                fam = _operand_family(arg)
                if fam == "angle" and _degree_named(arg):
                    out.append(Finding(
                        "error", "physics · units",
                        f"{_call_name(node)}() called on a degree-valued angle",
                        ctx.snippet(ctx.line_of(node))
                        + "\n  trig functions expect radians — convert with "
                        "np.radians()/math.radians() first.",
                    ))
    return out


def _operand_family(node: ast.AST) -> str | None:
    """The dimension family of a leaf operand (a bare Name/Attribute)."""
    if isinstance(node, ast.Name):
        return _material_unit_family(node.id) or _unit_family(node.id)
    if isinstance(node, ast.Attribute):
        return _material_unit_family(node.attr) or _unit_family(node.attr)
    return None


def _material_unit_family(name: str) -> str | None:
    """Recognize compound material quantities such as ``e_above_hull_ev_atom``."""
    n = name.lower()
    if re.search(r"(?:^|_)(?:ev|kev|mev)(?:_?per_?atom|_atom)(?:$|_)", n):
        return "energy_per_atom"
    if re.search(r"(?:^|_)(?:band_?gap|formation_?energy|energy_?above_?hull)(?:$|_)", n):
        return "energy"
    if re.search(r"(?:^|_)(?:encut|cutoff|pressure|stress|gpa|kbar)(?:$|_)", n):
        return "pressure" if "pressure" in n or "stress" in n or "gpa" in n or "kbar" in n else "energy"
    if re.search(r"(?:^|_)(?:lattice|distance|min_?distance|volume)(?:$|_)", n):
        return "length" if "volume" not in n else "volume"
    if re.search(r"(?:^|_)(?:temperature|temp|efermi|fermi)(?:$|_)", n):
        return "temperature" if "temp" in n else "energy"
    return None


def _degree_named(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return _suffix(node.id) in {"deg", "degree", "degrees"}
    if isinstance(node, ast.Attribute):
        return _suffix(node.attr) in {"deg", "degree", "degrees"}
    return False


def _physics_regex(ctx: Ctx) -> list[Finding]:
    """R fallback: catch trig on degree-named angles by pattern."""
    out: list[Finding] = []
    for m in re.finditer(r"\b(sin|cos|tan)\s*\(\s*([A-Za-z_.][\w.]*)\s*\)", ctx.src):
        if _suffix(m.group(2)) in {"deg", "degree", "degrees"}:
            ln = ctx.src[: m.start()].count("\n") + 1
            out.append(Finding(
                "error", "physics · units",
                f"{m.group(1)}() called on a degree-valued angle",
                ctx.snippet(ln) + "\n  trig expects radians.",
            ))
    return out


# --------------------------------------------------------------------------- #
# Earth / geo — CRS & coordinate awareness
# --------------------------------------------------------------------------- #

_DIST_FUNCS = {"sqrt", "hypot", "dist", "euclidean", "norm", "pdist", "cdist"}


def _is_lat(name: str) -> bool:
    return name.lower().startswith("lat")


def _is_lon(name: str) -> bool:
    n = name.lower()
    return n.startswith("lon") or n.startswith("lng")


def _refs_latlon(node: ast.AST) -> bool:
    names = _names_in(node)
    return any(_is_lat(n) for n in names) and any(_is_lon(n) for n in names)


def check_earth(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    if ctx.tree is None:
        return out

    for node in ast.walk(ctx.tree):
        # (1) Euclidean distance on geographic coordinates.
        if isinstance(node, ast.Call) and _call_name(node) in _DIST_FUNCS:
            if any(_refs_latlon(a) for a in node.args) or _refs_latlon(node):
                out.append(_crs_finding(ctx, node))
        # (1b) The classic (lat1-lat2)**2 + (lon1-lon2)**2 form.
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            if _is_sq_diff(node.left) and _is_sq_diff(node.right):
                if _refs_latlon(node):
                    out.append(_crs_finding(ctx, node))

    # (2) A geopandas geometric op with no CRS ever set in the file.
    src = ctx.src
    if re.search(r"\b(geopandas|gpd|GeoDataFrame|GeoSeries)\b", src):
        geo_op = re.search(r"\.(distance|area|buffer|length|centroid)\b", src)
        if geo_op and not re.search(r"\b(to_crs|set_crs|crs\s*=)", src):
            ln = src[: geo_op.start()].count("\n") + 1
            out.append(Finding(
                "warn", "earth · crs",
                "Geometric operation without a set CRS",
                ctx.snippet(ln)
                + "\n  .distance/.area/.buffer on a GeoDataFrame with no "
                "to_crs()/set_crs() — degrees are not meters; set a projected CRS.",
            ))
    return out


def _crs_finding(ctx: Ctx, node: ast.AST) -> Finding:
    return Finding(
        "error", "earth · crs",
        "Euclidean distance on latitude/longitude",
        ctx.snippet(ctx.line_of(node))
        + "\n  lat/lon are angles on a sphere, not planar coordinates — "
        "Euclidean/Pythagorean distance is wrong. Use the haversine formula "
        "or a geodesic (e.g. project to a metric CRS, or geopy.distance).",
    )


def _is_sq_diff(node: ast.AST) -> bool:
    """Matches (a - b) ** 2."""
    return (
        isinstance(node, ast.BinOp)
        and isinstance(node.op, ast.Pow)
        and isinstance(node.right, ast.Constant)
        and node.right.value == 2
        and isinstance(node.left, ast.BinOp)
        and isinstance(node.left.op, ast.Sub)
    )


# --------------------------------------------------------------------------- #
# Biology — 0/1-based coordinates & strand
# --------------------------------------------------------------------------- #

_BED_LEN = re.compile(
    r"(\w*(?:end|stop)\w*)\s*-\s*(\w*start\w*)\s*\+\s*1", re.IGNORECASE
)


def _has_name_like(node: ast.AST, *needles: str) -> bool:
    return any(any(nd in n.lower() for nd in needles) for n in _names_in(node))


def _is_bed_off_by_one(node: ast.AST) -> bool:
    """Matches `(<end> - <start>) + 1` regardless of int()/call wrapping."""
    if not (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add)):
        return False
    if not (isinstance(node.right, ast.Constant) and node.right.value == 1):
        return False
    sub = node.left
    if not (isinstance(sub, ast.BinOp) and isinstance(sub.op, ast.Sub)):
        return False
    return _has_name_like(sub.left, "end", "stop") and _has_name_like(sub.right, "start")
_STRANDED_FMT = re.compile(r"\.(bed|gff3?|gtf)\b", re.IGNORECASE)
_SEQ_SLICE = re.compile(
    r"(?:\.seq|sequence|fasta|record|genome|ref)\b[^\n]*\[[^\]]*:", re.IGNORECASE
)
_STRAND_HANDLED = re.compile(
    r"reverse_complement|revcomp|complement\(|\[::-1\]|strand\s*==\s*['\"]-['\"]",
    re.IGNORECASE,
)


def check_biology(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    src = ctx.src
    bed_ctx = bool(re.search(r"\.bed\b", src, re.IGNORECASE)) or "bedtool" in src.lower()

    # (1) BED length off-by-one: BED is 0-based half-open, so length = end - start
    #     (no +1). `end - start + 1` is a 1-based-inclusive formula misapplied.
    if bed_ctx:
        # AST first (handles int(end) - int(start) + 1 and other wrapping)...
        if ctx.tree is not None:
            for node in ast.walk(ctx.tree):
                if _is_bed_off_by_one(node):
                    out.append(Finding(
                        "error", "biology · coords",
                        "Off-by-one on BED coordinates (0-based half-open)",
                        ctx.snippet(ctx.line_of(node))
                        + "\n  adds 1 to a BED interval. BED is 0-based, "
                        "half-open: length is end - start, with no +1.",
                    ))
        else:  # R fallback: regex on the raw source.
            for m in _BED_LEN.finditer(src):
                ln = src[: m.start()].count("\n") + 1
                out.append(Finding(
                    "error", "biology · coords",
                    "Off-by-one on BED coordinates (0-based half-open)",
                    ctx.snippet(ln)
                    + f"\n  `{m.group(0).strip()}` adds 1 to a BED interval. BED "
                    "is 0-based, half-open: length is end - start, with no +1.",
                ))

    # (2) Sequence extracted from a stranded feature file without honoring strand.
    seq = _SEQ_SLICE.search(src)
    if _STRANDED_FMT.search(src) and seq and not _STRAND_HANDLED.search(src):
        ln = src[: seq.start()].count("\n") + 1
        out.append(Finding(
            "warn", "biology · strand",
            "Sequence extracted without honoring strand",
            ctx.snippet(ln)
            + "\n  features on the '-' strand must be reverse-complemented; no "
            "reverse_complement / strand check found in this file.",
        ))
    return out


# --------------------------------------------------------------------------- #
# Chemistry — molecular validity (valence)
# --------------------------------------------------------------------------- #

# Max bonds an uncharged organic-subset atom can form. Only elements whose
# valence is unambiguous are listed — carbon (never 5-bonded) and the
# monovalent halogens are the high-precision cases the acceptance names.
_MAX_VALENCE = {"C": 4, "F": 1, "Cl": 1, "Br": 1, "I": 1}
# Variable names / call names that mark a string literal as a molecule SMILES.
_SMILES_VARS = re.compile(r"(?:^|_)(smiles?|smi|mol)$", re.IGNORECASE)
_SMILES_FUNCS = {"MolFromSmiles", "MolFromSmarts", "smiles_to_mol", "read_smiles"}


def _smiles_over_valence(smi: str) -> str | None:
    """If some organic-subset atom in `smi` exceeds its valence by EXPLICIT
    bonds, return "<Element> has N bonds"; else None. Returns None (bail) on any
    SMILES feature we do not model — bracket atoms, unknown tokens — so we never
    guess. Counts explicit bond orders only, so implicit-H atoms are safe."""
    atoms: list[str] = []          # element per atom index
    order: list[float] = []        # summed explicit bond order per atom
    prev: int | None = None        # previous chain atom
    pending: float | None = None   # explicit bond order awaiting the next atom
    stack: list[int | None] = []   # branch return points
    ring: dict[str, tuple[int, float]] = {}
    bond_val = {"-": 1.0, "=": 2.0, "#": 3.0, ":": 1.5, "/": 1.0, "\\": 1.0}
    i, n = 0, len(smi)
    if not smi:
        return None
    while i < n:
        ch = smi[i]
        if ch == "[":
            return None  # bracket atom — its valence/charge/H is explicit; bail
        if ch in bond_val:
            pending = bond_val[ch]
            i += 1
            continue
        if ch == "(":
            stack.append(prev)
            i += 1
            continue
        if ch == ")":
            if not stack:
                return None
            prev = stack.pop()
            i += 1
            continue
        if ch == ".":
            prev, pending = None, None
            i += 1
            continue
        if ch.isdigit() or ch == "%":
            if ch == "%":
                label, i = smi[i + 1 : i + 3], i + 3
            else:
                label, i = ch, i + 1
            if prev is None:
                return None
            o = pending or 1.0
            if label in ring:
                a0, o0 = ring.pop(label)
                b = max(o, o0)
                order[a0] += b
                order[prev] += b
            else:
                ring[label] = (prev, o)
            pending = None
            continue
        # atom
        two = smi[i : i + 2]
        if two in ("Cl", "Br"):
            elem, i = two, i + 2
        elif ch in "BCNOPSFI" or ch in "bcnops":
            elem, i = ch.upper(), i + 1
        else:
            return None  # unmodeled token — bail rather than misparse
        idx = len(atoms)
        atoms.append(elem)
        order.append(0.0)
        if prev is not None:
            o = pending or 1.0
            order[prev] += o
            order[idx] += o
        pending = None
        prev = idx
    if stack or ring:
        return None  # unbalanced branches / open ring bonds — malformed, bail
    for elem, tot in zip(atoms, order):
        cap = _MAX_VALENCE.get(elem)
        if cap is not None and tot > cap:
            # Round so an aromatic 1.5 pair reads as an integer count.
            return f"{elem} has {int(round(tot))} bonds (max {cap})"
    return None


def _chem_finding(ctx: Ctx, lineno: int, smi: str, detail: str) -> Finding:
    return Finding(
        "error", "chem · valence",
        "Invalid molecule: impossible valence in SMILES",
        ctx.snippet(lineno)
        + f'\n  "{smi}" — {detail}. This SMILES cannot be a real molecule; '
        "validate with RDKit (Chem.MolFromSmiles returns None) instead of "
        "emitting a structure from memory.",
    )


def _rdkit_verdict(smi: str) -> str | None:
    """Authoritative molecule validity via RDKit when it is installed:
    "valid" | "invalid" | None (RDKit not importable → caller falls back to the
    static bond-counter). RDKit sanitizes the parse, so it catches far more than
    a five-bond carbon — bad ring closures, impossible aromaticity, and
    over-valent N/O/S — and, being authoritative, also clears molecules the
    static heuristic would wrongly flag."""
    try:
        from rdkit import Chem  # type: ignore
        from rdkit import RDLogger  # type: ignore
    except ImportError:
        return None
    RDLogger.DisableLog("rdApp.*")  # RDKit logs rejections to stderr; keep quiet
    try:
        mol = Chem.MolFromSmiles(smi)  # sanitizes; returns None on any invalidity
    except Exception:
        return "invalid"
    return "valid" if mol is not None else "invalid"


def _molecule_finding(ctx: Ctx, lineno: int, smi: str) -> Finding | None:
    """Judge one SMILES literal: prefer RDKit (authoritative — catches more and
    suppresses static false positives); fall back to the static bond-counter
    when RDKit is unavailable."""
    verdict = _rdkit_verdict(smi)
    if verdict == "invalid":
        return _chem_finding(ctx, lineno, smi, "RDKit rejects this structure")
    if verdict == "valid":
        return None  # authoritative: no finding, even if the heuristic would flag
    detail = _smiles_over_valence(smi)  # RDKit absent → static check decides
    return _chem_finding(ctx, lineno, smi, detail) if detail else None


def check_chemistry(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    if ctx.tree is not None:
        for node in ast.walk(ctx.tree):
            # (a) smiles = "..."  /  smi = "..."
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) \
                    and isinstance(node.value.value, str):
                named = any(
                    isinstance(t, ast.Name) and _SMILES_VARS.search(t.id)
                    for t in node.targets
                )
                if named:
                    f = _molecule_finding(ctx, ctx.line_of(node), node.value.value)
                    if f:
                        out.append(f)
            # (b) Chem.MolFromSmiles("...") and friends
            if isinstance(node, ast.Call) and _call_name(node) in _SMILES_FUNCS:
                for arg in node.args:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        f = _molecule_finding(ctx, ctx.line_of(node), arg.value)
                        if f:
                            out.append(f)
        return out

    # R / non-python fallback: SMILES assigned or passed by string literal.
    for m in re.finditer(
        r"""(?:smiles?|smi|mol)\s*(?:<-|=)\s*["']([^"']+)["']"""
        r"""|(?:MolFromSmiles|MolFromSmarts|smiles_to_mol)\s*\(\s*["']([^"']+)["']""",
        ctx.src, re.IGNORECASE,
    ):
        smi = m.group(1) or m.group(2)
        f = _molecule_finding(ctx, ctx.src[: m.start()].count("\n") + 1, smi)
        if f:
            out.append(f)
    return out


# --------------------------------------------------------------------------- #
# Social science — statistical method validity
# --------------------------------------------------------------------------- #

# Significance tests whose p-values inflate false positives when run many times
# without a multiple-comparison correction.
_SIG_TESTS = {
    "ttest_ind", "ttest_rel", "ttest_1samp", "pearsonr", "spearmanr",
    "kendalltau", "f_oneway", "mannwhitneyu", "wilcoxon", "chi2_contingency",
    "kruskal", "ranksums",
}
# Correction functions/markers — if any appears, we assume the author corrected.
_CORRECTION = re.compile(
    r"multipletests|fdrcorrection|false_discovery|bonferroni|\bholm\b|"
    r"p_adjust|\.correct\b|multitest",
    re.IGNORECASE,
)
# Central-tendency / spread reductions that are meaningless on a nominal code.
_NUMERIC_REDUCE = {"mean", "median", "std", "var", "sem", "skew", "kurt"}
# Unambiguous NOMINAL variable names — averaging their codes has no meaning.
_NOMINAL = {
    "gender", "sex", "race", "ethnicity", "region", "country", "nationality",
    "religion", "party", "condition", "treatment", "arm", "group", "category",
    "cluster", "occupation", "state", "province", "county", "zipcode", "zip",
}


def _is_nominal_name(name: str) -> bool:
    n = name.lower()
    return n in _NOMINAL or _suffix(n) in _NOMINAL


def _sig_test_calls(tree: ast.AST) -> list[ast.Call]:
    return [n for n in ast.walk(tree)
            if isinstance(n, ast.Call) and _call_name(n) in _SIG_TESTS]


def _inside_loop(tree: ast.AST, target: ast.Call) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, (ast.For, ast.While)):
            if any(c is target for c in ast.walk(node)):
                return True
    return False


_MATERIAL_CONTEXT = re.compile(
    r"pymatgen|\bStructure\b|\bComposition\b|\bASE\b|ase\.io|rdkit|"
    r"\.cif\b|POSCAR|CONTCAR|DOSCAR|EIGENVAL|vasprun|INCAR|energy_above_hull|"
    r"oxidation[_ ]?states?|formation[_ ]energy|band[_ ]gap",
    re.IGNORECASE,
)
_OXIDATION_NAME = re.compile(r"oxidation[_ ]?states?|oxi[_ ]?states?|valence", re.IGNORECASE)
_RATIO_NAME = re.compile(r"expected[_ ]?(?:element[_ ]?)?ratio|stoichiometr(?:y|ic)", re.IGNORECASE)
_FORMULA_NAME = re.compile(r"formula|composition", re.IGNORECASE)

# Material quantities are often encoded in variable names rather than in a
# unit library. Keep this small and explicit: a flagged mismatch is actionable
# while an unknown suffix remains silent. The MCP performs richer unit checks
# on structured payloads.
_MATERIAL_UNIT_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("ev_per_atom", "energy_per_atom"),
    ("ev_atom", "energy_per_atom"),
    ("ev", "energy"),
    ("mev", "energy"),
    ("kev", "energy"),
    ("angstrom3", "volume"),
    ("ang3", "volume"),
    ("a3", "volume"),
    ("nm3", "volume"),
    ("angstrom", "length"),
    ("ang", "length"),
    ("nm", "length"),
    ("gpa", "pressure"),
    ("kbar", "pressure"),
    ("kelvin", "temperature"),
    ("degk", "temperature"),
)


def _material_named_family(name: str) -> str | None:
    lowered = name.lower().replace("-", "_")
    for suffix, family in _MATERIAL_UNIT_SUFFIXES:
        if lowered == suffix or lowered.endswith("_" + suffix):
            return family
    return None


def _material_unit_rules(ctx: Ctx) -> list[Finding]:
    """Catch arithmetic between incompatible material quantity units."""
    out: list[Finding] = []
    if ctx.tree is None:
        return out
    for node in ast.walk(ctx.tree):
        if not isinstance(node, (ast.BinOp, ast.Compare)):
            continue
        operands: list[ast.AST] = [node.left]
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, (ast.Add, ast.Sub)):
                continue
            operands.append(node.right)
            operation = "add/subtract"
        else:
            if len(node.comparators) != 1:
                continue
            operands.append(node.comparators[0])
            operation = "compare"
        names: list[str] = []
        for operand in operands:
            if isinstance(operand, ast.Name):
                names.append(operand.id)
            elif isinstance(operand, ast.Attribute):
                names.append(operand.attr)
            else:
                names.append("")
        families = [_material_named_family(name) for name in names]
        if len(families) == 2 and families[0] and families[1] and families[0] != families[1]:
            out.append(Finding(
                "error", "materials / units",
                f"Dimensional mismatch: {operation} of material quantities",
                ctx.snippet(ctx.line_of(node))
                + f"\n  {names[0]} is {families[0]}, {names[1]} is {families[1]}; convert explicitly before combining.",
            ))
    unitless_fields = {"band_gap", "formation_energy", "formation_energy_per_atom", "energy_above_hull", "volume", "lattice_constant", "pressure", "temperature"}
    for node in ast.walk(ctx.tree):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Constant):
            continue
        raw_value = node.value.value
        if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name) or target.id.lower() not in unitless_fields:
                continue
            out.append(Finding(
                "warn", "materials / units",
                "Material quantity has no explicit unit in its name",
                ctx.snippet(ctx.line_of(node))
                + "\n  use a canonical suffix such as _ev, _ev_atom, _angstrom, or _a3.",
            ))
    return out


def _literal_value(node: ast.AST) -> Any:
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError):
        return None


def _simple_formula_amounts(formula: str) -> dict[str, float] | None:
    """Parse common reduced formulas; pymatgen handles complex formulas."""
    if not isinstance(formula, str) or not formula.strip():
        return None
    token = re.compile(r"([A-Z][a-z]?)([0-9]*(?:\.[0-9]+)?)")
    out: dict[str, float] = {}
    pos = 0
    text = formula.strip()
    for match in token.finditer(text):
        if match.start() != pos:
            return None
        out[match.group(1)] = out.get(match.group(1), 0.0) + float(match.group(2) or "1")
        pos = match.end()
    return out if pos == len(text) and out else None


def _material_assignments(ctx: Ctx) -> tuple[list[tuple[str, Any, int]], list[tuple[str, Any, int]]]:
    formulas: list[tuple[str, Any, int]] = []
    specs: list[tuple[str, Any, int]] = []
    if ctx.tree is None:
        return formulas, specs
    for node in ast.walk(ctx.tree):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, (ast.Constant, ast.Dict)):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if not names:
            continue
        name = names[0]
        value = _literal_value(node.value)
        if _FORMULA_NAME.search(name) and isinstance(value, str):
            formulas.append((name, value, ctx.line_of(node)))
        if (_OXIDATION_NAME.search(name) or _RATIO_NAME.search(name)) and isinstance(value, dict):
            specs.append((name, value, ctx.line_of(node)))
    return formulas, specs


def _materials_formula_rules(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    formulas, specs = _material_assignments(ctx)
    oxidation = next((value for name, value, _ in specs if _OXIDATION_NAME.search(name)), None)
    ratios = next((value for name, value, _ in specs if _RATIO_NAME.search(name)), None)
    for _name, raw_formula, line in formulas:
        amounts = _simple_formula_amounts(raw_formula)
        if amounts is None:
            continue
        if isinstance(oxidation, dict):
            states: dict[str, float] = {}
            for element, value in oxidation.items():
                try:
                    state = float(value)
                except (TypeError, ValueError):
                    out.append(Finding(
                        "error", "materials / oxidation-state",
                        "Oxidation state is not numeric",
                        ctx.snippet(line) + f"\n  {element}={value!r}.",
                    ))
                    continue
                states[str(element)] = state
                if abs(state) > 8:
                    out.append(Finding(
                        "error", "materials / oxidation-state",
                        "Oxidation state is outside the supported sanity range",
                        ctx.snippet(line) + f"\n  {element}={state:g} is outside [-8, 8].",
                    ))
            unknown = sorted(set(amounts) - set(states))
            if unknown:
                out.append(Finding(
                    "warn", "materials / oxidation-state",
                    "Formula contains elements without declared oxidation states",
                    ctx.snippet(line) + f"\n  missing: {', '.join(unknown)}.",
                ))
            if not unknown:
                charge = sum(amounts[element] * states[element] for element in amounts)
                if not math.isclose(charge, 0.0, abs_tol=1e-6):
                    out.append(Finding(
                        "error", "materials / charge-neutrality",
                        "Composition and oxidation states are not charge neutral",
                        ctx.snippet(line) + f"\n  {raw_formula} gives net formal charge {charge:g}; expected 0.",
                    ))
        if isinstance(ratios, dict):
            try:
                expected = {str(key): float(value) for key, value in ratios.items()}
                mismatch: str | None = None
                if set(amounts) != set(expected):
                    mismatch = f"elements actual={sorted(amounts)} expected={sorted(expected)}"
                else:
                    scale = min(amounts[element] / expected[element] for element in expected if expected[element] != 0)
                    mismatch = next(
                        (
                            f"{element}: actual {amounts[element]:g}, expected ratio {expected[element]:g}"
                            for element in expected
                            if not math.isclose(amounts[element], expected[element] * scale, rel_tol=1e-6, abs_tol=1e-6)
                        ),
                        None,
                    )
                if mismatch:
                    out.append(Finding(
                        "error", "materials / element-ratio",
                        "Formula does not match the declared element ratio",
                        ctx.snippet(line) + f"\n  {mismatch}.",
                    ))
            except (TypeError, ValueError, ZeroDivisionError):
                out.append(Finding(
                    "error", "materials / element-ratio",
                    "Declared element ratio contains a non-numeric or zero value",
                    ctx.snippet(line),
                ))
    return out


def _materials_structure_and_dft_rules(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    src = ctx.src
    if not _MATERIAL_CONTEXT.search(src) or ctx.path.endswith("domain_check.py"):
        return out

    for match in re.finditer(
        r"\b(?:min(?:imum)?[_ ]distance|distance_threshold)\b\s*=\s*([0-9]+(?:\.[0-9]+)?)",
        src,
        re.IGNORECASE,
    ):
        value = float(match.group(1))
        if value < 0.8:
            line = src[: match.start()].count("\n") + 1
            out.append(Finding(
                "error", "materials / minimum-distance",
                "Minimum interatomic distance threshold is below 0.8 A",
                ctx.snippet(line) + f"\n  configured threshold: {value:g} A.",
            ))

    structure_match = re.search(r"\b(?:Structure|Atoms)\b|pymatgen\.core|ase\.io", src, re.IGNORECASE)
    if structure_match and not re.search(
        r"distance_matrix|get_all_distances|get_neighbors|min(?:imum)?[_ ]distance|StructureMatcher",
        src,
        re.IGNORECASE,
    ):
        line = src[: structure_match.start()].count("\n") + 1
        out.append(Finding(
            "warn", "materials / minimum-distance",
            "Structure is used without an explicit minimum-distance check",
            ctx.snippet(line) + "\n  validate periodic nearest-neighbour distances before ranking a candidate.",
        ))

    dft_match = re.search(r"pymatgen\.io\.vasp|\bVasp(?:Input|Calc)?\b|INCAR|vasprun", src, re.IGNORECASE)
    if dft_match:
        line = src[: dft_match.start()].count("\n") + 1
        if not re.search(r"\b(?:EDIFF|ediff)\b", src):
            out.append(Finding(
                "warn", "materials / dft-convergence",
                "DFT setup has no explicit electronic convergence criterion",
                ctx.snippet(line) + "\n  record EDIFF and verify final electronic convergence.",
            ))
        if not re.search(r"\b(?:EDIFFG|ediffg)\b", src):
            out.append(Finding(
                "warn", "materials / dft-convergence",
                "DFT setup has no explicit ionic convergence criterion",
                ctx.snippet(line) + "\n  record EDIFFG and verify forces before accepting a relaxed structure.",
            ))
        for key, limit in (("EDIFF", 1e-3), ("EDIFFG", 0.2)):
            for match in re.finditer(rf"[\"']?\b{key}\b[\"']?\s*[:=]\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)", src, re.IGNORECASE):
                value = float(match.group(1))
                bad = value > limit if key == "EDIFF" else abs(value) > limit
                if bad:
                    line = src[: match.start()].count("\n") + 1
                    out.append(Finding(
                        "error" if key == "EDIFF" else "warn",
                        "materials / dft-convergence",
                        f"{key} is too loose for a reproducible screening run",
                        ctx.snippet(line) + f"\n  value {value:g}; threshold {limit:g}.",
                    ))
    return out


def check_materials(ctx: Ctx) -> list[Finding]:
    """Check material formulas, structures, units, and DFT setup."""
    if not _MATERIAL_CONTEXT.search(ctx.src):
        return []
    out = _materials_formula_rules(ctx)
    out.extend(_material_unit_rules(ctx))
    out.extend(_materials_structure_and_dft_rules(ctx))
    return out


def check_social(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    if ctx.tree is None:
        return out

    # (1) Multiple comparisons without correction — silent p-hacking.
    tests = _sig_test_calls(ctx.tree)
    if tests and not _CORRECTION.search(ctx.src):
        looped = next((t for t in tests if _inside_loop(ctx.tree, t)), None)
        if looped is not None or len(tests) >= 3:
            node = looped or tests[0]
            how = "inside a loop" if looped is not None else f"{len(tests)} times"
            out.append(Finding(
                "warn", "social · multiple-comparisons",
                "Many significance tests, no multiple-comparison correction",
                ctx.snippet(ctx.line_of(node))
                + f"\n  a significance test runs {how} with no "
                "multipletests/FDR/Bonferroni correction anywhere — the "
                "family-wise false-positive rate is inflated (p-hacking risk). "
                "Collect the p-values and correct them.",
            ))

    # (2) Central tendency of a nominal category code — meaningless.
    for node in ast.walk(ctx.tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr not in _NUMERIC_REDUCE:
            continue
        recv = node.func.value
        key = None
        if isinstance(recv, ast.Subscript):  # df['gender']
            sl = recv.slice
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                key = sl.value
        elif isinstance(recv, ast.Attribute):  # df.gender
            key = recv.attr
        if key and _is_nominal_name(key):
            out.append(Finding(
                "warn", "social · categorical",
                f"Numeric reduction .{node.func.attr}() on a nominal variable "
                f"('{key}')",
                ctx.snippet(ctx.line_of(node))
                + f"\n  '{key}' is a categorical code; its {node.func.attr} has "
                "no meaning. Use counts/proportions (value_counts), or group by "
                "it — don't average the code.",
            ))
    return out


# --------------------------------------------------------------------------- #
# Registry + driver
# --------------------------------------------------------------------------- #

VALIDATORS = [check_physics, check_earth, check_biology, check_chemistry, check_materials, check_social]

_CODE_EXT = {".py": "python", ".r": "r", ".R": "r"}


def _build_ctx(path: str, src: str, lang: str) -> Ctx:
    ctx = Ctx(path=path, src=src, lang=lang, lines=src.splitlines())
    if lang == "python":
        try:
            ctx.tree = ast.parse(src)
        except SyntaxError:
            ctx.tree = None
    return ctx


def contexts_for(path: Path) -> list[Ctx]:
    """One or more code contexts from a file (a notebook yields one per file)."""
    suffix = path.suffix
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    if suffix == ".ipynb":
        return [_notebook_ctx(str(path), raw)]
    lang = _CODE_EXT.get(suffix)
    if not lang:
        return []
    return [_build_ctx(str(path), raw, lang)]


def _notebook_ctx(path: str, raw: str) -> Ctx:
    try:
        nb = json.loads(raw)
    except json.JSONDecodeError:
        return _build_ctx(path, "", "python")
    lang = "python"
    ks = nb.get("metadata", {}).get("kernelspec", {})
    if str(ks.get("language", "")).lower().startswith("r"):
        lang = "r"
    code = "\n".join(
        "".join(c.get("source", []))
        for c in nb.get("cells", [])
        if c.get("cell_type") == "code"
    )
    return _build_ctx(path, code, lang)


def analyze(ctx: Ctx) -> list[Finding]:
    out: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()
    for validator in VALIDATORS:
        try:
            found = validator(ctx)
        except Exception:  # a buggy rule must never crash the whole gate
            continue
        for f in found:  # dedupe rules that overlap on one expression
            key = (f.tag, f.title, f.evidence)
            if key not in seen:
                seen.add(key)
                out.append(f)
    return out


def discover(root: Path) -> list[Path]:
    skip = {"node_modules", "__pycache__", ".git", ".openscience", ".venv", "venv"}
    out: list[Path] = []
    for p in sorted(root.rglob("*")):
        if any(part in skip or part.startswith(".") for part in p.parts):
            continue
        if p.is_file() and (p.suffix in _CODE_EXT or p.suffix == ".ipynb"):
            out.append(p)
    return out


NOTE = (
    "Domain-correctness gate — flags known dangerous patterns per discipline "
    "(units, CRS, coordinates). It checks for specific error classes only; "
    "absence of findings is not a guarantee the science is correct."
)


def run(paths: list[str]) -> dict:
    targets: list[Path] = []
    if paths:
        targets = [Path(p) for p in paths]
    else:
        targets = discover(Path.cwd())
    findings: list[Finding] = []
    for t in targets:
        for ctx in contexts_for(t):
            findings.extend(analyze(ctx))
    return {
        "findings": [
            {"level": f.level, "check": "domain", "tag": f.tag,
             "title": f.title, "evidence": f.evidence}
            for f in findings
        ],
        "note": NOTE,
    }


def main(argv: list[str]) -> int:
    result = run(argv[1:])
    print("```review")
    print(json.dumps(result, ensure_ascii=False))
    print("```")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
