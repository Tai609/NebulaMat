# CP2K NMR and Magnetic Response

> Load this when: preparing or interpreting CP2K NMR shielding, chemical-shift, EPR-like magnetic-response, hyperfine/property calculations, or core/all-electron-sensitive magnetic observables.

## Scope

NMR and magnetic-response properties are more sensitive than routine total energies. They depend on basis/potential/all-electron treatment, geometry, functional, relativistic treatment, and property-specific print sections. Check exact keyword support in the manual for the installed CP2K version.

## Workflow

1. Use a well-optimized structure appropriate for the experiment/model.
2. Choose whether the property requires GPW, GAPW, all-electron, NLCC, or special basis/potential treatment.
3. Run a converged ground-state calculation with tight SCF, grid, and basis settings.
4. Enable the NMR/magnetic-response property section for the installed CP2K version.
5. Convert shieldings to chemical shifts only after defining the reference compound and sign convention.
6. For condensed phases or flexible molecules, decide whether conformational/thermal/solvent averaging is required.

## CP2K section path

NMR and EPR magnetic-response calculations are linear-response properties under:

```text
&FORCE_EVAL
  &DFT
    &QS
      METHOD GAPW              # normally required for all-electron/core-sensitive response
    &END QS
  &END DFT
  &PROPERTIES
    &LINRES
      &NMR
      &END NMR
      &EPR
      &END EPR
    &END LINRES
  &END PROPERTIES
&END FORCE_EVAL
```

Verify the exact `&LINRES` subsections against the manual for the installed CP2K version. Treat NMR/EPR linear response as a GAPW/all-electron workflow unless a source or local benchmark validates a GPW/GTH approximation for the specific observable.

## Shielding versus chemical shift

Absolute shielding is not an experimental chemical shift. A common relation is:

```text
delta_sample ≈ sigma_ref - sigma_sample
```

or a fitted linear relation from a benchmark set. Always state:

- reference compound or fitted calibration;
- sign convention;
- nucleus and isotope;
- whether values are isotropic or tensor components;
- whether spin-orbit/relativistic effects are included.

## Basis/core treatment

Magnetic response can probe near-nucleus electronic structure. Guardrails:

- GAPW is the default expectation for NMR/EPR linear response because the property depends on near-core/all-electron density.
- For light main-group routine trends, GPW/GTH may be useful only when validated against GAPW/all-electron or experiment.
- For heavy atoms, core-sensitive shifts, EPR/hyperfine, or high-accuracy spectroscopy, check GAPW/all-electron/NLCC/relativistic requirements.
- Do not mix all-electron/GAPW and GPW/GTH shieldings in one trend unless the difference is being benchmarked.
- Converge basis, grid, and SCF tighter than for routine geometry optimization.

## Magnetic/open-shell cases

For radicals, transition-metal systems, polarons, and magnetic materials:

- verify final spin state and local moments before computing response;
- inspect occupations and spin density;
- consider multiple magnetic orderings if the spectrum depends on them;
- report whether the calculation is collinear, noncollinear, or SOC-corrected if applicable.

## Input/output discipline

The exact CP2K property section is version-dependent. Preserve:

- complete `.inp` and `.out`;
- CP2K version and property module path;
- structure used for response, not just the optimized parent structure;
- basis/potential/core/all-electron choices;
- tensor output and any post-processing script.

## Guardrails

- Do not report absolute shieldings as experimental chemical shifts without a reference convention.
- Heavy atoms may require relativistic treatment or different core descriptions.
- Magnetic/open-shell systems need the final spin state, local moments, and electronic occupations checked before response-property interpretation.
- Solvent, temperature, and conformational averaging can dominate NMR comparisons; state whether they were modeled.
- For periodic systems, finite-size, k-point, and cell-shape effects can matter for magnetic response.

## Reporting checklist

- CP2K version, property module, and exact input section.
- Structure source and optimization criteria.
- Functional, basis/potential, core/all-electron/NLCC treatment, relativistic/SOC choices if used.
- SCF/grid/basis convergence relevant to the shielding.
- Shielding-to-shift reference and sign convention.
- Atoms selected, symmetry/equivalence handling, and any averaging.
- Raw output and post-processing script/commands.
