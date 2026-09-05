#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymatgen"]
# ///
"""Place an adsorbate on a slab at the distinct surface sites — a runnable wrapper for
pymatgen's AdsorbateSiteFinder, so you don't hand-roll adsorbate docking.

Enumerates the symmetry-distinct ontop/bridge/hollow sites (incl. ontop of a single-atom
site on a *relaxed* slab), writes one POSCAR per site with selective dynamics (bottom
frozen, top layers + adsorbate free), and reports the nearest adsorbate-surface distance
per site so you can sanity-check the geometry. Then relax ALL of them and compare — the
lowest-coordination/first site is often not the real minimum (see references/running.md).

Usage:
  uv run place_adsorbate.py SLAB ADSORBATE [opts]
    SLAB        slab POSCAR/CONTCAR/CIF (ideal or already-relaxed)
    ADSORBATE   an element symbol for an atomic adsorbate (H, O, N, ...) OR a .xyz file
                (build a molecule first with smiles_to_xyz.py, or supply your own)
  --height H        initial adsorbate-surface distance, A (default 2.0)
  --sites WHICH     all | ontop | bridge | hollow  (default all distinct)
  --fix-below F     selective dynamics: freeze atoms below fractional z F (default 0.45)
  --out-prefix P    output dirs P00/POSCAR, P01/POSCAR, ... (default 'ads')
  --max-sites N     cap the number of sites written (default 12)
Exit: 0 ok, 2 error.
"""
import argparse, os, sys


def build_adsorbate(spec):
    from pymatgen.core import Molecule
    if os.path.isfile(spec):
        return Molecule.from_file(spec)
    if spec.isalpha() and 1 <= len(spec) <= 2:  # single-atom adsorbate
        return Molecule([spec], [[0.0, 0.0, 0.0]])
    raise SystemExit(f"ADSORBATE must be an element symbol or an .xyz file, got {spec!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slab"); ap.add_argument("adsorbate")
    ap.add_argument("--height", type=float, default=2.0)
    ap.add_argument("--sites", choices=["all", "ontop", "bridge", "hollow"], default="all")
    ap.add_argument("--fix-below", type=float, default=0.45)
    ap.add_argument("--out-prefix", default="ads")
    ap.add_argument("--max-sites", type=int, default=12)
    a = ap.parse_args()

    try:
        from pymatgen.core import Structure
        from pymatgen.io.vasp import Poscar
        from pymatgen.analysis.adsorption import AdsorbateSiteFinder
    except Exception as exc:
        print(f"failed to import pymatgen: {exc}  (run via `uv run place_adsorbate.py ...`)", file=sys.stderr)
        return 2

    if not os.path.isfile(a.slab):
        print(f"slab not found: {a.slab}", file=sys.stderr); return 2
    slab = Structure.from_file(a.slab)
    mol = build_adsorbate(a.adsorbate)
    try:
        asf = AdsorbateSiteFinder(slab)
        structs = asf.generate_adsorption_structures(
            mol, find_args={"distance": a.height, "positions": (["ontop", "bridge", "hollow"]
                            if a.sites == "all" else [a.sites])})
    except Exception as exc:
        print(f"AdsorbateSiteFinder failed: {exc}\n"
              "  - is the input a slab (vacuum along c)? for a bulk, cut a slab first (make_slab.py)",
              file=sys.stderr)
        return 2
    if not structs:
        print("no adsorption sites found (check the slab orientation / surface)", file=sys.stderr); return 2

    n_slab = len(slab)
    nads = len(mol)
    written = 0
    print(f"{len(structs)} symmetry-distinct site(s) found ({a.sites}); writing up to {a.max_sites}:")
    for i, st in enumerate(structs[: a.max_sites]):
        # selective dynamics: free adsorbate (last nads atoms) + anything above fix-below
        sd = [[bool(s.frac_coords[2] >= a.fix_below)] * 3 for s in st]
        for j in range(len(st) - nads, len(st)):
            sd[j] = [True, True, True]
        st.add_site_property("selective_dynamics", sd)
        # nearest adsorbate-slab distance (binding-distance sanity check)
        dm = st.distance_matrix
        ads_idx = range(len(st) - nads, len(st))
        nearest = min(dm[j][k] for j in ads_idx for k in range(n_slab))
        d = f"{a.out_prefix}{i:02d}"
        os.makedirs(d, exist_ok=True)
        Poscar(st).write_file(f"{d}/POSCAR")
        print(f"  {d}/POSCAR  nearest adsorbate-surface = {nearest:.2f} A")
        written += 1
    print(f"wrote {written} structure(s). Relax ALL and compare — don't trust the first/lowest-"
          "coordination site; report which sites you compared and the resulting coordination.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
