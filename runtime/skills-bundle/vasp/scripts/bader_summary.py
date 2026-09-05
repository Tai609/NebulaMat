#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Summarize Bader net charges per atom and per element (stdlib only).

Usage: uv run bader_summary.py [RUNDIR] [--zval "Pt:10,O:6,Ti:12,..."] [--per-atom]

Reads RUNDIR/ACF.dat (from the `bader` code) + RUNDIR/POSCAR|CONTCAR for the
element order, and the per-element valence (ZVAL). ZVAL comes from RUNDIR/POTCAR
if present, else from --zval. Net charge q = ZVAL - N_Bader (positive = cation,
electrons removed). Reports per-element mean/min/max and the per-atom spread,
because for a supported metal on a reducible oxide the spread often exceeds the
inter-model difference (a small q is a weak oxidation-state discriminator — see
knowledge/electronic-structure.md). Run via `uv run` for a modern interpreter.

Exit: 0 ok, 2 missing/inconsistent inputs.
"""
import os
import re
import sys


def read_counts(d):
    for name in ("CONTCAR", "POSCAR"):
        p = os.path.join(d, name)
        if not os.path.isfile(p):
            continue
        L = open(p, errors="ignore").read().splitlines()
        if len(L) < 7:
            continue
        toks5 = L[5].split()
        if toks5 and all(t.lstrip("-").isdigit() for t in toks5):
            return None, [int(x) for x in toks5]  # VASP4: no symbols line
        return toks5, [int(x) for x in L[6].split()]
    return None, None


def zval_from_potcar(d):
    p = os.path.join(d, "POTCAR")
    if not os.path.isfile(p):
        return None
    return [float(z) for z in re.findall(r"ZVAL\s*=\s*([\d.]+)", open(p, errors="ignore").read())]


def main():
    args = sys.argv[1:]
    per_atom = "--per-atom" in args
    args = [a for a in args if a != "--per-atom"]
    zmap = {}
    if "--zval" in args:
        i = args.index("--zval")
        for kv in args[i + 1].split(","):
            k, v = kv.split(":")
            zmap[k.strip()] = float(v)
        del args[i:i + 2]
    d = args[0] if args else "."

    acf = os.path.join(d, "ACF.dat")
    if not os.path.isfile(acf):
        print(f"FAIL: no ACF.dat in {d}")
        sys.exit(2)
    charges = [float(line.split()[4]) for line in open(acf)
               if line.split()[:1] and line.split()[0].isdigit()]

    symbols, counts = read_counts(d)
    if not counts or sum(counts) != len(charges):
        print(f"FAIL: POSCAR counts {counts} don't match {len(charges)} ACF atoms")
        sys.exit(2)

    # per-atom ZVAL, expanded by species blocks
    pot_z = zval_from_potcar(d)
    zval = []
    for i, n in enumerate(counts):
        if symbols and symbols[i] in zmap:
            z = zmap[symbols[i]]
        elif pot_z and i < len(pot_z):
            z = pot_z[i]
        else:
            print(f"FAIL: no ZVAL for species #{i+1}"
                  f"{' ('+symbols[i]+')' if symbols else ''}; give --zval or a POTCAR")
            sys.exit(2)
        zval += [z] * n

    elems = []
    if symbols:
        for s, n in zip(symbols, counts):
            elems += [s] * n
    else:
        elems = [f"sp{i+1}" for i, n in enumerate(counts) for _ in range(n)]

    netq = [z - c for z, c in zip(zval, charges)]

    print(f"Bader net charge q = ZVAL - N_Bader  (+ = cation)   [{d}]")
    print(f"{'elem':<6}{'n':>4}{'mean q':>10}{'min':>9}{'max':>9}{'spread':>9}")
    seen = []
    for e in elems:
        if e in seen:
            continue
        seen.append(e)
        qs = [q for q, el in zip(netq, elems) if el == e]
        print(f"{e:<6}{len(qs):>4}{sum(qs)/len(qs):>10.3f}{min(qs):>9.3f}{max(qs):>9.3f}{max(qs)-min(qs):>9.3f}")
    if per_atom:
        print("\nper-atom:")
        for i, (e, q) in enumerate(zip(elems, netq), 1):
            print(f"  {i:>3} {e:<3} {q:+.3f}")
    sys.exit(0)


if __name__ == "__main__":
    main()
