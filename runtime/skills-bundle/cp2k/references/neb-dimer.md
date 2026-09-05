# CP2K NEB, BAND, and Transition-State Workflows

> Load this when: setting up or validating CP2K reaction paths, `RUN_TYPE BAND`, CI-NEB, image/replica layouts, or transition-state confirmation.

## Method choice

| Situation | Prefer |
|---|---|
| relaxed initial and final states are known | NEB / CI-NEB with `RUN_TYPE BAND` |
| NEB gives a high-energy image but saddle needs refinement | use the high-energy image as a TS guess, then verify with a transition-state/frequency workflow supported by the installed CP2K version |
| endpoint atom mapping is ambiguous | fix atom ordering before any interpolation |
| interpolation creates close contacts | rebuild path, add intermediate minima, or use an IDPP/sobNEB-style preconditioned path builder |

## Endpoint requirements

1. Optimize initial and final states first.
2. Use identical functional, dispersion, basis/potential, grid, k-policy, smearing, spin, U, charge, slab constraints, and cell setup.
3. Preserve atom order: image interpolation assumes atom-to-atom correspondence.
4. Inspect endpoints and the interpolated path before submitting.

## CP2K BAND / CI-NEB pattern

```text
&GLOBAL
  RUN_TYPE BAND
&END GLOBAL
&MOTION
  &BAND
    NUMBER_OF_REPLICA 8
    K_SPRING 0.05
    BAND_TYPE CI-NEB
    &OPTIMIZE_BAND
      OPTIMIZE_END_POINTS F
      OPT_TYPE DIIS
      MAX_ITER 200
    &END OPTIMIZE_BAND
    &CI_NEB
    &END CI_NEB
    &REPLICA
      COORD_FILE_NAME initial.xyz
    &END REPLICA
    &REPLICA
      COORD_FILE_NAME final.xyz
    &END REPLICA
  &END BAND
&END MOTION
```

Check the installed manual for exact keyword paths and allowed optimizer choices; CP2K's BAND section evolves across versions.

## Image count and resources

- Small simple paths: start with a modest number of replicas and tighten after the path is sensible.
- Complex surface reactions or diffusion paths may need more images or decomposition into multiple elementary steps.
- NEB memory and walltime scale with replicas. Tune MPI/OpenMP layout with the site guide; `psmp` can be preferable when memory per rank is limiting.

## Monitoring and validation

A finished BAND run is not automatically a valid barrier. Check:

- every replica converged to the force criterion;
- no image contains atom crossing or chemically impossible geometry;
- relative energies form a sensible minimum-energy path;
- the barrier is stable under a tighter rerun or additional images when it matters;
- spin, charge, U, and slab constraints stay consistent across all images.

## Transition-state confirmation

If reporting a transition state rather than only an NEB barrier, verify the saddle point with a version-supported TS/refinement workflow and vibrational analysis when feasible. A validated first-order saddle should show one chemically meaningful imaginary mode aligned with the reaction coordinate.

## Reporting checklist

- Energy expression and sign convention for the barrier.
- Endpoint folders, endpoint convergence, and atom-order mapping.
- Number of replicas/images, spring constant, optimizer, force criterion.
- Initial path generation method and visual inspection result.
- Relative image energies and final maximum forces.
- Whether a TS/frequency verification was performed.
