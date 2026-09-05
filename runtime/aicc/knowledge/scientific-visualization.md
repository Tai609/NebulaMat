# Scientific Visualization and Figure Choice

> Covers: choosing appropriate tools and minimum quality standards for computational-chemistry figures, including atomistic structure renders, volumetric charge-density figures, molecular wavefunction-style plots, and numerical plots.

Tool-agnostic figure strategy. Use this before making a figure for a report, SI, response letter, or manuscript-style comparison. The goal is not to make a quick screenshot; it is to choose a rendering path that preserves the scientific object, makes the visual claim auditable, and records enough parameters to reproduce the figure.

## Default tool choices

| Figure target | Preferred path | Why |
|---|---|---|
| atomistic structure, slab, cluster, trajectory frame | OVITO Python, usually Tachyon renderer | good camera control, CPK/ball-and-stick styles, bonds, colors, headless rendering |
| quick structure orientation check | ASE direct PNG writer | fast side/top/isometric previews before final styling |
| charge-density difference, spin density, ELF, PARCHG, CHGCAR-like fields | PyVista + pymatgen for scripted renders; VESTA for interactive inspection | reproducible isosurfaces/slices, fixed camera, batch comparison |
| DOS, bands, free-energy diagrams, volcano plots, kinetic maps | Matplotlib or the domain tool output post-processed with Matplotlib | full control of axes, units, labels, legends, and styles |
| molecular orbitals, NCI/IRI/ELF/AIM-style molecular analyses | `__NEBULAMAT_AICC_ROOT__/tools/multiwfn` (fields/analysis) + VMD for isosurface rendering | the molecular wavefunction-analysis stack; see `__NEBULAMAT_AICC_ROOT__/tools/multiwfn/SKILL.md` |
| COHP/COOP bonding plots | LOBSTER outputs + Matplotlib; interpretation in [bonding-analysis.md](bonding-analysis.md) | sign conventions and energy zero must be explicit |

## Figure quality floor

Every scientific figure should have a stated source, a reproducible script or workflow, and a nonblank output check. A generated image is not usable until it has been visually inspected for framing, orientation, color meaning, and whether the shown object actually supports the claim.

Minimum records:

- source structure/data path and how it was produced;
- software path and version, or module/environment name;
- camera/view, projection, image size, and frame number when relevant;
- atom colors, radii, bond cutoffs, isovalues, color limits, or plotting ranges;
- sign convention for density differences, spin channels, COHP vs `-COHP`, and energy zero;
- whether the output is exploratory, SI-ready, or publication-ready.

## Atomistic structure figures

For slabs, clusters, defects, adsorbates, and trajectory frames, prefer OVITO over ad hoc screenshots. Use CPK-filled views for compact structural identity and ball-and-stick views when connectivity is the point. Bonds are figure parameters, not proof of bonding; report pairwise cutoffs when using generated bonds.

Practical routing:

- first make a quick ASE side/top/isometric PNG if orientation is uncertain;
- use OVITO CPK for filled atomic-sphere figures;
- use OVITO + `CreateBondsModifier` with pairwise cutoffs for ball-and-stick;
- use Tachyon renderer for reproducible headless images;
- inspect whether the surface normal, adsorbate, defect, or active site is actually visible.

Avoid default viewer screenshots for final figures unless the exact view and style are recorded. Do not let atom labels, oversized radii, or arbitrary bonds hide the chemically important region.

**Model figures use the relaxed final structure and are orthographic top + side, not perspective.** For VASP relaxation products, render `CONTCAR`, not the initial `POSCAR`, unless `POSCAR` is explicitly a copy of the final geometry. A perspective camera distorts distances and layer spacings, so it cannot be read quantitatively — exactly what a reader needs from a model figure. Render an orthographic **top** view (down the surface normal) *and* a **side** view (along the surface, layers stacked vertically) for every model; reserve perspective for a decorative overview, never for the figure that carries the geometry. (`__NEBULAMAT_AICC_ROOT__/tools/ovito` `--view top|side --projection ortho`.) For reports, assemble the two views left-to-right into one `(a)`/`(b)` figure with `(a)` top on the left and `(b)` side on the right. Zoom or crop the side-view panel to the slab/adsorbate/active-site region and remove empty vacuum unless the vacuum/cell height is part of the claim.

## What humans read: relative energies and data-on-the-structure

These are presentation rules for the final report, learned from real reviewer feedback. They are enforced by `__NEBULAMAT_AICC_ROOT__/tools/report/references/validation.md`.

- **Report relative energies, never bare total energies.** A DFT total energy (TOTEN, hundreds of eV) is meaningless to a reader; humans read *differences* — adsorption energy, binding energy, reaction energy (ΔE/ΔG), and barriers. Convert before reporting and state the reference state (gas-phase molecule, clean slab, bulk metal, or the appropriate μ reservoir). A results table of total energies is a workflow artifact, not a deliverable.
- **Pair every quantitative claim with the figure that shows it.** A Bader charge, an oxidation state, a key bond length is shown *on the structure* — atoms colored by the quantity with a colorbar, and the few decisive atoms labeled with their value — not presented only as a number in a table. The structure figure is the evidence; the table is the backup. (`__NEBULAMAT_AICC_ROOT__/tools/ovito` `--color-by`.)
- **Do not hide element identity when coloring by a property.** A Bader-charge or other property-colored structure should be paired with the same-view plain element-colored render in one `(a)`/`(b)` panel, using the same camera, projection, crop/zoom, and labels.
- **Combine structure + charge (+ DOS) when the argument is electronic.** A reducibility / charge-transfer / band-character claim reads best as a multi-panel figure: the colored structure beside the relevant PDOS, so the spatial and electronic pictures sit together. Still subject to the rule below — neither a colored isosurface nor a charge color map alone proves charge transfer (`electronic-structure.md`).

## Volumetric and density figures

For `CHGCAR`, `CHGDIFF`, `PARCHG`, `ELFCAR`, spin density, and VASPKIT-generated CHGCAR-like files, use the VASP volumetric visualization workflow ([__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md](__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md)) rather than generic structure rendering. PyVista is the scripted route; VESTA is useful for manual inspection and final tuning.

Rules:

- define the density mathematically, e.g. `Delta rho = rho(combined) - rho(fragment A) - rho(fragment B)`;
- use equal positive and negative isosurface magnitudes unless a documented reason exists;
- record isovalue, colors, opacity, camera, and whether projection is orthographic;
- for 2D slices, record atom indices defining the plane, interpolation, and color clipping;
- never infer charge-transfer magnitude from an isosurface alone; pair it with Bader/DDEC, PDOS, work function, spin density, or COHP as appropriate.

## Numerical plots

For line plots, bar charts, maps, and phase diagrams, use Matplotlib or a domain tool that exports data cleanly. The scientific standard is axis clarity, not decoration.

Requirements:

- axis labels include quantity and units;
- energy zero/reference state is explicit;
- temperature, pressure, coverage, descriptor, or normalization is stated when relevant;
- comparison series use consistent color and marker semantics;
- raw points are preserved when fits, envelopes, or smoothed curves are shown.

## Molecular visualization path

For molecule-centered orbital, electrostatic potential, AIM, NCI/IRI, ELF, or weak-interaction figures, use `__NEBULAMAT_AICC_ROOT__/tools/multiwfn/` (the dedicated wavefunction-analysis skill) and keep it separate from atomistic OVITO rendering. Multiwfn generates the molecular scalar fields and analysis outputs; VMD is often used for isosurface rendering and molecular-style presentation.

Until then, record the intended analysis type, input wavefunction/density file, functional/basis, isovalue, color convention, and renderer. Do not mix molecular orbital-style figures with periodic charge-density figures without stating the different reference and file conventions.

## Common failure modes

- using a quick screenshot as a final structure figure;
- choosing global bond cutoffs that create unphysical metal-metal or adsorbate-support bonds;
- omitting the density sign convention or showing unequal isosurfaces without explanation;
- plotting spin-down as negative without saying it is a visualization convention;
- changing camera, isovalue, or color scale across a comparison series;
- reporting a visually attractive figure without the underlying validated calculation provenance.
