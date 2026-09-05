# Periodic DFT Modeling

> Covers: tool-agnostic practice for periodic DFT models - cells, PBC/vacuum, k-points versus supercells, basis and grid convergence, energy comparisons, smearing, relaxation strategy, and reporting.

This file is code-independent. Use `__NEBULAMAT_AICC_ROOT__/tools/vasp`, `__NEBULAMAT_AICC_ROOT__/tools/cp2k`, or another engine skill for actual input syntax.

## Model before code

Define the physical model first:

- finite molecule, cluster, surface slab, 2D material, bulk crystal, defect, adsorbate, interface, liquid, or MD cell
- charge and spin state, oxidation states, magnetic ordering candidates
- reference states for energies
- what observable must be converged: geometry, energy difference, stress, band gap, DOS feature, barrier, vibration, diffusion, etc.

The code choice comes after this. Switching from VASP to CP2K changes syntax and numerical knobs, not the underlying need to justify the model.

## Cells, PBC, and vacuum

- Bulk: use the experimentally or computationally justified phase/cell; relax the cell only if equilibrium lattice/stress is part of the question.
- Slabs and 2D systems: converge slab thickness and vacuum. Do not let vacuum collapse in variable-cell optimization.
- Molecules in a box: box size must remove image interactions for the target property; Gamma-only is normally enough.
- Charged periodic systems: define the correction/countercharge/solvation strategy before running; raw charged-cell energies can be misleading.
- After structure operations, view periodic images. Many wrong models are technically converged.

Detailed electrostatics, dipoles, charged cells, and work-function alignment live in `periodic-electrostatics.md`.

## k-points versus supercells

k-point density and supercell size are two ways to sample periodicity, but not always equivalent for cost or supported features.

- Metals and small-gap systems need denser sampling and smearing checks.
- Insulators, large supercells, and disordered/MD cells often use Gamma-only supercells.
- Slabs use k-points only in periodic directions.
- A Gamma-only result from a large supercell is not automatically equivalent to a dense k-mesh in a small primitive cell; test the target property.

When a code lacks k-point support for the intended method/property, either use a tested Gamma supercell approximation or choose a different code. Do not silently drop k-points.

## Basis, grid, and representation convergence

Different codes expose different numerical controls, but the principle is the same: converge the representation that controls the target observable.

Examples:

- Plane-wave/PAW codes: plane-wave cutoff, augmentation grids, FFT grids, and PAW potential choice.
- Gaussian/localized-orbital codes: Gaussian basis quality, auxiliary grid/cutoff, fitting basis, and pseudopotential/core partition.
- Mixed Gaussian/plane-wave methods: the orbital basis and the density/potential grid are separate convergence axes.

Guardrails:

- A better integration grid does not fix an insufficient orbital basis.
- A larger basis does not fix a poor pseudopotential/core partition.
- Stresses, phonons/frequencies, response properties, and weak energy differences are more sensitive to representation noise than routine single-point energies.
- If the code prints grid partitioning or basis-size diagnostics, preserve them with the convergence record.

## Energy comparisons

Every energy in one expression must use the same:

- functional and dispersion/solvation/correction scheme
- basis/pseudopotential family or plane-wave cutoff policy
- k-point/supercell policy
- SCF thresholds and smearing policy
- charge/spin/U/hybrid choices where applicable
- electrostatic boundary condition and dipole/charged-cell correction where applicable
- compatible cells and atom counts for difference fields or adsorption expressions

Write the energy expression before running, including sign convention and reference states. Example:

```text
E_ads = E(slab + CO) - E(slab) - E(CO_gas)
```

If a setting changes during troubleshooting and affects the physical method, old and new energies no longer belong in the same expression unless rerun consistently.

## Smearing and metals

Smearing helps metallic SCF convergence and Brillouin-zone integration. It also changes the electronic free energy. For small energy differences:

- keep smearing method and electronic temperature identical across compared systems
- check entropy/free-energy corrections when the code reports them
- test sensitivity to the smearing width
- avoid smearing as a blind fix for an insulating system with a geometry or spin problem

## Relaxation and property levels

It is common to relax at one level and compute final properties at a stricter level, but this must be explicit:

1. Build and pre-relax a chemically sensible model.
2. Relax with settings adequate for the force/stress question.
3. Run final static/property calculations with stricter or property-specific settings.
4. Verify the relaxed structure still represents the intended model.

Frequencies, phonons, stress, barriers, weak interactions, and small energy differences often need tighter SCF/grid/k-point/basis settings than routine geometry optimization.

## DFT+U, hybrids, and magnetism

DFT+U, hybrid functionals, spin states, and magnetic orderings are not numerical details. They define the method and can change the answer.

- Choose U values from source evidence, group convention, or a documented calibration. Do not transfer U values across codes without validation.
- Compare alternative magnetic orderings when the material is magnetic and the result depends on it.
- Hybrid truncation/screening/auxiliary-basis choices must be identical across compared energies.
- If a higher-level method is feasible and the goal is electronic structure, prefer validating against it rather than tuning U to a desired outcome.

## Reporting minimum

Report:

- structure source, phase, cell, atom count, PBC, vacuum/slab thickness
- functional, dispersion/solvation/corrections, U/hybrid/spin choices
- basis/pseudopotential or cutoff policy, grid/cutoff, k-mesh/supercell
- SCF and geometry convergence criteria
- electrostatic boundary condition, dipole correction, and charged-cell correction when relevant
- convergence tests performed or why defaults were accepted
- software version, execution date, and provenance files

For interpretation, connect the numerical output to the claim. A converged calculation can still answer the wrong question.
