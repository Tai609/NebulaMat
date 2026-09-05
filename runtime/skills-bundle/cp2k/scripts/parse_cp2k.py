#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Summarize a CP2K output file (stdlib only).

Usage: parse_cp2k.py output.out
       parse_cp2k.py RUNDIR   # if exactly one *.out exists

Exit code: 0 no obvious issues, 1 finished but questionable/unconverged, 2 failed/incomplete.
"""
import glob
import os
import re
import sys

FATAL_PATTERNS = [
    "ABORT",
    "CPASSERT failed",
    "CP2K failed",
    "SIGSEGV",
    "segmentation fault",
    "MPI_ABORT",
]

HARTREE_PER_BOHR_TO_EV_PER_A = 51.422067476


def output_path(arg):
    if os.path.isdir(arg):
        files = sorted(glob.glob(os.path.join(arg, "*.out")))
        if len(files) == 1:
            return files[0]
        print(f"FAIL: expected exactly one *.out in {arg}, found {len(files)}")
        sys.exit(2)
    return arg


def last_force_summary(text):
    blocks = re.findall(
        r"ATOMIC FORCES in\s+\[a\.u\.\](.*?)(?:SUM OF ATOMIC FORCES|STRESS\||ENERGY\||PROGRAM ENDED AT|\Z)",
        text,
        re.I | re.S,
    )
    if not blocks:
        return None

    forces = []
    for line in blocks[-1].splitlines():
        cols = line.split()
        if len(cols) < 6 or not cols[0].isdigit() or not cols[1].isdigit():
            continue
        try:
            fx, fy, fz = (float(x) for x in cols[-3:])
        except ValueError:
            continue
        forces.append((fx, fy, fz))

    if not forces:
        return None
    max_component = max(max(abs(v) for v in force) for force in forces)
    max_norm = max((fx * fx + fy * fy + fz * fz) ** 0.5 for fx, fy, fz in forces)
    return max_component, max_norm


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip())
        sys.exit(2)
    path = output_path(sys.argv[1])
    if not os.path.isfile(path):
        print(f"FAIL: output not found: {path}")
        sys.exit(2)

    text = open(path, errors="ignore").read()
    issues = []

    finished = "PROGRAM ENDED AT" in text
    if not finished:
        issues.append("no 'PROGRAM ENDED AT' footer: crashed, killed, or still running")

    upper = text.upper()
    for pat in FATAL_PATTERNS:
        if pat.upper() in upper:
            issues.append(f"fatal string: {pat}")

    energies = [
        float(x)
        for x in re.findall(
            r"ENERGY\|\s+Total FORCE_EVAL.*?energy.*?:\s*([-+]?\d+(?:\.\d*)?(?:[Ee][-+]?\d+)?)",
            text,
        )
    ]

    scf_converged = re.findall(r"SCF run converged in\s+(\d+)\s+steps", text)
    scf_not = re.findall(r"SCF run NOT converged|SCF.*not converged|convergence failure", text, re.I)
    if scf_not:
        issues.append(f"SCF non-convergence message(s): {len(scf_not)}")
    if energies and not scf_converged and "SCF" in text:
        issues.append("energy present but no 'SCF run converged' line found; inspect output manually")

    opt_done = bool(re.search(r"GEOMETRY OPTIMIZATION COMPLETED|OPTIMIZATION.*CONVERGED", text, re.I))
    opt_max = bool(re.search(r"MAXIMUM NUMBER OF OPTIMIZATION STEPS|MAX_ITER.*REACHED", text, re.I))
    if opt_max and not opt_done:
        issues.append("optimization appears to have reached step limit")

    force_summary = last_force_summary(text)

    warnings = None
    m = re.search(r"Number of warnings for this run is\s*:\s*(\d+)", text, re.I)
    if m:
        warnings = int(m.group(1))
    else:
        warnings = len(re.findall(r"\bWARNING\b", text))

    md_steps = re.findall(r"MD\|\s+Step\s+number\s+(\d+)", text)
    md_last = int(md_steps[-1]) if md_steps else None

    print(f"file:           {os.path.abspath(path)}")
    print(f"finished:       {finished}")
    print(f"warnings:       {warnings}")
    if energies:
        print(f"final energy:   {energies[-1]:.12f} hartree")
    if scf_converged:
        print(f"last SCF:       converged in {scf_converged[-1]} steps")
    if opt_done or opt_max:
        print(f"opt converged:  {opt_done}")
    if force_summary is not None:
        max_component, max_norm = force_summary
        print(
            "max force:      "
            f"{max_component:.6e} hartree/bohr "
            f"({max_component * HARTREE_PER_BOHR_TO_EV_PER_A:.4f} eV/A, max component)"
        )
        print(
            "max force norm: "
            f"{max_norm:.6e} hartree/bohr "
            f"({max_norm * HARTREE_PER_BOHR_TO_EV_PER_A:.4f} eV/A)"
        )
    if md_last is not None:
        print(f"last MD step:   {md_last}")

    for issue in issues:
        print(f"ISSUE: {issue}")

    if not finished or any(i.startswith("fatal string") for i in issues):
        sys.exit(2)
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
