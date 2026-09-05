#!/usr/bin/env python3
"""Open Science — social-science analysis integrity (P1-6).

Three deterministic checks that guard the decisive social-science risks:
sycophantic over-interpretation, silent p-hacking / HARKing, and irreproducible
randomness. Like the domain-correctness gate, this analyses what was actually
written (report prose + analysis code + a preregistration plan) — never model
recall — and emits the app's structured `review` contract. It flags specific
risk patterns; it never certifies an analysis as sound.

Checks:
  stats · interpretation  — causal / "provocative" language over what is only an
                            association (the execute-don't-interpret boundary).
  stats · prereg          — a predictor or interaction the code runs that the
                            preregistration plan never named (possible HARKing).
  stats · seed            — randomised analysis with no fixed seed (won't reproduce).

Usage:
    python stats_integrity_check.py [files...]   # default: scan the workspace
Output: one ```review fenced JSON block on stdout.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Finding:
    level: str
    tag: str
    title: str
    evidence: str


# --------------------------------------------------------------------------- #
# File classification
# --------------------------------------------------------------------------- #

_CODE_EXT = {".py", ".r", ".ipynb"}
_PREREG = re.compile(r"(prereg|pre-reg|preregistration|analysis[_-]?plan)", re.IGNORECASE)
_SKIP = {"node_modules", "__pycache__", ".git", ".openscience", ".venv", "venv"}


@dataclass
class SrcFile:
    path: str
    text: str
    kind: str  # "code" | "report" | "prereg"


def _read(p: Path) -> str:
    try:
        raw = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    if p.suffix.lower() == ".ipynb":
        return _notebook_code(raw)
    return raw


def _notebook_code(raw: str) -> str:
    try:
        nb = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    return "\n".join(
        "".join(c.get("source", []))
        for c in nb.get("cells", [])
        if c.get("cell_type") == "code"
    )


def classify(paths: list[Path]) -> list[SrcFile]:
    out: list[SrcFile] = []
    for p in paths:
        suffix = p.suffix.lower()
        text = _read(p)
        if not text:
            continue
        if _PREREG.search(p.stem):
            out.append(SrcFile(str(p), text, "prereg"))
        elif suffix in _CODE_EXT:
            out.append(SrcFile(str(p), text, "code"))
        elif suffix in {".md", ".txt", ".rmd"}:
            out.append(SrcFile(str(p), text, "report"))
    return out


def discover(root: Path) -> list[Path]:
    out: list[Path] = []
    for p in sorted(root.rglob("*")):
        if any(part in _SKIP or part.startswith(".") for part in p.parts):
            continue
        if p.is_file() and (
            p.suffix.lower() in _CODE_EXT or p.suffix.lower() in {".md", ".txt", ".rmd"}
        ):
            out.append(p)
    return out


def _line_of(text: str, idx: int) -> int:
    return text[:idx].count("\n") + 1


def _snip(path: str, text: str, idx: int) -> str:
    ln = _line_of(text, idx)
    lines = text.splitlines()
    body = lines[ln - 1].strip() if 1 <= ln <= len(lines) else ""
    return f"{path}:{ln}  {body}"


# --------------------------------------------------------------------------- #
# Check 1 · execute-don't-interpret (causal language over associations)
# --------------------------------------------------------------------------- #

_CAUSAL = re.compile(
    r"\b("
    r"caus(?:e|es|ed|ing)|"
    r"leads?\s+to|led\s+to|"
    r"results?\s+in|"
    r"due\s+to|because\s+of|"
    r"impacts?\s+(?:on|the)|the\s+impact\s+of|"
    r"the\s+effect\s+of|effects?\s+on|"
    r"proves?|prov(?:es|ed|en)\s+that|"
    r"driv(?:e|es|en)\s+by|"
    r"responsible\s+for|"
    r"increas(?:e|es|ed|ing)\s+.*\bby\s+\d"
    r")\b",
    re.IGNORECASE,
)
# A document only trips the interpretation check if it is clearly reporting a
# statistical association (keeps unrelated prose silent).
_STATS_SIGNAL = re.compile(
    r"\b(regression|correlat|coefficient|associat|odds\s*ratio|"
    r"p\s*[<=>]\s*0?\.\d|p-?value|beta|r-?squared|significant)\b",
    re.IGNORECASE,
)


def check_interpretation(reports: list[SrcFile]) -> list[Finding]:
    out: list[Finding] = []
    for f in reports:
        if not _STATS_SIGNAL.search(f.text):
            continue
        seen: set[int] = set()
        for m in _CAUSAL.finditer(f.text):
            ln = _line_of(f.text, m.start())
            if ln in seen:
                continue
            seen.add(ln)
            out.append(Finding(
                "warn", "stats · interpretation",
                "Causal language over an association",
                _snip(f.path, f.text, m.start())
                + f"\n  \"{m.group(0)}\" asserts causation. Regression/"
                "correlation output is associational — report the estimate and "
                "its uncertainty, and reserve causal claims for a design that "
                "supports them (RCT, IV, DiD, etc.).",
            ))
    return out


# --------------------------------------------------------------------------- #
# Check 2 · preregistration deviation (HARKing guard)
# --------------------------------------------------------------------------- #

_FORMULA = re.compile(r"([A-Za-z_.][\w.]*)\s*~\s*([^\"')\n]+)")
_IDENT = re.compile(r"[A-Za-z_.][\w.]*")
# Tokens that are formula operators / function noise, not variables.
_STOP = {
    "c", "factor", "np", "pd", "sm", "smf", "log", "exp", "poly", "i", "as",
    "data", "family", "binomial", "gaussian", "1", "0",
}


def _formula_terms(rhs: str) -> list[str]:
    """Split a formula RHS into terms, marking interactions."""
    return [t.strip() for t in re.split(r"[+]", rhs) if t.strip() and t.strip() != "1"]


def _vars_in(term: str) -> set[str]:
    return {t for t in _IDENT.findall(term) if t.lower() not in _STOP}


def check_prereg(prereg: list[SrcFile], code: list[SrcFile]) -> list[Finding]:
    if not prereg:
        return []
    plan_text = "\n".join(f.text for f in prereg).lower()
    out: list[Finding] = []
    seen: set[str] = set()
    for f in code:
        for m in _FORMULA.finditer(f.text):
            rhs = m.group(2)
            for term in _formula_terms(rhs):
                is_interaction = ("*" in term) or (":" in term)
                vs = _vars_in(term)
                if not vs:
                    continue
                # A term is preregistered iff every one of its variables is named
                # in the plan (interaction is preregistered only if named as such).
                missing = [v for v in vs if v.lower() not in plan_text]
                interaction_absent = is_interaction and not re.search(
                    r"interact|moderat|\*|\bx\b", plan_text
                )
                if missing:
                    key = f"var:{sorted(vs)!r}"
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(Finding(
                        "warn", "stats · prereg",
                        "Predictor not in the preregistration",
                        _snip(f.path, f.text, m.start())
                        + f"\n  term `{term}` uses {sorted(missing)}, not named "
                        "in the analysis plan — an unregistered predictor risks "
                        "HARKing. Preregister it or label the analysis exploratory.",
                    ))
                elif is_interaction and interaction_absent:
                    key = f"int:{term}"
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(Finding(
                        "warn", "stats · prereg",
                        "Interaction term not in the preregistration",
                        _snip(f.path, f.text, m.start())
                        + f"\n  interaction `{term}` is not described in the plan "
                        "— a post-hoc interaction is a classic HARKing path. "
                        "Preregister it or label it exploratory.",
                    ))
    return out


# --------------------------------------------------------------------------- #
# Check 3 · fixed seed (reproducibility)
# --------------------------------------------------------------------------- #

_RANDOM_USE = re.compile(
    r"\b(np\.random|numpy\.random|random\.(?:random|randint|sample|shuffle|choice)|"
    r"train_test_split|\.sample\(|bootstrap|permutation|resample|KFold|"
    r"StratifiedKFold|RandomForest|shuffle\s*=\s*True|rnorm|runif|rbinom|"
    r"sample\s*\()",
)
_SEED_SET = re.compile(
    r"(np\.random\.seed|numpy\.random\.seed|random\.seed|random_state\s*=|"
    r"set\.seed|default_rng\(\s*\d|seed\s*=\s*\d)",
)


def check_seed(code: list[SrcFile]) -> list[Finding]:
    out: list[Finding] = []
    for f in code:
        use = _RANDOM_USE.search(f.text)
        if use and not _SEED_SET.search(f.text):
            out.append(Finding(
                "warn", "stats · seed",
                "Randomised analysis with no fixed seed",
                _snip(f.path, f.text, use.start())
                + "\n  this uses randomness but sets no seed (np.random.seed / "
                "random_state= / set.seed) — the estimates won't reproduce "
                "run to run. Fix a seed so the result is reproducible.",
            ))
    return out


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

NOTE = (
    "Analysis-integrity gate — flags over-interpretation, unregistered analyses, "
    "and missing seeds. It checks these specific risks only; absence of findings "
    "does not certify the analysis is sound or the conclusions valid."
)


def run(paths: list[str]) -> dict:
    targets = [Path(p) for p in paths] if paths else discover(Path.cwd())
    files = classify(targets)
    reports = [f for f in files if f.kind == "report"]
    prereg = [f for f in files if f.kind == "prereg"]
    code = [f for f in files if f.kind == "code"]
    findings: list[Finding] = []
    findings += check_interpretation(reports)
    findings += check_prereg(prereg, code)
    findings += check_seed(code)
    return {
        "findings": [
            {"level": f.level, "check": "integrity", "tag": f.tag,
             "title": f.title, "evidence": f.evidence}
            for f in findings
        ],
        "note": NOTE,
    }


def main(argv: list[str]) -> int:
    print("```review")
    print(json.dumps(run(argv[1:]), ensure_ascii=False))
    print("```")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
