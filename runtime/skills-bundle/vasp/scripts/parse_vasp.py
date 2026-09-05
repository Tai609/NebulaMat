#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Summarize a VASP run from OUTCAR (stdlib only).

Usage: uv run parse_vasp.py [RUNDIR] [--free-only] [--smoke]

Run via `uv run` so a modern interpreter is used (the cluster's system python
may be too old). Reports: normal termination, electronic/ionic convergence,
final energy, max force, magnetization, and known error/warning strings.

  --free-only   report max force over only the unconstrained atoms, read from
                the run's CONTCAR/POSCAR selective-dynamics flags. For a
                fixed-bottom slab the frozen atoms otherwise dominate and the
                all-atoms force looks alarming even at a converged minimum.
  --smoke       environment/input-start check only. Do not require electronic or
                ionic convergence; NELM-limited smoke-test energies are unusable.

Exit code: 0 converged+finished, 1 finished-but-unconverged, 2 failed/incomplete.
"""
import os
import re
import sys

KNOWN_ERRORS = [
    "ZBRENT: fatal", "EDDDAV: Call to ZHEGV failed", "Sub-Space-Matrix is not hermitian",
    "TOO FEW BANDS", "BRMIX: very serious problems", "VERY BAD NEWS",
    "internal error in subroutine PRICEL", "RHOSYG internal error",
    "POSMAP internal error", "Tetrahedron method fails", "ZPOTRF",
]


def free_mask(d):
    """Return a per-atom list of bool (True = free) from CONTCAR/POSCAR selective
    dynamics, or None if no selective-dynamics block is present/parseable."""
    for name in ("CONTCAR", "POSCAR"):
        p = os.path.join(d, name)
        if not os.path.isfile(p):
            continue
        L = open(p, errors="ignore").read().splitlines()
        if len(L) < 8:
            continue
        # line index 5 is element symbols (VASP5) or counts (VASP4)
        toks5 = L[5].split()
        if toks5 and all(t.lstrip("-").isdigit() for t in toks5):
            counts, i = toks5, 6
        else:
            counts, i = L[6].split(), 7
        try:
            nat = sum(int(c) for c in counts)
        except ValueError:
            return None
        if i >= len(L) or L[i].strip()[:1] not in ("S", "s"):
            return None  # no selective dynamics -> treat all as free
        start = i + 2  # skip the "Selective dynamics" and coordinate-mode lines
        mask = []
        for k in range(start, start + nat):
            if k >= len(L):
                return None
            parts = L[k].split()
            flags = parts[3:6] if len(parts) >= 6 else []
            mask.append(any(f.upper() == "T" for f in flags) if flags else True)
        return mask if len(mask) == nat else None
    return None


def main():
    if sys.version_info < (3, 8):
        sys.exit("parse_vasp.py targets modern Python (>=3.8); run via `uv run parse_vasp.py` "
                 "or load the cluster guide's Python (conda/uv/module).")

    args = [a for a in sys.argv[1:] if a not in ("--free-only", "--smoke")]
    free_only = "--free-only" in sys.argv[1:]
    smoke_mode = "--smoke" in sys.argv[1:]
    d = args[0] if args else "."
    outcar = os.path.join(d, "OUTCAR")
    if not os.path.isfile(outcar):
        print(f"FAIL: no OUTCAR in {d}")
        sys.exit(2)

    text = open(outcar, errors="ignore").read()
    issues = []
    warnings = []

    finished = "General timing and accounting" in text
    if not finished:
        issues.append("no timing footer: crashed, killed, or still running")

    for err in KNOWN_ERRORS:
        if err in text:
            issues.append(f"error string: '{err}' (see vasp/references/errors.md)")

    # INCAR settings actually used
    m = re.search(r"NELM\s*=\s*(\d+)", text)
    nelm = int(m.group(1)) if m else 60
    m = re.search(r"NSW\s*=\s*(\d+)", text)
    nsw = int(m.group(1)) if m else 0
    m = re.search(r"EDIFFG\s*=\s*(\S+)", text)
    ediffg = m.group(1) if m else None

    # electronic convergence: iteration counts per ionic step
    iters = [int(n) for _, n in re.findall(r"Iteration\s+(\d+)\(\s*(\d+)\)", text)]
    steps = re.findall(r"Iteration\s+(\d+)\(", text)
    n_ionic = len(set(steps))
    if iters:
        scf_maxed_steps = set()
        for ionic, scf in re.findall(r"Iteration\s+(\d+)\(\s*(\d+)\)", text):
            if int(scf) >= nelm:
                scf_maxed_steps.add(ionic)
        if scf_maxed_steps:
            sorted_steps = sorted(scf_maxed_steps, key=int)
            if smoke_mode:
                warnings.append(f"smoke test hit NELM={nelm} in ionic step(s) {sorted_steps[:5]} "
                                "- expected for a short start check; energies/forces are unusable")
            elif nsw == 0:
                issues.append(f"static SCF hit NELM={nelm} - final energy is unconverged")
            else:
                step_numbers = [int(s) for s in steps]
                final_step = max(step_numbers) if step_numbers else None
                final_hit = final_step is not None and str(final_step) in scf_maxed_steps
                repeated = len(scf_maxed_steps) > 1
                if final_hit:
                    issues.append(f"final ionic step hit NELM={nelm} - final forces/energy are unconverged")
                elif repeated:
                    issues.append(f"SCF repeatedly hit NELM={nelm} in ionic step(s) {sorted_steps[:5]} "
                                  "- trajectory should be restarted with SCF-stability fixes")
                else:
                    warnings.append(f"early ionic step hit NELM={nelm} in step {sorted_steps[0]}; "
                                    "final-step convergence decides usability, but record this restart risk")

    energies = re.findall(r"free  energy   TOTEN\s*=\s*([-\d.]+)", text)
    energy = float(energies[-1]) if energies else None
    # E0 = energy extrapolated to sigma->0; the appropriate energy for smeared/metallic
    # systems (TOTEN is the free energy F = E - TS_elec, which carries the entropy term).
    e0_matches = re.findall(r"energy\(sigma->0\)\s*=\s*(-?[\d.]+)", text)
    e0 = float(e0_matches[-1]) if e0_matches else None

    # max force from the last TOTAL-FORCE block
    max_force = None
    force_note = "all atoms incl. fixed"
    blocks = re.findall(r"TOTAL-FORCE \(eV/Angst\)\n -+\n((?:.+\n)+?) -+", text)
    if blocks:
        per_atom = [max(abs(float(x)) for x in line.split()[3:6])
                    for line in blocks[-1].strip().splitlines()]
        if free_only:
            mask = free_mask(d)
            if mask and len(mask) == len(per_atom):
                free = [f for f, keep in zip(per_atom, mask) if keep]
                max_force = max(free) if free else None
                force_note = f"free atoms only: {sum(mask)}/{len(mask)} (selective dynamics)"
            else:
                max_force = max(per_atom)
                force_note = ("all atoms - --free-only requested but no usable selective-dynamics "
                              "block in CONTCAR/POSCAR")
        else:
            max_force = max(per_atom)
        if ediffg:
            force_note += f"; EDIFFG={ediffg}"

    ionic_converged = "reached required accuracy" in text
    if nsw > 0 and not smoke_mode and finished and not ionic_converged:
        issues.append(f"relaxation ended at NSW={nsw} without reaching required accuracy")

    mag = re.findall(r"number of electron\s+[\d.]+\s+magnetization\s+([-\d.]+)", text)

    print(f"directory:     {os.path.abspath(d)}")
    print(f"finished:      {finished}")
    print(f"ionic steps:   {n_ionic} (NSW={nsw})")
    if e0 is not None:
        print(f"final energy:  {e0:.6f} eV (E0, sigma->0"
              + (f"; TOTEN={energy:.6f}" if energy is not None else "") + ")")
    elif energy is not None:
        print(f"final energy:  {energy:.6f} eV (TOTEN, OUTCAR)")
    if max_force is not None:
        print(f"max force:     {max_force:.4f} eV/A ({force_note})")
    if mag:
        print(f"magnetization: {mag[-1]} mu_B")
    if nsw > 0:
        print(f"ionic conv.:   {ionic_converged}")
    if smoke_mode:
        print("mode:          smoke check only (convergence and energies are not production evidence)")

    for w in warnings:
        print(f"WARN: {w}")
    for i in issues:
        print(f"ISSUE: {i}")
    if not finished or any("error string" in i for i in issues):
        sys.exit(2)
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
