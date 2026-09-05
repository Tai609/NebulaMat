# CP2K Advanced Electronic Methods

> Load this when: choosing CP2K semiempirical methods, DFTB, GFN-xTB, hybrid/HFX, ADMM, RI-HFX with k-points, MP2/RPA/GW, constrained DFT, LS-SCF/LRIGPW, or a low-level preoptimization strategy.

These methods are not interchangeable accuracy knobs. Each changes the physical method, the basis/auxiliary-basis requirements, the SCF strategy, and what can be compared.

## Decision table

| Need | Candidate method | Caution |
|---|---|---|
| cheap geometry cleanup / large exploratory MD | GFN-xTB, DFTB, force field | not a final DFT energy; parameter coverage matters |
| routine periodic DFT | GPW/GAPW semilocal DFT | converge basis, grid, k-points, SCF |
| band gaps, charge-transfer states, self-interaction reduction | hybrid/HFX, range-separated hybrids | expensive; truncation, ADMM/RI, and k-support are version-sensitive |
| cheaper hybrids | ADMM | auxiliary basis and ADMM method are part of the method |
| periodic hybrid with k-points | RI-HFXk where supported | requires auxiliary basis/metric choices; verify installed CP2K version |
| higher-level correlation benchmark | MP2, RPA, SOS/SCS variants | basis and memory intensive; not routine for large production series |
| quasiparticle/core spectra | GW/BSE/XAS modules | specialist workflow; alignment and broadening choices dominate interpretation |
| localized electron/charge-transfer constraint | CDFT | constraint definition and reference populations must be validated |
| huge insulating systems | LS-SCF/LRIGPW-style acceleration | only when the method assumptions fit; validate against a conventional run |

## Semiempirical and low-level preoptimization

Use xTB/DFTB/force-field methods to build or screen structures, not to silently replace the final method. CP2K syntax details live in `semiempirical-dftb-xtb.md`.

Workflow:

1. Pre-relax the difficult or large structure cheaply.
2. Inspect chemistry, cell, protonation, spin/charge, and PBC.
3. Switch to the target DFT method and reoptimize or run a controlled static comparison.
4. Never mix xTB/DFTB energies with DFT energies in one reaction expression unless the whole workflow is explicitly a multilevel scheme.

Guardrails:

- Parameter availability and element coverage are first-order constraints.
- A semiempirical structure can have different bond ordering, proton transfer, or adsorption geometry from DFT.
- For metals, surfaces, radicals, and strongly correlated systems, validate early against DFT.

## Hybrid/HFX workflow

1. Converge the same system at a semilocal level.
2. Restart the hybrid from the semilocal wavefunction.
3. Choose the exact exchange fraction, range separation, screening, and truncation policy.
4. Add ADMM or RI-HFX only with documented auxiliary bases.
5. Benchmark memory and MPI/OpenMP layout.
6. Keep all HFX/ADMM/truncation settings identical across compared energies.

Indicative HFX pattern:

```text
&XC
  &XC_FUNCTIONAL PBE
  &END XC_FUNCTIONAL
  &HF
    FRACTION 0.25
    &INTERACTION_POTENTIAL
      POTENTIAL_TYPE TRUNCATED
      CUTOFF_RADIUS [angstrom] 6.0
    &END INTERACTION_POTENTIAL
    &MEMORY
      MAX_MEMORY 3000
      EPS_STORAGE_SCALING 0.1
    &END MEMORY
  &END HF
&END XC
```

For periodic truncated HFX, the truncation radius must be compatible with the cell and kept fixed across a comparison series.

## ADMM

ADMM approximates part of the exact-exchange work using an auxiliary basis. It is a controlled approximation only when the auxiliary basis and method are chosen deliberately.

```text
&AUXILIARY_DENSITY_MATRIX_METHOD
  METHOD BASIS_PROJECTION
  ADMM_PURIFICATION_METHOD NONE
&END AUXILIARY_DENSITY_MATRIX_METHOD

&KIND C
  BASIS_SET ORB DZVP-MOLOPT-SR-GTH
  BASIS_SET AUX_FIT cFIT3
  POTENTIAL GTH-PBE-q4
&END KIND
```

Rules:

- every element in the HFX region needs an auxiliary basis;
- compare ADMM basis choices on a smaller representative system;
- do not mix ADMM and non-ADMM energies unless explicitly benchmarking ADMM error;
- preserve both orbital and auxiliary basis names.

## RI-HFX with k-points

RI-HFX can make periodic hybrid calculations with k-points feasible in supported CP2K versions. It introduces additional choices: auxiliary basis, RI metric, cutoff/truncation, and screening thresholds. Treat all of them as method parameters.

Use RI-HFX when:

- the target property needs k-point hybrid electronic structure;
- a Gamma-supercell hybrid approximation is too expensive or not scientifically adequate;
- the installed CP2K version and basis libraries support the required elements.

Do not assume an old rule such as "CP2K hybrids cannot use k-points" without checking the current manual and build.

## MP2, RPA, and correlated benchmarks

Correlated wavefunction methods in CP2K are usually benchmark/specialist tools rather than routine production defaults.

Checklist before use:

- Can the basis/auxiliary-basis family support the method?
- Is the cell/k-point/supercell model feasible?
- Are memory and disk requirements known from a smoke test?
- Is the correlation energy being used consistently in a defined expression?
- Is a lower-cost method being benchmarked against the result rather than mixed arbitrarily?

For periodic MP2/RPA, preserve every auxiliary basis, screening threshold, quadrature setting, and group-size/memory parameter used.

## GW/BSE and excited-state corrections

Use GW/BSE to discuss quasiparticle gaps and excitation spectra only with a documented ground-state reference, convergence of empty states/auxiliary basis, and a clear energy-alignment or calibration strategy. Do not compare raw TDDFT, GW, and experiment peak positions without stating shifts/broadening.

## Constrained DFT

CDFT is useful for diabatic charge-transfer states, electron localization, and redox-like constraints. It requires a chemically meaningful constraint region and population definition.

Workflow:

1. Define donor/acceptor or site populations.
2. Validate the unconstrained state.
3. Apply the constraint and verify the target population is achieved.
4. Compare constrained and unconstrained energies only within a written thermodynamic/diabatic model.

## Large-system acceleration

LS-SCF and LRIGPW-style accelerations are powerful for large systems but require method assumptions. Validate on a smaller conventional calculation before using them for production conclusions.

## Reporting checklist

Record:

- exact method family and CP2K version;
- functional, HFX fraction, range separation/truncation/screening;
- orbital basis, auxiliary basis, and pseudopotentials;
- SCF method, restart source, smearing/added MOs;
- memory/rank/thread layout and walltime benchmark;
- convergence tests for target property;
- whether the method is production, screening, or benchmark-only.
