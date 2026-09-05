# VASPKIT Electronic-Analysis Workflows

> Load this when: using VASPKIT for charge-density difference, spin density, planar averages, work functions, Bader visualization helpers, partial charge density, or real-space wavefunction/orbital plots. Pair this with `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` for the scientific interpretation, `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/electronic-analysis.md` for the VASP-side run settings, and `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md` for PyVista/VESTA-style rendering of generated CHGCAR-like files.

Task numbers can shift between VASPKIT releases. Confirm the local menu before automating, and record the VASPKIT version, task ID, menu answers, input files, and output files.

When a final report includes a VASP volumetric figure (`CHGCAR`, `CHGDIFF`, `PARCHG`,
`ELFCAR`, spin density, Delta rho / charge-density difference, or wavefunction/WAVECAR
derived grids) and VASPKIT was used, the accepted figure artifact should keep the
version, task ID, exact menu input or automation transcript, source files, generated
CHGCAR-like output, and downstream `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md`
rendering provenance. VASPKIT is not mandatory for every volumetric figure, but a
VASPKIT-derived figure without its task/log/menu provenance is not reproducible.

## Task map

| Goal | Common task ID | Main inputs | Main outputs / checks |
|---|---:|---|---|
| spin density | 312 | spin-polarized `CHGCAR` or compatible charge file | spin-density CHGCAR-like file for positive/negative isosurfaces or slices |
| charge-density difference | 314 | `CHGCAR` files for combined system and fragments | `CHGDIFF.vasp` or equivalent density-difference file |
| planar average of charge density or `Delta rho` | 316 | `CHGCAR`-format file, often renamed from `CHGDIFF.vasp` | `CHGPAVG.dat`; integrated accumulation/depletion trend |
| work function / planar electrostatic potential | 426 | `LOCPOT`, `OUTCAR`, slab geometry | `POTPAVG.dat`, vacuum level, work function |
| Bader charge visualization helper | 508 | Bader output such as `ACF.dat`, structure files | charge-bearing structure file such as `bader.pqr` |
| real-space wavefunction | 511 | `WAVECAR`, `EIGENVAL`/band index context | real-space wavefunction for selected k-point/band, e.g. `WFN_REAL_B0005_K0001.vasp` |
| real-space orbital/partial charge density | 515 | `WAVECAR`, selected k-point/band or state context | orbital charge-density grid for visualization |

## Spin density with task 312

Use this for spin-polarized charge rearrangement or magnetic-state visualization when the upstream calculation is converged and the spin channel is meaningful. The generated spin-density file is a CHGCAR-like volumetric target: render positive and negative isosurfaces with equal magnitude, or make 2D slices through the magnetic center or adsorbate bond.

Record the VASPKIT version, exact task ID, prompt answers, source `CHGCAR`/spin-polarized run, and output filename. For PyVista rendering of the generated file, load `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md`.

## Charge-density difference with task 314

Use this for `Delta rho = rho_AB - rho_A - rho_B`, where `rho_A` and `rho_B` are computed from fragments frozen in the combined geometry.

Preflight:

- Combined and fragment calculations use identical cell, FFT grid, ENCUT, k-mesh, smearing, spin policy, and functional.
- Fragment POSCARs come from the relaxed combined structure with the other fragment removed; they are not separately relaxed.
- The `CHGCAR` files are complete and non-empty.

Interactive pattern:

```bash
vaspkit
# choose charge-density difference task, usually 314
# provide CHGCAR paths in the sign convention requested by the menu
```

For a known local menu sequence, record it and then automate with `printf`, for example:

```bash
printf '314\n./combined/CHGCAR\n./adsorbate/CHGCAR\n./slab/CHGCAR\n' | vaspkit > vaspkit.314.log 2>&1
```

Check the installed VASPKIT prompt order before using this exact sequence; some versions ask for the number of fragments or output name first.

Interpretation:

- Positive and negative isosurfaces identify accumulation and depletion regions.
- Use the same isosurface value and color scale for related structures.
- Do not report an isosurface image as a transferred electron count; combine it with Bader and planar-average integration if charge transfer is the claim.

## Planar averages with task 316

For slab/interface systems, a planar average of `Delta rho` often communicates charge rearrangement better than a 3D isosurface. If the difference file is written as `CHGDIFF.vasp`, either provide it directly if the menu accepts it or copy/rename it to the expected CHGCAR-style input name in a scratch directory.

Typical workflow:

```bash
printf '316\n3\n' | vaspkit > vaspkit.316.log 2>&1
```

Here `3` means average along the z direction in common VASPKIT menus. Confirm the prompt locally. Inspect `CHGPAVG.dat`; for electron-transfer discussions, plot both `Delta rho(z)` and the integrated curve if available.

## Work function and electrostatic potential with task 426

Use this after a static slab calculation with `LVHAR=.TRUE.` and a meaningful vacuum region. For asymmetric slabs or polar adsorbates, record `LDIPOL` and `IDIPOL`.

Typical workflow:

```bash
printf '426\n3\n' | vaspkit > vaspkit.426.log 2>&1
```

Validation:

- `POTPAVG.dat` has a flat vacuum plateau.
- The chosen direction is the slab normal.
- The Fermi level source is recorded.
- If two vacuum levels exist, report which side is used or report both.
- Vacuum thickness and dipole correction are converged enough for the claimed trend.

## Bader charge coloring with task 508

Run Bader first with an all-electron reference:

```bash
chgsum.pl AECCAR0 AECCAR2
bader CHGCAR -ref CHGCAR_sum
```

Then use the VASPKIT Bader helper task, commonly 508, to generate a charge-bearing visualization file such as `bader.pqr`.

Typical usage:

```bash
printf '508\n' | vaspkit > vaspkit.508.log 2>&1
```

Visualization guidance:

- In VMD or another viewer, color atoms by the charge field and use a fixed charge range across compared structures.
- For element-resolved comparisons, plot both the colored structure and a table of Bader charges by atom/site.
- State whether the plotted value is Bader electron count, net charge (`ZVAL - electrons`), or a normalized difference from a reference state.

## Real-space wavefunctions and orbital charge

Use VASPKIT real-space tasks when `WAVECAR` exists and the state index is known. Identify the band/k-point/spin from `EIGENVAL`, `PROCAR`, band plots, or DOS/PDOS before plotting.

Real-space wavefunction, commonly task 511:

```bash
printf '51\n511\n1\n20\n' | vaspkit > vaspkit.511.log 2>&1
```

Real-space orbital/partial charge density, commonly task 515:

```bash
printf '51\n515\n1\n20\n' | vaspkit > vaspkit.515.log 2>&1
```

The exact submenu and prompt sequence vary by version; confirm interactively. Record spin channel, k-point index, band index, energy, output filename such as `WFN_REAL_B0005_K0001.vasp`, and whether equivalent degenerate bands were merged. For PyVista rendering of the generated CHGCAR-like file, load `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md`.

Use cases:

- VBM/CBM localization in semiconductors and oxides.
- Defect-state localization and spin-polarized defect levels.
- Adsorbate frontier orbital mixing with slab states.
- STM-like occupied or empty state windows, with careful bias interpretation.

## Relation to VASP `PARCHG`

VASPKIT wavefunction/orbital tasks are convenient, but VASP can also write partial charge density directly with `LPARD=.TRUE.` and a converged `WAVECAR`. Use VASP `PARCHG` when the analysis needs a controlled band/energy window (`IBAND`, `KPUSE`, `NBMOD`, `EINT`, `LSEPB`, `LSEPK`). Use VASPKIT when a quick state-resolved real-space export or visualization-friendly conversion is enough.

## Red flags

- Fragment `CHGCAR` grids differ from the combined system.
- A Bader-colored image is used as the only evidence for charge transfer.
- Band/k-point indices are guessed without checking `EIGENVAL`, `PROCAR`, or a band plot.
- Degenerate VBM/CBM states are plotted one at a time and interpreted as real symmetry breaking.
- Work-function output is accepted without inspecting the vacuum plateau.
- VASPKIT task logs are missing, making menu choices unreproducible.
