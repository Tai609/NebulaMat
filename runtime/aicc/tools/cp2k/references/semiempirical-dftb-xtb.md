# CP2K Semiempirical, DFTB, and xTB Workflows

> Load this when: using CP2K for DFTB, SCC-DFTB, GFN1-xTB/GFN2-xTB-style screening, low-cost geometry optimization, large-cell pre-equilibration, fast AIMD, or as a preparatory step before Quickstep DFT.

## Scope

Semiempirical methods are useful for exploration and preconditioning. They are not interchangeable with production DFT unless the scientific result is explicitly defined at the semiempirical level.

Use cases:

- cleaning bad crystal/molecular geometries before DFT;
- screening adsorption sites, conformers, surfaces, and large cells;
- generating approximate MD trajectories or pre-equilibrated liquid/solid structures;
- estimating trends when the method is validated for the chemical class;
- preparing a stable starting point for Quickstep GPW/GAPW.

Do not mix semiempirical energies with DFT energies in one adsorption, surface, defect, or reaction expression.

## General workflow

1. Define whether the final reported result is semiempirical or whether this is only preconditioning.
2. Choose the parameter set and verify it covers every element and interaction in the model.
3. Run a cheap geometry/MD cleanup.
4. Inspect chemistry: bonds, charges, spin, protonation, adsorption mode, and cell density.
5. If DFT is the final method, restart from the cleaned structure but recompute all final energies/properties with the DFT method.

## xTB pattern

Template shape; verify exact keywords against the installed CP2K version:

```text
&FORCE_EVAL
  METHOD Quickstep
  &DFT
    &QS
      METHOD xTB
    &END QS
    &xTB
      DO_EWALD T
      CHECK_ATOMIC_CHARGES F
      &PARAMETER
        PARAM_FILE_NAME xTB_parameters
        DISPERSION_PARAMETER_FILE dftd3.dat
      &END PARAMETER
    &END xTB
  &END DFT
  &SUBSYS
    ...
  &END SUBSYS
&END FORCE_EVAL
```

Rules:

- xTB parameter files are part of the method; record their source/version.
- `CHECK_ATOMIC_CHARGES F` is sometimes used to avoid parameter-charge checks during exploratory work, but it can hide wrong charge assignments. Use deliberately.
- Periodic xTB needs a deliberate Ewald/electrostatics policy and cell size.
- xTB optimization can produce a good geometry guess but does not define a DFT-grade energy.

## DFTB / SCC-DFTB pattern

Template shape; verify exact keywords and parameter names against the installed CP2K version and parameter library:

```text
&FORCE_EVAL
  METHOD Quickstep
  &DFT
    &QS
      METHOD DFTB
    &END QS
    &DFTB
      SELF_CONSISTENT T
      DO_EWALD T
      DISPERSION T
      &PARAMETER
        PARAM_FILE_PATH DFTB/scc
        PARAM_FILE_NAME scc_parameter
        UFF_FORCE_FIELD uff_table
      &END PARAMETER
    &END DFTB
    &POISSON
      PERIODIC XYZ             # adjust
    &END POISSON
  &END DFT
  &SUBSYS
    ...
  &END SUBSYS
&END FORCE_EVAL
```

Rules:

- Slater-Koster/DFTB parameter files define the chemistry. Missing or mismatched element pairs can invalidate the calculation.
- SCC convergence is a real convergence criterion; do not treat a non-self-consistent charge as comparable to SCC-DFTB.
- Dispersion parameters and DFTB parameters must be reported together.
- For large periodic systems, check whether the parameter set was developed for similar coordination, charge, and phase.

## Transitioning from semiempirical to DFT

When using semiempirical only as a preconditioner:

1. Save the semiempirical final structure.
2. Build a fresh CP2K DFT input with production `BASIS_SET_FILE_NAME`, `POTENTIAL_FILE_NAME`, `&KIND`, `CUTOFF`, `REL_CUTOFF`, SCF, and k-policy.
3. Do a DFT smoke test and then full relaxation/static run.
4. Report final DFT energies from the DFT run only.
5. Keep the semiempirical input/output as provenance for how the initial structure was generated.

## AIMD/pre-equilibration cautions

Semiempirical AIMD can rapidly equilibrate density and remove bad contacts, but it may give different bond-breaking, proton-transfer, diffusion, or adsorption behavior than DFT. If the production claim depends on dynamics, run DFT AIMD or validate the semiempirical trajectory against DFT snapshots.

## Validation checklist

- Parameter set covers all element pairs and intended charge/spin states.
- Cell/electrostatics/PBC match the model.
- Geometry after semiempirical cleanup is chemically plausible.
- Final reported energies/properties are not mixed across semiempirical and DFT levels.
- Parameter files, CP2K version, and conversion steps are preserved.
