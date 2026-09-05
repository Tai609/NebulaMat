# Running Electronic-Structure Analysis in CP2K

> Load this when: producing CP2K files for DOS/PDOS, band structures, molecular orbitals, Molden/Multiwfn analysis, cube fields, charge-density difference, work function, ELF, spin density, d-band center, charges, or visualization. For interpretation discipline, also read `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`, `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`, and `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md`.

Each task below is an operation recipe from a converged ground-state calculation. Keep settings consistent across compared systems; the *meaning* of every observable lives in the knowledge docs.

## Ground-state prerequisites

Before any electronic analysis:

- SCF is converged and the output passes `uv run scripts/parse_cp2k.py`.
- Functional, dispersion, basis, potential, grid, k-policy, charge, spin, U/hybrid, and smearing are recorded.
- Empty-state policy is explicit: `&SCF ADDED_MOS` + diagonalization or a version-supported post-SCF empty-state path.
- Energy zero is chosen: Fermi level, HOCO/VBM, vacuum level, deep reference, or user-defined shift.
- For slabs/interfaces, electrostatics and vacuum are converged enough for the quantity being plotted.

## DOS and PDOS

For older CP2K versions, DOS/PDOS is commonly printed as `.pdos`-style files and plotted/convolved externally. Recent CP2K versions also provide a broadened `&DOS` interface; verify the exact keyword path against the installed manual before using a template.

Typical operational pattern for PDOS with explicit empty states:

```text
&DFT
  &SCF
    ADDED_MOS 100              # adjust
    &DIAGONALIZATION
      ALGORITHM STANDARD
    &END DIAGONALIZATION
    &SMEAR
      METHOD FERMI_DIRAC
      ELECTRONIC_TEMPERATURE [K] 300
    &END SMEAR
    &MIXING
      METHOD BROYDEN_MIXING
      ALPHA 0.2
    &END MIXING
  &END SCF
  &PRINT
    &PDOS
      NLUMO -1                 # print all available unoccupied MOs when supported
      COMPONENTS T
      &EACH
        QS_SCF 0
      &END EACH
    &END PDOS
  &END PRINT
&END DFT
```

Rules:

- `.pdos` files in classic workflows use Hartree energy units; convert to eV before plotting unless the file states otherwise.
- PDOS needs convolution/broadening. The chosen width changes line shape and apparent peak overlap; it is not a physical linewidth by itself.
- For metals and small gaps, use smearing deliberately and state the electronic temperature.
- For spin-polarized systems, plot both spin channels and state whether spin-down is plotted negative only as a convention.
- Do not integrate CP2K PDOS as a rigorous oxidation-state or orbital-occupation proof; combine with charges, spin density, ELF, or bonding analysis.

## Band structure

Use a converged ground state, then a single-point band calculation with a documented high-symmetry path. Prefer SeeK-path or a symmetry-aware structure tool for the path. Do **not** take a `.bs` file from an optimization trajectory because band data can be appended at multiple geometry steps.

Template shape:

```text
&DFT
  &SCF
    ADDED_MOS 50               # SCF virtual space; adjust for unoccupied bands
    &DIAGONALIZATION
      ALGORITHM STANDARD
    &END DIAGONALIZATION
  &END SCF
  &PRINT
    &BAND_STRUCTURE
      FILE_NAME band.bs
      &KPOINT_SET
        UNITS B_VECTOR
        SPECIAL_POINT GAMMA 0.0 0.0 0.0
        SPECIAL_POINT X     0.5 0.0 0.0
        NPOINTS 20
      &END KPOINT_SET
    &END BAND_STRUCTURE
  &END PRINT
&END DFT
```

Rules:

- `&SCF ADDED_MOS` controls the virtual orbital space available to the SCF/diagonalization workflow. Current CP2K also has `&PRINT/&BAND_STRUCTURE ADDED_MOS` / `ADDED_BANDS`, which controls bands added to the printed band path. Keep the two meanings separate and check the installed manual before using the print-section keyword.
- `SPECIAL_POINT` coordinates are in the units declared in the band-structure section, often reciprocal-lattice vector coordinates.
- A band path is not a regular Monkhorst-Pack SCF mesh; keep the SCF mesh/provenance separate from the plotted path.
- For a semiconductor/insulator, record whether the gap is direct/indirect and how HOCO/LUCO or VBM/CBM were identified.
- For hybrids, k-point support and workflow depend on CP2K version and method (`RI-HFXk` exists for suitable workflows). Verify the installed manual and preserve the semilocal restart/provenance.

## Molecular orbitals and Molden

Useful print sections:

```text
&DFT
  &PRINT
    &MO_MOLDEN
      NDIGITS 9
    &END MO_MOLDEN
    &MO
      ENERGIES T
      OCCUPATION_NUMBERS T
      COEFFICIENTS F
      &EACH
        QS_SCF 0
      &END EACH
    &END MO
  &END PRINT
&END DFT
```

Rules:

- `MO_MOLDEN` is mainly for Gamma-only orbital visualization/post-processing. It is not a generic k-point orbital dump.
- For k-point calculations, use CP2K's k-point orbital output path when supported and treat the format as CP2K-specific.
- CP2K `.wfn` restart files are not quantum-chemistry `.wfn` analysis files.
- Multiwfn periodic analysis of CP2K Molden data may require adding `[Cell]` and pseudopotential valence metadata. Keep the modified analysis file separate from the raw CP2K output.
- MOs from smearing/partial occupations need careful interpretation; HOCO/LUCO and band gaps can be misleading if `ADDED_MOS`, smearing, or energy-zero choices are inconsistent.

## Cubes and real-space fields

Common outputs include density, spin density, electrostatic/Hartree potential, MO cubes, ELF, local energy/stress cubes, and XC/external-potential cubes depending on version.

Typical patterns:

```text
&DFT
  &PRINT
    &E_DENSITY_CUBE
      STRIDE 1 1 1
    &END E_DENSITY_CUBE
    &V_HARTREE_CUBE
      STRIDE 1 1 1
    &END V_HARTREE_CUBE
    &MO_CUBES
      NLUMO 2
      NHOMO 2
      STRIDE 1 1 1
    &END MO_CUBES
  &END PRINT
&END DFT
```

Rules:

- `STRIDE` changes the cube grid and file size. Do not compare/subtract cubes produced on different grids.
- For any difference field, generate all component densities with identical cell, grid, geometry, basis/potential, functional, charge/spin policy, and cube stride.
- Do not infer charge transfer, oxidation state, or bonding from one isosurface alone. Pair real-space fields with integrated charges, PDOS/bands, work function, or bonding analysis.

## Charge-density difference

```text
Δρ = ρ(AB) − ρ(A in AB geometry) − ρ(B in AB geometry)
```

Workflow:

1. Relax the combined system if the combined geometry is part of the claim.
2. Run a static density/cube calculation for `AB`.
3. Build fragments by deleting the other fragment from the combined geometry; do not relax fragments.
4. Keep cell, grid, functional, basis/potential, charge/spin policy, k-policy, smearing, and cube stride identical.
5. Subtract with `cubecruncher`, Multiwfn, or a reproducible script.
6. Plot both isosurfaces and, for slabs/interfaces, the planar average normal to the interface.

Preserve raw cubes, the subtraction command, sign convention, isovalue, and color convention.

## Work function and electrostatic profiles

For a slab work function:

```text
W = V_vacuum - E_F
```

CP2K-side outputs often needed:

```text
&DFT
  &PRINT
    &V_HARTREE_CUBE
      STRIDE 1 1 1
    &END V_HARTREE_CUBE
    &PDOS
    &END PDOS
  &END PRINT
&END DFT
```

Then compute a planar average of the Hartree/electrostatic potential along the slab normal. Rules:

- The vacuum region must show a real plateau; otherwise the cell/vacuum/electrostatics are not converged for a work-function claim.
- Asymmetric slabs can have two different vacuum plateaus; state which side is used.
- Dipole correction/electrostatic boundary conditions must be documented. Do not carry slab dipole settings into unrelated adsorption-energy calculations without a thermodynamic reason.
- Aligning band edges across unrelated cells should use vacuum/deep-reference alignment, not raw eigenvalues.

## Charges, oxidation state, and bonding

CP2K can print Mulliken, Lowdin, Hirshfeld-like, RESP/REPEAT-style, DFT+U occupations, and spin moments depending on the method/version.

Operational rules:

- Treat Mulliken/Lowdin populations as basis-dependent diagnostics, not formal oxidation states.
- For magnetic/oxidation-state claims, combine charge populations with spin density, local moments, DFT+U occupations, PDOS, and structure.
- For periodic bond order / overlap population analysis, Multiwfn can post-process suitable CP2K Molden files when cell and valence metadata are present.
- For pairwise bond-strength conclusions, use the `lobster` skill when a LOBSTER projection is the chosen method, or document the Multiwfn bond-order method if using it directly.

## d-band center and orbital descriptors

For surface catalysis descriptors, compute the d-band center from an active-site d-PDOS with a fixed energy zero and integration window:

```text
ε_d = ∫ E D_d(E) dE / ∫ D_d(E) dE
```

Rules:

- Use surface/active-site atoms, not bulk atoms, for adsorption trends.
- Use identical broadening, spin treatment, and energy window across the series.
- For spin-polarized systems, report spin-resolved values or define the averaging formula.
- Treat the descriptor as a trend aid, not a standalone proof of adsorption strength.

## Visualization tools

- Multiwfn: CP2K input generation, Molden/cube analysis, DOS/band plotting, orbital composition, d-band center, wavefunction and density analysis.
- VESTA: structures, cells, volumetric fields, slices and isosurfaces.
- VMD: trajectories, optimization/MD movies, NEB image inspection, cube visualization.
- GaussView/Jmol: molecule and vibration inspection when file formats are compatible.
- MfakeG: convert CP2K Molden vibration output to Gaussian-like files for some viewers.
- sobNEB: build and inspect NEB image paths before submission.

Preserve the raw output, converted files, exact conversion command, plotting script/settings, isovalues, color scales, and camera/view settings for reproducible figures.

## Minimum validation checklist

- Upstream ground-state run converged and matches the property workflow.
- Empty-state, smearing, spin, and energy-zero policies recorded.
- DOS/PDOS/band data are not appended from an optimization trajectory unless intentionally separated by geometry step.
- CDD cubes share cell/grid/geometry/settings and sign convention.
- Work-function plots show a real vacuum plateau and electrostatic/dipole status.
- Population/charge claims are paired with at least one independent observable.
