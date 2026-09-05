# CP2K AIMD, Trajectories, and Metadynamics

> Load this when: setting up CP2K MD/AIMD/PIMD, choosing ensembles and thermostats, validating trajectories, extracting RDF/MSD/VDOS, or planning metadynamics/enhanced sampling.

## Core idea

AIMD samples finite-temperature configurations using forces computed on the fly from electronic structure. The result is not the last frame; it is a statistic: an average, distribution, diffusion slope, vibrational spectrum, or free-energy surface with a stated equilibration cut and uncertainty.

## Standard workflow

1. Start from a chemically sane and normally optimized structure.
2. Heat/anneal if the target temperature is far from the optimized structure.
3. Equilibrate at target ensemble and discard this segment from production averages.
4. Run production long enough for the property.
5. Analyze with explicit frame range, stride, timestep, atom selections, and units.

## Minimal NVT pattern

```text
&GLOBAL
  RUN_TYPE MD
&END GLOBAL
&MOTION
  &MD
    ENSEMBLE NVT
    STEPS 20000
    TIMESTEP 0.5
    TEMPERATURE 300
    &THERMOSTAT
      TYPE CSVR
      &CSVR
        TIMECON [fs] 200
      &END CSVR
    &END THERMOSTAT
  &END MD
&END MOTION
```

Timestep starting points:

- H-rich systems: 0.5-1.0 fs.
- Heavy atoms and stable solids/liquids: sometimes 1-2 fs after testing.
- NVE drift, repeated SCF failures, or bond instability means the timestep/SCF/model is not acceptable.

## Ensemble checks

| Ensemble | Use | Checks |
|---|---|---|
| NVE | conservation test, microcanonical dynamics | total energy drift, timestep, SCF noise |
| NVT | liquid/solid finite-temperature sampling | temperature stationarity, thermostat behavior |
| NPT | density/cell fluctuations | barostat settings, cell stability, finite-size artifacts |
| PIMD | nuclear quantum effects | bead count, thermostat chain, convergence with beads |

## Trajectory validation

Check before analysis:

- no repeated unconverged SCF steps;
- temperature fluctuates around the target after equilibration;
- potential energy is stationary, not drifting monotonically;
- structure remains the intended chemistry;
- no slab evaporation, unphysical cell collapse, or wrong proton/electron state unless that is the target event.

## RDF, MSD, VACF, VDOS

Report:

- atom selections;
- equilibrated frame range;
- frame stride and timestep;
- cell/PBC handling and whether trajectories are wrapped/unwrapped;
- bin width/integration range for RDF coordination;
- fit window and dimensionality for diffusion.

For diffusion, fit the long-time diffusive regime, not the ballistic early-time regime. A single short trajectory at one temperature is not a robust Arrhenius barrier.

## Metadynamics

Metadynamics accelerates rare events using collective variables (CVs). CV choice is the scientific core.

Workflow:

1. Define CVs that distinguish reactant, product, and important intermediates.
2. Run unbiased MD or `REFTRAJ` to inspect CV ranges and fluctuations.
3. Choose Gaussian hill height, width/scale, and deposition stride conservatively.
4. Print and preserve `COLVAR` and `HILLS`.
5. Reconstruct the free-energy surface and inspect whether the CVs actually sampled the intended process.

Pattern:

```text
&MOTION
  &FREE_ENERGY
    &METADYN
      DO_HILLS T
      NT_HILLS 50
      WW [hartree] 1.0E-3
      &METAVAR
        SCALE 0.1
        ... collective variable definition ...
      &END METAVAR
      &PRINT
        &COLVAR
        &END COLVAR
        &HILLS
        &END HILLS
      &END PRINT
    &END METADYN
  &END FREE_ENERGY
&END MOTION
```

## Reporting checklist

- Starting structure, ensemble, timestep, total length, equilibration cut, production window.
- Thermostat/barostat type and parameters.
- SCF strategy and failure count.
- Trajectory stride, selections, and analysis scripts.
- For metadynamics: CV definitions, hill height/width/stride, `COLVAR`, `HILLS`, reconstruction command, and FES convergence checks.
