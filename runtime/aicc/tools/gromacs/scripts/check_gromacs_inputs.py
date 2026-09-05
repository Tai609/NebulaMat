#!/usr/bin/env python3
"""Static preflight for a GROMACS .mdp + .gro + .top set.

This stdlib-only checker catches common mistakes before `gmx grompp`.
It does not replace `gmx grompp`, `mdout.mdp`, processed-topology review,
or scientific validation.

Exit codes: 0 pass, 1 review warnings, 2 errors.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

TRUE = {"yes", "true", "on", "1"}
FALSE = {"no", "false", "off", "0", "none"}
EM = {"steep", "cg", "l-bfgs", "lbfgs"}
DYN = {"md", "md-vv", "md-vv-avek", "sd", "bd"}


def key(s: str) -> str:
    return s.strip().lower().replace("_", "-")


def clean(line: str) -> str:
    return line.split(";", 1)[0].strip()


def parse_bool(v: str | None) -> bool | None:
    if v is None:
        return None
    n = v.strip().lower()
    if n in TRUE:
        return True
    if n in FALSE:
        return False
    return None


def parse_mdp(path: Path, notes: list[str], warnings: list[str], errors: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i, raw in enumerate(path.read_text(errors="replace").splitlines(), 1):
        line = clean(raw)
        if not line:
            continue
        if "=" not in line:
            warnings.append(f"{path}:{i}: non-empty MDP line has no '='")
            continue
        k, v = line.split("=", 1)
        k = key(k)
        v = v.strip()
        if k in out and out[k] != v:
            warnings.append(f"{path}:{i}: duplicate MDP key {k!r}; last value wins")
        out[k] = v
    notes.append(f"read MDP {path}")
    return out


def parse_gro(path: Path, notes: list[str], errors: list[str]) -> int | None:
    lines = path.read_text(errors="replace").splitlines()
    if len(lines) < 3:
        errors.append(f"{path}: too short for .gro")
        return None
    try:
        natoms = int(lines[1].strip())
    except ValueError:
        errors.append(f"{path}: second line is not an atom count")
        return None
    if len(lines) < natoms + 3:
        errors.append(f"{path}: declares {natoms} atoms but has too few lines")
        return None
    for idx, line in enumerate(lines[2:2 + natoms], 1):
        try:
            xyz = [float(line[20:28]), float(line[28:36]), float(line[36:44])]
        except Exception:
            parts = line.split()
            try:
                xyz = [float(x) for x in parts[-3:]]
            except Exception:
                errors.append(f"{path}: cannot parse coordinates on atom line {idx}")
                continue
        if not all(math.isfinite(x) for x in xyz):
            errors.append(f"{path}: non-finite coordinate on atom line {idx}")
    try:
        box = [float(x) for x in lines[2 + natoms].split()]
    except Exception:
        errors.append(f"{path}: cannot parse box line")
        return natoms
    if len(box) not in {3, 9}:
        errors.append(f"{path}: box line has {len(box)} values, expected 3 or 9")
    if len(box) == 3 and any(x <= 0 for x in box):
        errors.append(f"{path}: non-positive box length")
    notes.append(f"read GRO {path}: {natoms} atoms")
    return natoms


def iter_top(path: Path, defines: set[str], include_dirs: list[Path], warnings: list[str]) -> list[str]:
    """Very small topology preprocessor: #include plus #ifdef/#ifndef/#else/#endif."""
    active_stack: list[tuple[bool, bool]] = []
    active = True
    lines_out: list[str] = []
    base = path.parent
    for raw in path.read_text(errors="replace").splitlines():
        s = raw.strip()
        if s.startswith("#ifdef"):
            cond = s.split()[1] in defines
            active_stack.append((active, cond))
            active = active and cond
            continue
        if s.startswith("#ifndef"):
            cond = s.split()[1] not in defines
            active_stack.append((active, cond))
            active = active and cond
            continue
        if s.startswith("#else"):
            parent, cond = active_stack[-1]
            active = parent and not cond
            continue
        if s.startswith("#endif"):
            parent, _ = active_stack.pop()
            active = parent
            continue
        if s.startswith("#define") and active:
            parts = s.split()
            if len(parts) > 1:
                defines.add(parts[1])
            continue
        if s.startswith("#include") and active:
            m = re.search(r"[\"<]([^\">]+)[\">]", s)
            if not m:
                warnings.append(f"{path}: malformed include {s!r}")
                continue
            name = m.group(1)
            candidates = [base / name, *[d / name for d in include_dirs]]
            found = next((c for c in candidates if c.is_file()), None)
            if found:
                lines_out.extend(iter_top(found, defines, include_dirs, warnings))
            else:
                warnings.append(f"{path}: unresolved include {name!r}")
            continue
        if active:
            lines_out.append(raw)
    return lines_out


def parse_top(path: Path, mdp: dict[str, str], include_dirs: list[Path], notes: list[str], warnings: list[str], errors: list[str]) -> tuple[int | None, float | None, bool]:
    defines = {tok[2:].split("=", 1)[0] for tok in mdp.get("define", "").split() if tok.startswith("-D")}
    lines = iter_top(path, defines, include_dirs, warnings)
    section = ""
    mol: str | None = None
    next_mol_header = False
    mol_atoms: dict[str, int] = {}
    mol_charge: dict[str, float | None] = {}
    system: list[tuple[str, int]] = []
    has_posres = False

    for raw in lines:
        line = clean(raw)
        if not line:
            continue
        m = re.match(r"^\[\s*([^\]]+)\s*\]$", line)
        if m:
            section = key(m.group(1))
            next_mol_header = section == "moleculetype"
            if section in {"system", "molecules"}:
                mol = None
            continue
        fields = line.split()
        if section == "moleculetype" and next_mol_header:
            if len(fields) >= 2:
                mol = fields[0]
                mol_atoms[mol] = 0
                mol_charge[mol] = 0.0
            next_mol_header = False
            continue
        if section == "atoms" and mol and fields and fields[0].lstrip("+-").isdigit():
            mol_atoms[mol] += 1
            if len(fields) >= 7 and mol_charge[mol] is not None:
                try:
                    mol_charge[mol] = float(mol_charge[mol]) + float(fields[6])
                except ValueError:
                    mol_charge[mol] = None
            continue
        if section == "position-restraints" and fields and fields[0].lstrip("+-").isdigit():
            has_posres = True
            continue
        if section == "molecules" and len(fields) >= 2:
            try:
                system.append((fields[0], int(fields[1])))
            except ValueError:
                errors.append(f"{path}: bad [ molecules ] line {line!r}")
    if not system:
        errors.append(f"{path}: no [ molecules ] section entries found")
        return None, None, has_posres
    total_atoms = 0
    total_charge = 0.0
    charge_ok = True
    for name, count in system:
        if name not in mol_atoms:
            errors.append(f"{path}: [ molecules ] references undefined moleculetype {name!r}")
            return None, None, has_posres
        total_atoms += mol_atoms[name] * count
        q = mol_charge.get(name)
        if q is None:
            charge_ok = False
        else:
            total_charge += q * count
    notes.append(f"topology atoms={total_atoms}; charge={total_charge:+.6f} e")
    if charge_ok and abs(total_charge - round(total_charge)) > 1e-3:
        warnings.append(f"total charge {total_charge:+.6f} e is not close to an integer")
    return total_atoms, total_charge if charge_ok else None, has_posres


def check_policy(mdp: dict[str, str], stage: str, warnings: list[str], errors: list[str]) -> None:
    integrator = mdp.get("integrator", "md").strip().lower()
    if stage == "auto":
        stage = "em" if integrator in EM else "production"
    if stage == "em" and integrator not in EM:
        errors.append(f"stage em uses non-EM integrator {integrator!r}")
    if stage in {"production", "equilibration", "nve"} and integrator in EM:
        errors.append(f"dynamics stage uses minimization integrator {integrator!r}")
    if mdp.get("cutoff-scheme", "verlet").strip().lower() == "group":
        errors.append("cutoff-scheme=group is legacy/unsupported in current GROMACS workflows")
    for removed in ("implicit-solvent", "gb-algorithm", "sa-algorithm"):
        if removed in mdp:
            errors.append(f"{removed} is removed/legacy in current GROMACS; delete it or use a supported code")
    if stage == "production" and mdp.get("gen-vel", "no").strip().lower() in TRUE:
        errors.append("production must not regenerate velocities (gen-vel=yes)")
    if mdp.get("continuation", "no").strip().lower() in TRUE and mdp.get("gen-vel", "no").strip().lower() in TRUE:
        errors.append("continuation=yes with gen-vel=yes discards continuation velocities")
    tcoupl = mdp.get("tcoupl", "no").strip().lower()
    pcoupl = mdp.get("pcoupl", "no").strip().lower()
    if tcoupl == "berendsen":
        warnings.append("Berendsen thermostat suppresses canonical fluctuations; use only for disclosed legacy reproduction")
    if pcoupl == "berendsen":
        warnings.append("Berendsen barostat is not a correct NPT ensemble; use only for disclosed legacy reproduction")
    if stage == "nve" and (tcoupl not in FALSE or pcoupl not in FALSE):
        errors.append("NVE stage should not use thermostat or barostat")
    groups = mdp.get("tc-grps", "").split()
    if tcoupl not in FALSE and groups:
        for k in ("tau-t", "ref-t"):
            vals = mdp.get(k, "").split()
            if vals and len(vals) != len(groups):
                errors.append(f"tc-grps has {len(groups)} groups but {k} has {len(vals)} values")
    pc_type = mdp.get("pcoupltype", "isotropic").lower()
    expected = {"isotropic": 1, "semiisotropic": 2, "anisotropic": 6, "surface-tension": 2}.get(pc_type)
    if pcoupl not in FALSE and expected:
        for k in ("ref-p", "compressibility"):
            vals = mdp.get(k, "").split()
            if vals and len(vals) != expected:
                errors.append(f"pcoupltype={pc_type} expects {expected} {k} value(s), found {len(vals)}")
    try:
        dt = float(mdp.get("dt", "0").split()[0])
        if dt > 0.004:
            warnings.append(f"dt={dt:g} ps is large; requires validated CG/virtual-site/HMR model")
        elif dt >= 0.002 and mdp.get("constraints", "none").lower() in {"none", "no"}:
            warnings.append(f"dt={dt:g} ps without constraints requires stability validation")
    except Exception:
        pass
    if mdp.get("energygrps"):
        warnings.append("energygrps is short-range energy decomposition, not a binding free energy; GPU support is version/setting dependent")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mdp", required=True, type=Path)
    ap.add_argument("--gro", required=True, type=Path)
    ap.add_argument("--top", required=True, type=Path)
    ap.add_argument("--stage", default="auto", choices=["auto", "em", "equilibration", "production", "nve"])
    ap.add_argument("-I", "--include-dir", action="append", default=[], type=Path)
    ap.add_argument("-r", "--restraint", type=Path)
    ap.add_argument("-t", "--checkpoint", type=Path)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    notes: list[str] = []
    warnings: list[str] = []
    errors: list[str] = []
    for label, p in (("MDP", args.mdp), ("GRO", args.gro), ("TOP", args.top)):
        if not p.is_file():
            errors.append(f"{label} file not found: {p}")
    if errors:
        mdp = {}
        gro_atoms = top_atoms = None
        total_charge = None
        has_posres = False
    else:
        mdp = parse_mdp(args.mdp, notes, warnings, errors)
        check_policy(mdp, args.stage, warnings, errors)
        gro_atoms = parse_gro(args.gro, notes, errors)
        top_atoms, total_charge, has_posres = parse_top(args.top, mdp, args.include_dir, notes, warnings, errors)
        if gro_atoms is not None and top_atoms is not None and gro_atoms != top_atoms:
            errors.append(f"coordinate/topology atom-count mismatch: GRO={gro_atoms}, topology={top_atoms}")
        if has_posres and args.restraint is None:
            warnings.append("active [ position_restraints ] found; verify the `grompp -r` reference coordinates")
        if args.checkpoint and mdp.get("gen-vel", "no").strip().lower() in TRUE:
            errors.append("checkpoint supplied but gen-vel=yes would discard velocities")

    status = "FAIL" if errors else ("REVIEW" if warnings else "PASS")
    result = {"status": status, "notes": notes, "warnings": warnings, "errors": errors, "gro_atoms": gro_atoms, "topology_atoms": top_atoms, "total_charge_e": total_charge}
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"GROMACS preflight: {status}")
        for m in notes:
            print(f"NOTE: {m}")
        for m in warnings:
            print(f"WARNING: {m}")
        for m in errors:
            print(f"ERROR: {m}")
        print("Reminder: this static checker does not replace `gmx grompp` and scientific validation.")
    return 2 if errors else (1 if warnings else 0)


if __name__ == "__main__":
    sys.exit(main())
