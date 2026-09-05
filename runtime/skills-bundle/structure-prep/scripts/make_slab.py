#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymatgen"]
# ///
"""Generate a slab with selective dynamics from a bulk structure.

Run with `uv run make_slab.py ...` so the dependency above resolves into an
isolated, cached environment (no global install needed).

Usage:
    make_slab.py BULK_FILE H K L [--min-slab 10] [--min-vacuum 15]
                 [--fix-below 0.5] [--termination N] [--ntop 6]
                 [--layer-tol 0.6] [--max-normal-search auto]
                 [--max-slab-tilt-deg 1.0]
                 [--orthogonal-c-reason TEXT] [--out POSCAR_slab]

Lists every distinct termination with its surface **coordination signature**
(top atoms' element + coordination number, via CrystalNN) and **layer count**
(z-planes), so a termination is chosen by signature — never by list index. The
first non-polar stoichiometric cut is often the wrong surface. Refuses to pick
when several exist unless --termination is given (it is a scientific choice).
Uses pymatgen's slab reorientation but keeps the input conventional cell by default
(`primitive=False`) to avoid accidental oblique cuts from primitive-cell reduction.
Uses `max_normal_search=auto` to ask pymatgen for the most normal c vector during
slab construction. `get_orthogonal_c_slab()` is available only as an explicit
fallback via --orthogonal-c-reason because it can break slab symmetries.
Writes a VASP POSCAR with the bottom fraction frozen.
"""
import argparse
import sys
from collections import Counter


def cluster_layers(zs, tol):
    """Count distinct planes along z: sorted z values split where the gap >= tol."""
    zs = sorted(zs)
    if not zs:
        return 0
    n, prev = 1, zs[0]
    for z in zs[1:]:
        if z - prev >= tol:
            n += 1
        prev = z
    return n


def c_ab_tilt_deg(structure):
    """Largest deviation from c perpendicular to a/b, in degrees."""
    return max(abs(float(structure.lattice.alpha) - 90.0), abs(float(structure.lattice.beta) - 90.0))


def parse_max_normal_search(value, miller_index):
    """Parse max_normal_search as auto, disabled, or a positive integer."""
    token = str(value).strip().lower()
    if token in {"auto", "default"}:
        return max(max(abs(idx) for idx in miller_index), 1)
    if token in {"none", "off", "false", "0"}:
        return None
    try:
        parsed = int(token)
    except ValueError as exc:
        raise ValueError("--max-normal-search must be auto, none/off/0, or a positive integer") from exc
    if parsed <= 0:
        return None
    return parsed


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("bulk", help="bulk structure file (CIF, POSCAR, ...)")
    p.add_argument("h", type=int)
    p.add_argument("k", type=int)
    p.add_argument("l", type=int)
    p.add_argument("--min-slab", type=float, default=10.0, help="min slab thickness (A)")
    p.add_argument("--min-vacuum", type=float, default=15.0, help="min vacuum thickness (A)")
    p.add_argument("--fix-below", type=float, default=0.5,
                   help="freeze atoms below this fraction of the slab height (0-1)")
    p.add_argument("--termination", type=int, default=None,
                   help="index of termination to use when several exist")
    p.add_argument("--ntop", type=int, default=6, help="top atoms shown in the surface signature")
    p.add_argument("--layer-tol", type=float, default=0.6, help="z tolerance (A) for layer clustering")
    p.add_argument(
        "--max-normal-search",
        default="auto",
        help=(
            "SlabGenerator max_normal_search value: auto uses max(|h|,|k|,|l|,1); "
            "use none/off/0 to disable or a positive integer to override"
        ),
    )
    p.add_argument(
        "--max-slab-tilt-deg",
        type=float,
        default=1.0,
        help="warn when c is not perpendicular to a and b by more than this angle; <=0 disables",
    )
    p.add_argument(
        "--orthogonal-c-reason",
        help=(
            "Explicit rationale to apply Slab.get_orthogonal_c_slab() after generation; "
            "use only when an orthogonal c cell is required and symmetry breaking is acceptable"
        ),
    )
    p.add_argument("--out", default="POSCAR_slab")
    args = p.parse_args()

    try:
        from pymatgen.core import Structure
        from pymatgen.core.surface import SlabGenerator
        from pymatgen.io.vasp import Poscar
    except ImportError:
        sys.exit("pymatgen is required: run via `uv run make_slab.py ...` (or pip install pymatgen)")
    try:
        from pymatgen.analysis.local_env import CrystalNN
        cnn = CrystalNN()
    except Exception:
        cnn = None  # signature degrades to element + z (no coordination numbers)

    bulk = Structure.from_file(args.bulk)
    miller_index = (args.h, args.k, args.l)
    try:
        max_normal_search = parse_max_normal_search(args.max_normal_search, miller_index)
    except ValueError as exc:
        p.error(str(exc))
    gen = SlabGenerator(bulk, (args.h, args.k, args.l),
                        min_slab_size=args.min_slab,
                        min_vacuum_size=args.min_vacuum,
                        center_slab=True,
                        primitive=False,
                        max_normal_search=max_normal_search,
                        reorient_lattice=True)
    slabs = gen.get_slabs()
    if not slabs:
        sys.exit("no slabs generated; check the Miller index")

    def signature(slab, ntop):
        zc = [s.coords[2] for s in slab]
        top = sorted(range(len(slab)), key=lambda i: -zc[i])[:ntop]
        out = []
        for i in top:
            cn = None
            if cnn is not None:
                try:
                    cn = cnn.get_cn(slab, i)
                except Exception:
                    cn = None
            sym = slab[i].specie.symbol
            out.append(f"{sym}{'' if cn is None else f'({cn}c)'}@{zc[i]:.2f}")
        return out

    note = "" if cnn else "  [CrystalNN unavailable -> no coordination numbers]"
    print(f"{len(slabs)} distinct termination(s) for ({args.h}{args.k}{args.l}){note}:")
    for i, s in enumerate(slabs):
        layers = cluster_layers([site.coords[2] for site in s], args.layer_tol)
        per_el = " ".join(f"{el}:{n}" for el, n in sorted(Counter(
            site.specie.symbol for site in s).items()))
        print(f"  [{i}] {s.composition.reduced_formula}  {len(s)} atoms  "
              f"shift={s.shift:.3f}  polar={s.is_polar()}  z-layers={layers}  ({per_el})")
        print(f"       top: {'  '.join(signature(s, args.ntop))}")

    if len(slabs) > 1 and args.termination is None:
        sys.exit("\nmultiple terminations exist - choose by the coordination signature above "
                 "(NOT list index), then rerun with --termination N. This is a scientific "
                 "choice; the first non-polar stoichiometric cut is often the wrong surface.")
    term = args.termination or 0
    slab = slabs[term]
    if args.orthogonal_c_reason:
        tilt_before = c_ab_tilt_deg(slab)
        slab = slab.get_orthogonal_c_slab()
        tilt_after = c_ab_tilt_deg(slab)
        print(
            "\nWARNING: applied Slab.get_orthogonal_c_slab() explicit fallback. "
            "This can break inherent slab symmetries and is not required for ordinary surface energies. "
            f"reason={args.orthogonal_c_reason!r}; "
            f"tilt before={tilt_before:.2f} deg, after={tilt_after:.2f} deg. "
            "Run audit_structure.py before engine handoff.",
            file=sys.stderr,
        )
    slab = slab.get_sorted_structure()
    tilt = c_ab_tilt_deg(slab)
    if args.max_slab_tilt_deg > 0 and tilt > args.max_slab_tilt_deg:
        print(
            "\nWARNING: slab c vector is not perpendicular to both a and b "
            f"(alpha={slab.lattice.alpha:.2f} deg, beta={slab.lattice.beta:.2f} deg; "
            f"max deviation {tilt:.2f} deg > {args.max_slab_tilt_deg:.2f} deg). "
            f"Generation used max_normal_search={max_normal_search}. "
            "Do not hard-rotate or orthogonalize first. Re-check whether the input is the intended "
            "conventional cell, keep SlabGenerator primitive=False, use/adjust max_normal_search, "
            "and verify the Miller cut, surface normal, wrapping, and vacuum estimate before engine handoff. "
            "Use --orthogonal-c-reason only if an orthogonal c fallback is explicitly justified.",
            file=sys.stderr,
        )

    # selective dynamics: freeze atoms in the lower fraction of the slab span
    zs = [site.frac_coords[2] for site in slab]
    zmin, zmax = min(zs), max(zs)
    cut = zmin + args.fix_below * (zmax - zmin)
    sd = [[z > cut + 1e-6] * 3 for z in zs]
    n_fixed = sum(1 for f in sd if not f[0])

    Poscar(slab, selective_dynamics=sd).write_file(args.out)
    print(f"\nwrote {args.out} (termination {term}): {slab.composition.reduced_formula}, "
          f"{len(slab)} atoms, {n_fixed} frozen (bottom {args.fix_below:g} of slab height)")
    print(f"slab settings: primitive=False max_normal_search={max_normal_search} reorient_lattice=True")
    print(f"species order: {[str(e) for e in slab.composition.elements]} "
          "- POTCAR must match this order")


if __name__ == "__main__":
    main()
