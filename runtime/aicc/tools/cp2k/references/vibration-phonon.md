# CP2K Vibrations and Phonons

> Load this when: setting up CP2K vibrational analysis, interpreting frequencies/normal modes, preparing phonopy force calculations, or deciding whether imaginary modes are physical.

## Prerequisites

- Optimize the structure tightly before any frequency calculation.
- SCF and grid noise are amplified by finite differences; use tighter `EPS_SCF`, stable SCF, and converged `CUTOFF`/`REL_CUTOFF`.
- Keep the same functional, dispersion, basis, potential, charge, spin, U, and cell policy as the structure being characterized.
- For surface adsorbates and soft materials, low-frequency modes are very sensitive to constraints, slab thickness, vacuum, and numerical thresholds.

## CP2K vibrational analysis

```text
&GLOBAL
  RUN_TYPE VIBRATIONAL_ANALYSIS
&END GLOBAL
&VIBRATIONAL_ANALYSIS
  NPROC_REP 1
  DX 0.01
&END VIBRATIONAL_ANALYSIS
```

Use this for molecules, clusters, and small periodic/supercell models where the Hessian cost is manageable. For large periodic phonons, prefer the `phonopy` skill with CP2K as the force backend.

## Interpreting modes

| Observation | Meaning / action |
|---|---|
| many imaginary modes | structure not a minimum, loose optimization, wrong constraints, or noisy forces |
| one imaginary mode for intended TS | inspect displacement; it should follow the reaction coordinate |
| tiny imaginary modes near 0 | often translations/rotations, finite-size, loose SCF/grid, or shallow soft modes; reoptimize/check visually |
| low-frequency adsorbate/slab modes | entropy corrections may be unreliable; document treatment |

Do not call a structure a minimum solely because a geometry optimizer stopped. Confirm stationary behavior if frequencies are used for thermochemistry or transition-state validation.

## IR/Raman and spectra

Use CP2K property print sections only after confirming the method supports the desired intensities for the installed version. Frequencies without intensities can still be useful for stationary-point validation and ZPE corrections.

## Phonopy route

Use when the scientific question is phonon dispersion, phonon DOS, thermal properties of crystals, or supercell finite-displacement phonons.

Workflow:

1. Optimize primitive/conventional cell with production settings.
2. Generate supercells/displacements with `phonopy`.
3. Run CP2K single-point force calculations for every displacement with identical settings.
4. Extract forces and build force constants with phonopy.
5. Check acoustic modes near Gamma and convergence with supercell size and displacement amplitude.

## Thermochemistry cautions

- ZPE and vibrational free-energy corrections depend strongly on low modes.
- Gas-phase molecule corrections should use appropriate molecular boxes, spin states, and standard-state conventions.
- Surface adsorbate translations/rotations are often hindered modes; do not blindly apply ideal-gas formulas to adsorbed species.

## Reporting checklist

- Optimized structure source and final force criteria.
- Displacement size, frequency method, and whether constraints were present.
- CP2K version and exact input/output.
- Imaginary-mode count and visual inspection result.
- For phonopy: supercell size, displacement amplitude, force files, NAC treatment if used, q-path, and convergence tests.
