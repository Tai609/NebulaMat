# Validating CatMAP Models

> Load this when: checking whether a CatMAP model, input table, solver result, rate map, coverage map, volcano curve, or production-rate plot is scientifically usable.

## Preflight

- Python imports `catmap` from the intended environment.
- `energies.txt`, `.mkm`, and `mkm_job.py` are version-controlled or archived with the result.
- All species in `rxn_expressions` exist in `energies.txt` or are defined as sites/gases.
- Site suffixes in species names match `species_definitions`.
- Gas pressures and temperature are defined or scanned as descriptors.

## Mechanism checks

- Every elementary step is atom-balanced.
- Every elementary step is site-balanced.
- Overall reaction from elementary steps matches the intended chemistry.
- Forward and reverse barriers are thermodynamically consistent with reaction energies.
- Site balance closes for each site type.

## Thermochemistry checks

- Gas thermochemistry mode matches available data: do not use `ideal_gas` without the needed frequencies/geometry.
- Shomate mode has parameters for every gas species; otherwise use another mode or provide parameters.
- Adsorbate frequencies exclude fixed slab modes only if that is the intended approximation.
- Transition-state frequencies exclude the imaginary mode and include the intended active modes.
- Energies and frequencies use consistent units expected by CatMAP.

## Solver checks

Successful run logs should end with zero invalid descriptor points, e.g. a status like `0 points do not have valid solution`. If invalid points remain, do not use maps from those regions.

Check:

- no negative coverages beyond numerical tolerance;
- coverages sum to site totals;
- rates have physically sensible signs relative to reaction direction/reversibility;
- maps are not dominated by clipped values (`vm.min`, `vm.max`, `threshold`);
- high-coverage poisoning regimes match chemical intuition or are explained.

## Output checks

| Output | Validate |
|---|---|
| coverage map | each site type sums to total; dominant species plausible |
| rate / production_rate | sign convention, units, gas product selected, no invalid points |
| volcano plot | descriptor range covers interpolated region; extrapolation flagged |
| scaling plot | only chemically related species constrained together |
| rate control | perturbation size and controlled variable recorded |
| temperature/pressure map | descriptors are actual thermodynamic variables, not stale fixed conditions |

## Provenance

Record:

- CatMAP version/source path and Python environment;
- input file checksums or archived copies;
- descriptor names/ranges/resolution;
- thermochemistry modes;
- gas pressures, temperature, and standard states;
- output variables and plotting thresholds;
- any source-code patches or local CatMAP modifications.
