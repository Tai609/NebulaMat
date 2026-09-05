#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Summarize a Gaussian log file (stdlib only).

Usage: uv run parse_gaussian.py JOB.log

Run via `uv run` so a modern interpreter is used (the cluster's system python
may be too old). Reports: termination status, error link, final SCF energy,
optimization status, imaginary frequencies, thermochemistry, spin contamination.
Exit code: 0 clean, 1 finished-with-issues, 2 error termination/incomplete.
"""
import re
import sys

HARTREE_EV = 27.211386


def main():
    if sys.version_info < (3, 8):
        sys.exit("parse_gaussian.py targets modern Python (>=3.8); run via `uv run parse_gaussian.py` "
                 "or load the cluster guide's Python (conda/uv/module).")
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    text = open(sys.argv[1], errors="ignore").read()
    issues = []

    normal = len(re.findall(r"Normal termination of Gaussian", text))
    error = re.search(r"Error termination via Lnk1e in (\S+?l(\d+)\.exe)", text)
    n_steps = max(1, len(re.findall(r"^ #", text, re.M)))  # route sections seen
    route = " ".join(re.findall(r"^ #.*", text, re.M)[:6]).lower()  # the echoed route line(s)
    is_opt = bool(re.search(r"\bopt\b", route))  # opt requested in the route, not "opt" anywhere in the file

    scf = re.findall(r"SCF Done:\s+E\((\S+)\)\s*=\s*([-\d.]+)", text)
    stationary = "Stationary point found" in text
    freq_lines = re.findall(r"Frequencies --\s+(.+)", text)
    freqs = [float(x) for line in freq_lines for x in line.split()]
    n_imag = sum(1 for f in freqs if f < 0)

    thermo = {}
    for label, pat in [
        ("E+ZPE", r"Sum of electronic and zero-point Energies=\s+([-\d.]+)"),
        ("H(298)", r"Sum of electronic and thermal Enthalpies=\s+([-\d.]+)"),
        ("G(298)", r"Sum of electronic and thermal Free Energies=\s+([-\d.]+)"),
    ]:
        m = re.search(pat, text)
        if m:
            thermo[label] = float(m.group(1))

    s2 = re.findall(r"S\*\*2 before annihilation\s+([\d.]+)", text)

    print(f"normal terminations: {normal} (route sections seen: {n_steps})")
    if error:
        issues.append(f"error termination in l{error.group(2)} "
                      "(see gaussian/references/errors.md)")
    if scf:
        method, e = scf[-1]
        print(f"final SCF: E({method}) = {float(e):.8f} Ha = {float(e) * HARTREE_EV:.4f} eV")
    if is_opt:
        print(f"stationary point found: {stationary}")
        if not stationary and not error:
            issues.append("optimization did not converge (no 'Stationary point found')")
    if freqs:
        print(f"frequencies: {len(freqs)} modes, {n_imag} imaginary"
              + (f" (lowest {min(freqs):.1f} cm^-1)" if freqs else ""))
        if n_imag == 1:
            print("  -> 1 imaginary mode: valid only if this is an intended TS")
        elif n_imag > 1:
            issues.append(f"{n_imag} imaginary modes: not a stationary point of interest")
    for k, v in thermo.items():
        print(f"{k}: {v:.6f} Ha")
    if s2:
        print(f"S**2 (last, before annihilation): {s2[-1]}")

    for i in issues:
        print(f"ISSUE: {i}")
    if error or normal == 0:
        sys.exit(2)
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
