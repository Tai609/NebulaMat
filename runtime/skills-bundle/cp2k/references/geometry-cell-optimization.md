# CP2K Geometry and Cell Optimization

> Load this when: setting up or validating `GEO_OPT`, `CELL_OPT`, constraints, fixed atoms, slab/2D relaxations, stress-tensor settings, or stationary-point checks.

## Workflow

1. Run a stable single-point calculation first; do not debug geometry optimization before SCF is reliable.
2. Choose what may move: atoms only, whole cell, selected cell components, or constrained coordinates.
3. Use a force criterion appropriate to the downstream task: routine relaxations can be looser than frequencies, NEB endpoints, surface energies, and small energy differences.
4. After optimization, run a clean static single point with production settings for final energies/electronic analysis.
5. Inspect the final structure chemically; convergence is not proof that the intended state was preserved.

## Fixed-cell optimization

```text
&GLOBAL
  RUN_TYPE GEO_OPT
&END GLOBAL
&MOTION
  &GEO_OPT
    OPTIMIZER BFGS
    MAX_ITER 200
    MAX_DR    3.0E-03
    RMS_DR    1.5E-03
    MAX_FORCE 4.5E-04
    RMS_FORCE 3.0E-04
  &END GEO_OPT
&END MOTION
```

BFGS is a strong default near a reasonable minimum. If the starting geometry is poor, first use a robust lower-level relaxation, smaller optimizer steps, or a cleaned structure.

## Cell optimization

```text
&GLOBAL
  RUN_TYPE CELL_OPT
&END GLOBAL
&FORCE_EVAL
  STRESS_TENSOR ANALYTICAL
  ...
&END FORCE_EVAL
&MOTION
  &CELL_OPT
    OPTIMIZER BFGS
    MAX_ITER 200
    EXTERNAL_PRESSURE 1.01325
    PRESSURE_TOLERANCE 100.0
  &END CELL_OPT
&END MOTION
```

Cell optimization needs an explicit stress policy. Treat changing the cell as a more demanding calculation than fixed-cell relaxation; converge grid, basis, k-points, and stress settings for the target property.

## Slabs and low-dimensional systems

- Default to fixed-cell `GEO_OPT` for slabs and 2D materials after building a converged model.
- Do not let vacuum thickness relax unless that is the explicit physical question.
- Keep only the physically periodic directions in k-point sampling.
- Freeze bottom layers or substrate atoms with a documented rule; do not lose constraints during structure conversion.
- For asymmetric slabs, decide separately whether a dipole/electrostatic-potential correction is needed for the property.

## Fixed atoms

```text
&MOTION
  &CONSTRAINT
    &FIXED_ATOMS
      LIST 1 2 3
      COMPONENTS_TO_FIX XYZ
    &END FIXED_ATOMS
  &END CONSTRAINT
&END MOTION
```

Record atom numbering and how fixed atoms were selected, especially for slabs, defects, and adsorbates.

## Convergence interpretation

A CP2K optimization reports multiple criteria such as maximum step, RMS step, maximum gradient/force, and RMS gradient/force. The optimization is only converged when the relevant criteria are satisfied together. Ending at `MAX_ITER` is not convergence.

## Stationary-point validation

For minima that feed frequencies, thermochemistry, or transition-state comparisons:

- Re-optimize tighter if low-frequency/imaginary modes are suspicious.
- Run vibrational analysis when the claim depends on being a true minimum.
- A true minimum should not have a chemically meaningful imaginary mode.
- For a transition state, exactly one relevant imaginary mode should connect reactant/product geometry.

## Reporting checklist

- Starting structure source and final structure file.
- `RUN_TYPE`, optimizer, thresholds, constraints, fixed atom list, and stress policy.
- Whether a final static run was done.
- For `CELL_OPT`: pressure target, final stress/cell, and whether vacuum/nonperiodic directions were constrained.
- CP2K version, input, output, restart file, and parser summary.
