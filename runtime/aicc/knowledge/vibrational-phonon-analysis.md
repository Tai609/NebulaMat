# Vibrational and Phonon Analysis

> Covers: interpreting molecular vibrations, phonons, imaginary modes, IR/Raman spectra, VDOS, phonon DOS/bands, and finite-difference force-constant workflows independent of the electronic-structure code.

Use engine skills for syntax: CP2K, VASP, Gaussian, phonopy, or other backends. This file is about deciding what the calculation means.

## What problem are you solving?

| Question | Calculation | Interpretation focus |
|---|---|---|
| Is this optimized structure a minimum? | Hessian/frequencies | no chemically meaningful imaginary modes |
| Is this a transition state? | TS frequency | exactly one relevant imaginary mode along reaction coordinate |
| What are IR/Raman peaks? | frequencies + intensities | mode assignment, broadening, temperature/phase effects |
| What is crystal dynamical stability? | phonon dispersion | no imaginary branches after convergence artifacts are ruled out |
| What is heat capacity/free energy? | phonon/vibrational DOS | low-frequency treatment and convergence dominate |
| What does finite-T dynamics vibrate like? | VACF/VDOS from MD | sampling, thermostat, trajectory length, quantum correction |

## Imaginary modes

Imaginary frequencies are diagnostics, not automatically failures.

- Many imaginary modes usually mean poor optimization, wrong structure, loose SCF/force thresholds, or an unstable phase.
- One mode at a reaction saddle is expected only if the displacement connects the intended reactant/product direction.
- Tiny near-zero imaginary modes in molecules or slabs can be translations, rotations, soft modes, or numerical noise; inspect the displacement.
- Imaginary phonon branches can be real instabilities or artifacts from insufficient supercell, k/q sampling, loose force convergence, or wrong symmetry.

Never report a minimum/TS/phase stability claim without checking the mode displacement or phonon branch character.

## Finite-difference force constants

Finite differences amplify noise. Before computing forces for displacements:

- optimize the structure tightly;
- use consistent functional, dispersion, charge/spin/U/hybrid settings;
- tighten SCF and grid/cutoff settings beyond routine relaxation if needed;
- converge displacement size and supercell size;
- preserve constraints only if they are part of the physical model.

For phonopy-style workflows, force calculations for every displacement must use identical settings and compatible cells.

## Molecular IR/Raman

Peak positions from harmonic calculations often need interpretation:

- compare relative shifts more robustly than absolute frequencies;
- scale factors are empirical and method-dependent;
- anharmonicity, temperature, solvent, phase, and conformational averaging can dominate experiment-computation differences;
- intensities depend on dipole/polarizability derivatives, not just mode displacement;
- constrained or partial Hessian calculations can miss coupling to the environment.

Mode assignment should combine frequency, displacement visualization, isotope/substitution trends when available, and chemical intuition.

## Phonon dispersion and DOS

For crystals and low-dimensional materials:

- use a relaxed structure and a supercell large enough for force constants;
- check acoustic modes near Gamma;
- include NAC/Born effective charges for polar materials when LO-TO splitting matters;
- choose q-path from symmetry, not by visual guess;
- avoid interpreting tiny imaginary acoustic artifacts as real instability until convergence is checked.

Low-dimensional systems need special care: vacuum directions, flexural modes, and acoustic branches can be sensitive to numerical settings and cell size.

## VDOS from MD

Velocity-autocorrelation spectra answer a finite-temperature dynamical question, not the harmonic-Hessian one, and carry anharmonic/temperature broadening a static Hessian cannot. The VACF/VDOS workflow, sampling requirements, and reporting (ensemble, thermostat, timestep, mass-weighting/projection, windowing, quantum correction) live in [molecular-dynamics.md](molecular-dynamics.md) — use it rather than restating them here.

## Thermochemistry connection

ZPE and vibrational free energies are only as reliable as the low-frequency treatment. For adsorbates, liquids, soft molecular crystals, and floppy molecules, rigid-rotor/harmonic-oscillator formulas can overstate entropies. Use `thermochemistry-and-free-energy.md` for free-energy assembly.

## Evidence chain

Good vibrational/phonon claims usually include:

- optimized structure and convergence thresholds;
- imaginary-mode count and visualization;
- frequency/phonon convergence settings;
- spectrum broadening/scaling/shift policy;
- mode assignment table;
- comparison to experiment or a higher-level method when the claim is quantitative.

## Red flags

- Using frequencies from a structure that is not a stationary point.
- Ignoring a large imaginary mode because the geometry optimizer stopped.
- Comparing spectra with different scaling/broadening without saying so.
- Treating adsorbate low-frequency modes as ideal-gas translations/rotations without a model choice.
- Reporting phonon stability from one small supercell with loose forces.
