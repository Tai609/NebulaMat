---
name: catmap
description: Build, run, validate, and troubleshoot CatMAP microkinetic models for heterogeneous catalysis. Use for energies.txt files, .mkm setup files, ReactionModel jobs, thermodynamic/descriptor scaling, steady-state coverages, TOF/production-rate maps, volcano plots, reaction-order/apparent-barrier studies, and CatMAP-specific errors.
---

# CatMAP

CatMAP is an independent microkinetic modeling tool. Use VASP/VASPKIT skills to generate consistent free energies, then use this skill to encode the mechanism, solve the mean-field model, and analyze rates/coverages/selectivity.

## Required inputs

- Mechanism: elementary steps, site types, gas species, adsorbates, transition states.
- Energetics: free energies or electronic energies plus thermochemistry strategy for gases/adsorbates/TSs.
- Conditions or descriptors: temperature, pressures, descriptor names/ranges, resolution.
- Solver choices: thermodynamic modes, scaler, decimal precision, tolerance, outputs.

## Where to find what

| Situation | Go to |
|---|---|
| install/check CatMAP, make `energies.txt`, `.mkm`, and `mkm_job.py`, run a model | `references/running.md` |
| validate mechanism, thermodynamic consistency, outputs, coverages, rates, maps | `references/validation.md` |
| solver failures, missing Shomate data, invalid reactions, convergence problems | `references/errors.md` |
| official docs, examples, source, thermochemistry/scaling background | `references/resources.md` |
| example conventions only | `examples/` |

## Workflow

1. Build a balanced mechanism from the VASP surface-kinetics reference.
2. Assemble `energies.txt` with species names, site names, energies, frequencies, and references.
3. Write `.mkm`: `rxn_expressions`, descriptors, species definitions, thermochemistry/scaler settings, numerical precision, and output variables.
4. Run `mkm_job.py` with `ReactionModel`.
5. Validate that all descriptor points solved, coverages close site balances, rates have sensible sign/magnitude, and thermodynamics is consistent.
6. Analyze maps with CatMAP analyzers only after validation.

## Hard guardrails

- Do not use CatMAP to hide inconsistent DFT thermochemistry. Fix the upstream free-energy table first.
- Every reaction expression must be atom-balanced and site-balanced.
- Gas thermochemistry mode must be compatible with the data in `energies.txt`.
- Mean-field coverages are an approximation; do not claim lateral effects unless explicitly modeled.
- A pretty volcano plot is not validation. Check solver convergence, coverage regimes, and descriptor extrapolation.
