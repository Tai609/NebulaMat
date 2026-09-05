#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymatgen"]
# ///
"""Convert periodic structure files with a validation summary.

Usage:
    uv run convert_structure.py INPUT OUTPUT [--primitive | --conventional]

Run with `uv run` so the dependency above resolves into an isolated, cached
environment (no global install needed). Format inferred from filenames
(CIF, POSCAR/CONTCAR, .xyz, .json, ...).
"""
import argparse
import sys

from covalent_radii import DEFAULT_CONTACT_RADIUS_SCALE, covalent_contact_threshold_A, element_symbol_from_site


def closest_pair_report(structure):
    reports = []
    for i in range(len(structure)):
        for j in range(i + 1, len(structure)):
            distance = float(structure.distance_matrix[i][j])
            symbol_i = element_symbol_from_site(structure[i])
            symbol_j = element_symbol_from_site(structure[j])
            threshold = covalent_contact_threshold_A(symbol_i, symbol_j, DEFAULT_CONTACT_RADIUS_SCALE)
            reports.append(
                {
                    "i": i,
                    "j": j,
                    "distance": distance,
                    "threshold": threshold,
                    "margin": None if threshold is None else distance - threshold,
                }
            )
    reports.sort(key=lambda item: item["distance"])
    violations = [item for item in reports if item["margin"] is not None and item["margin"] < 0]
    violations.sort(key=lambda item: item["margin"] if item["margin"] is not None else 0.0)
    return reports[0] if reports else None, violations[0] if violations else None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input")
    p.add_argument("output")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--primitive", action="store_true", help="reduce to primitive cell")
    g.add_argument("--conventional", action="store_true", help="use conventional standard cell")
    p.add_argument("--symprec", type=float, default=1e-3)
    args = p.parse_args()

    try:
        from pymatgen.core import Structure
        from pymatgen.symmetry.analyzer import SpacegroupAnalyzer
    except ImportError:
        sys.exit("pymatgen is required: run via `uv run convert_structure.py ...` (or pip install pymatgen)")

    s = Structure.from_file(args.input)
    sga = SpacegroupAnalyzer(s, symprec=args.symprec)
    if args.primitive:
        s = sga.get_primitive_standard_structure()
    elif args.conventional:
        s = sga.get_conventional_standard_structure()

    nearest_pair, worst_contact = closest_pair_report(s) if len(s) > 1 else (None, None)
    s.to(filename=args.output)

    print(f"wrote {args.output}")
    print(f"formula:     {s.composition.reduced_formula} ({len(s)} atoms)")
    print(f"space group: {sga.get_space_group_symbol()} (symprec={args.symprec})")
    print(f"lattice:     a={s.lattice.a:.4f} b={s.lattice.b:.4f} c={s.lattice.c:.4f} A")
    if nearest_pair is not None:
        i = nearest_pair["i"]
        j = nearest_pair["j"]
        contact = ""
        if nearest_pair["threshold"] is not None:
            contact = (
                f"; allowed_min={nearest_pair['threshold']:.3f} A"
                f"; margin={nearest_pair['margin']:.3f} A"
            )
        print(
            f"min distance: {nearest_pair['distance']:.3f} A "
            f"({i + 1}:{s[i].species_string}-{j + 1}:{s[j].species_string}{contact})"
        )
        if worst_contact is not None:
            i = worst_contact["i"]
            j = worst_contact["j"]
            print(
                "WARNING: atom pair below allowed Pyykko covalent-radius tolerance: "
                f"{i + 1}:{s[i].species_string}-{j + 1}:{s[j].species_string} "
                f"{worst_contact['distance']:.3f} A < {worst_contact['threshold']:.3f} A"
            )
        elif nearest_pair["distance"] < 0.7:
            print("WARNING: atom pair below absolute fallback 0.700 A; possible overlapping atoms")
    print(f"species order: {[str(e) for e in s.composition.elements]}")


if __name__ == "__main__":
    main()
