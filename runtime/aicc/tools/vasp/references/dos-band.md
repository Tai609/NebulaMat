# Running DOS and Band Structure in VASP

> Load this when: setting up a VASP DOS/PDOS or band-structure run — INCAR blocks, k-point strategy, smearing, the non-SCF band workflow. For *interpreting* the result (PDOS meaning, energy alignment, d-band center, adsorbate orbital analysis), see `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`. For VASPKIT extraction/d-band-center menus, also load `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/dos-band.md`.

DOS/band runs are **post-relaxation** electronic analyses. Do not use DOS averaged over a
relaxation trajectory — start from the optimized structure, run a clean static, then run the
DOS/band task with controlled k-points and a documented energy reference.

## DOS calculation workflow

1. Relax to the intended force/cell criteria.
2. Make a separate DOS directory from the **final** structure (not a mid-relaxation POSCAR).
3. Increase k-point density vs the relaxation/static run when the cell is not Gamma-only.
4. Run a static DOS with `NSW=0`, `LORBIT=11`, appropriate smearing.
5. Extract total DOS, integrated DOS, atom/element/orbital PDOS, and spin channels as needed.

```ini
NSW    = 0
LORBIT = 11
NEDOS  = 1000
EDIFF  = 1E-6
# ICHARG = 11    # read CHGCAR for a non-SCF DOS; ICHARG=1 for a fresh static SCF
# NBANDS = ...   # raise only when higher unoccupied states are needed (grep NBANDS OUTCAR)
# EMIN/EMAX      # usually default; set only for a fixed window across a figure set
```

**Smearing:**
- `ISMEAR=-5` (tetrahedron) — best accuracy for well-sampled bulk DOS, but fails for too few irreducible k-points (especially Gamma-only).
- `ISMEAR=0`, `SIGMA=0.05` — safer for molecules, few-k slabs, large cells, qualitative DOS.
- `ISMEAR=1` — acceptable for metallic exploratory DOS; check the plot isn't dominated by artificial broadening.

If a DOS plot is noisy, **increase the k-mesh first**. Raising `NEDOS` only samples the same rough
curve more finely — it does not fix insufficient k-points. `NEDOS=1000–2000` suits most plots;
very large values bloat `DOSCAR`/`vasprun.xml` without adding physics.

## Band-structure k-point strategy

A uniform mesh builds the charge density; a high-symmetry path does not. Two routes:

1. **Semilocal:** converged uniform-mesh static first, then a non-SCF band run with `ICHARG=11` reading the fixed `CHGCAR` and a line-mode KPOINTS path.
2. **Hybrid (HSE):** a KPOINTS file with the uniform SCF mesh **plus zero-weight** high-symmetry path points (the simple `ICHARG=11` route is not valid for hybrids). This also works for semilocal functionals.

For supercells, band folding complicates comparison with primitive bands; use band unfolding only when the question needs primitive-cell spectral character.

## DOSCAR format (mechanics)

- `ISPIN=1`: energy, DOS, integrated DOS. `ISPIN=2`: spin-up/down DOS + integrated values.
- `LORBIT=11`: magnetic-component PDOS (`s`, `px/py/pz`, `dxy…`); `LORBIT=10`: coarser s/p/d/f.
- Fermi energy: `grep E-fermi OUTCAR`.

*What the projections mean and how to align/compare them — `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`.*

## Multi-atom PDOS for covalent interactions (overlay, don't isolate)

A single-atom PDOS rarely shows a *bond*. To reveal a covalent interaction, **overlay the PDOS of the interacting partners on one shared `E − E_F` axis** so their hybridizing peaks line up. Standard groupings:

- **adsorbate–metal bond** (e.g. CO on a metal site): plot the **metal d** with the **adsorbate levels** (for CO, `C p` + `O p`). Overlapping metal-d / adsorbate peaks = the bond; intensity in the CO 2π* region around/above E_F = back-donation (and tracks an adsorbate-stretch red-shift). When a promoter/dopant is present, compare with and without it as side-by-side panels on the *same* axis.
- **a site + its ligands**: plot the central atom's relevant orbitals (metal `d`, lanthanide `f`, main-group `s/p`) with the **surrounding coordinating atoms** (e.g. the surface O it bonds to); aligned, overlapping peaks show covalency vs a purely ionic (non-overlapping) picture.
- always **align to `E − E_F`** (subtract each run's Fermi level), keep the same energy window and broadening across panels, and plot spin channels consistently.

Extract per-site `s/p/d/f` PDOS from a `LORBIT=11` static (pymatgen `CompleteDos.get_site_spd_dos` on `vasprun.xml`, or VASPKIT), sum the partners, shift by `E_F`. This "combine the single atom + its O / adsorbed CO or H₂O, aligned to E−E_F" view is what makes the covalent interaction legible — prefer it over an isolated single-atom DOS.

## Minimum reporting checklist (operation)

- Optimized-structure source; whether the DOS/band run is SCF or non-SCF.
- `ISMEAR`, `SIGMA`, `NEDOS`, `LORBIT`, k-mesh/path, `NBANDS` if changed.
- Energy zero and alignment method; PDOS atom/element/orbital/spin/layer selections.
- Whether spin-down was plotted as negative.
