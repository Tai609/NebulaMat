#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymatgen"]
# ///
"""Substitute, remove (vacancy), or add (interstitial/dopant) atoms in a structure.

Run with `uv run dope_structure.py ...` (inline pymatgen dep -> isolated cached env).
Exactly ONE operation per call (chain calls for several); always prints what changed.

Usage:
    uv run dope_structure.py STRUCT [--out POSCAR_doped] (one of:)
      --substitute IDX:EL              # replace atom IDX (1-based) with element EL
      --substitute-top ELOLD:ELNEW[:N] # replace the topmost N atoms of ELOLD (default 1)
      --vacancy IDX                    # remove atom IDX (1-based)
      --vacancy-top EL[:N]             # remove the topmost N atoms of element EL
      --interstitial EL:fx,fy,fz       # add EL at fractional coords (e.g. a subsurface site)

"Topmost" = largest Cartesian z. An O vacancy under the reaction conditions, a
subsurface dopant, or a substitutional single atom are scientific choices — this
script performs one explicit edit; it does not decide the site for you.
"""
import argparse
import sys


def topmost(struct, el, n):
    idx = [i for i, s in enumerate(struct) if s.specie.symbol == el]
    if not idx:
        sys.exit(f"no {el} atoms in the structure")
    idx.sort(key=lambda i: -struct[i].coords[2])
    if n > len(idx):
        sys.exit(f"asked for top {n} {el} but only {len(idx)} present")
    return idx[:n]


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("struct")
    p.add_argument("--out", default="POSCAR_doped")
    p.add_argument("--substitute")
    p.add_argument("--substitute-top")
    p.add_argument("--vacancy")
    p.add_argument("--vacancy-top")
    p.add_argument("--interstitial")
    args = p.parse_args()

    ops = [o for o in (args.substitute, args.substitute_top, args.vacancy,
                       args.vacancy_top, args.interstitial) if o]
    if len(ops) != 1:
        sys.exit("give exactly one operation (--substitute / --substitute-top / "
                 "--vacancy / --vacancy-top / --interstitial)")

    try:
        from pymatgen.core import Structure
        from pymatgen.io.vasp import Poscar
    except ImportError:
        sys.exit("pymatgen is required: run via `uv run dope_structure.py ...` (or pip install pymatgen)")

    s = Structure.from_file(args.struct)
    note = ""

    if args.substitute:
        i_str, el = args.substitute.split(":")
        i = int(i_str) - 1
        old = s[i].specie.symbol
        s[i] = el
        note = f"substituted atom {i+1} {old} -> {el}"
    elif args.substitute_top:
        parts = args.substitute_top.split(":")
        elold, elnew = parts[0], parts[1]
        n = int(parts[2]) if len(parts) > 2 else 1
        for i in topmost(s, elold, n):
            s[i] = elnew
        note = f"substituted topmost {n} {elold} -> {elnew}"
    elif args.vacancy:
        i = int(args.vacancy) - 1
        old = s[i].specie.symbol
        s.remove_sites([i])
        note = f"removed atom {i+1} ({old}) -> vacancy"
    elif args.vacancy_top:
        parts = args.vacancy_top.split(":")
        el = parts[0]
        n = int(parts[1]) if len(parts) > 1 else 1
        s.remove_sites(topmost(s, el, n))
        note = f"removed topmost {n} {el} -> vacancy"
    elif args.interstitial:
        el, coords = args.interstitial.split(":")
        fx, fy, fz = (float(x) for x in coords.split(","))
        s.append(el, [fx, fy, fz])
        note = f"added {el} interstitial at frac ({fx}, {fy}, {fz})"

    out = s.get_sorted_structure()
    Poscar(out).write_file(args.out)
    print(f"{note}")
    print(f"wrote {args.out}: {out.composition.reduced_formula}, {len(out)} atoms")
    print(f"species order: {[str(e) for e in out.composition.elements]} - POTCAR must match this order")


if __name__ == "__main__":
    main()
