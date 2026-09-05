# Running Electronic-Structure Analysis in VASP

> Load this when: producing the VASP files for charge/Bader, charge-density difference, partial charge density, work function, or ELF — the INCAR tags and the commands. For *interpreting* the results (what each observable proves, evidence chains, oxidation-state caveats), see `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`. For rendering CHGCAR-like fields, `volumetric-visualization.md`; for VASPKIT extraction, `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/electronic-analysis.md`.

Each task below is a post-processing run from a converged static. Keep settings consistent across
the runs you compare. The *meaning* of every output lives in the knowledge doc above.

## Bader charge

All-electron reference, then partition:

```ini
LCHARG = .TRUE.
LAECHG = .TRUE.
PREC   = Accurate
```

```bash
chgsum.pl AECCAR0 AECCAR2
bader CHGCAR -ref CHGCAR_sum
uv run scripts/bader_summary.py RUNDIR        # per-element mean q (= ZVAL - N_Bader) + the per-atom spread
```

`scripts/bader_summary.py` reads `ACF.dat` + POSCAR/CONTCAR + POTCAR `ZVAL` (or `--zval "Pt:10,O:6"`) and reports net charge per element with the **per-atom spread** — the spread is the point: when it exceeds the difference between the structures you are comparing, the charge is a weak oxidation-state discriminator (`__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`). Use it to feed the atoms-colored-by-charge figure too.

Do **not** use `bader CHGCAR` alone for a charge-state claim (plain `CHGCAR` is valence-only; it
omits core density). Preserve `ACF.dat`, `BCF.dat`, `AVF.dat`, `CHGCAR_sum`, the POTCAR `ZVAL`
counts, and the static structure. Reported ionic charge ≈ `ZVAL − Bader_electrons` (a relative,
model-dependent number — see the knowledge doc; it is not a formal oxidation state). For magnetic
runs, `chgsplit.pl CHGCAR` separates total and magnetization components for a spin-density plot.

## Charge-density difference

```text
Δρ = ρ(combined) − ρ(fragment A in combined geometry) − ρ(fragment B in combined geometry)
```

1. Relax the combined system.
2. High-quality static for the combined system, `LCHARG=.TRUE.`, production grid.
3. Build fragments by **deleting** the other fragment from the relaxed combined geometry — keep the same cell, retained-fragment positions, ENCUT, FFT grid, k-mesh, smearing, spin policy, functional.
4. Do **not** relax fragments (that changes the reference question).
5. Subtract with a structured, reproducible route (VASPKIT task 314 is a common
   choice) and preserve the CHGCAR-like difference file, commonly `CHGDIFF.vasp`, plus
   the source files, sign convention, grid checks, and command/log provenance.
6. Plot isosurfaces and, for slabs/interfaces, the planar average of Δρ.

When Δρ is requested to explain adsorption, interface, metal-support, dopant/defect,
or other bonding/charge-transfer interactions, treat it as a one-way trigger for the
interaction evidence bundle: also run partner DOS/PDOS from `references/dos-band.md`
on the same relaxed combined structure, with the interacting atoms/orbitals overlaid on
one shared `E - E_F` axis. Ordinary DOS/PDOS requests do not require Δρ unless the
claim explicitly needs spatial charge redistribution.

For report-level figures, do not hide the subtraction inside a one-off plotting or
result-parsing script. The accepted figure artifact should show that the workflow read
`__NEBULAMAT_AICC_ROOT__/tools/vasp/references/electronic-analysis.md`, recorded the density-difference source
and sign/grid provenance, and rendered the resulting CHGCAR-like file through
`__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md`.

## Partial charge density (`PARCHG`)

Isolates selected bands/k-points/energy windows from a converged `WAVECAR` (not a new SCF). Use
`EIGENVAL`/`PROCAR`/DOS to pick the band/k indices first; include **all** degenerate bands together.

```ini
# selected bands + k-point
ISTART=1
LPARD=.TRUE.
IBAND=20 21 22 23
KPUSE=1
LSEPB=.TRUE.
LSEPK=.TRUE.
```

```ini
# absolute energy window
ISTART=1
LPARD=.TRUE.
NBMOD=-2
EINT=-10.0 -5.0
```

```ini
# Fermi-relative occupied window
ISTART=1
LPARD=.TRUE.
NBMOD=-3
EINT=-1.0
```

VASPKIT can also turn `WAVECAR` into real-space wavefunctions/orbital charge density; record band, k-point, spin channel, and energy reference.

## Work function (electrostatic potential)

```ini
LVHAR  = .TRUE.
LDIPOL = .TRUE.   # only when the dipole correction is intentionally part of the work-function run
IDIPOL = 3        # vacuum along z
```

`Φ = E_vac − E_F` from the `LOCPOT` planar-average vacuum plateau. Prefer the electrostatic/Hartree
potential (`LVHAR`) over the full potential (`LVTOT` includes XC). Ensure enough vacuum for a flat
plateau and document the dipole status. **`LDIPOL=.TRUE.`/`IDIPOL=3` makes slab SCF harder — do not
carry it into routine slab relaxations or adsorption-energy runs** unless the correction is needed.

## ELF

```ini
LELF = .TRUE.
PREC = Accurate
```

`ELFCAR` is CHGCAR-like (isosurfaces/slices). Some VASP builds produce inconsistent grids with
certain parallel settings — if so, drop `NPAR`/`NCORE` and rerun a small validation. PAW may omit
core-electron localization.

## Visualization

- Volumetric fields (`CHGCAR`, `PARCHG`, `ELFCAR`, `LOCPOT`, Δρ): VESTA interactively, or `references/volumetric-visualization.md` for reproducible headless PyVista rendering and 2D slices. State the Δρ sign convention (which color is accumulation).
- Atoms colored by Bader charge (`q = ZVAL − Bader_electrons`): build a structure file with the per-atom charge and color in OVITO (`__NEBULAMAT_AICC_ROOT__/tools/ovito`); keep a fixed, recorded color scale across compared structures, and the same atom mapping as `ACF.dat`.

## Minimum validation checklist (operation)

- Upstream runs converged and use comparable settings.
- Δρ fragments share cell/grid/geometry/settings with the combined run.
- If Δρ supports an interaction claim, partner DOS/PDOS selections and energy alignment
  are included, or a visible limitation explains why they are absent.
- Bader used `AECCAR0+AECCAR2` when charge states are discussed.
- DOS/PDOS and partial-charge plots have a documented energy zero and spin channel.
- Degenerate band edges treated as a group.
- Work-function plots show a real vacuum plateau and dipole status.

*Interpretation, evidence chains, and Bader-to-structure figure rules: `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`.*
