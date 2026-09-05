# Excited-State and Core Spectroscopy

> Covers: UV-Vis/TDDFT, XAS/core-level spectra, oscillator strengths, broadening, energy alignment, spin-orbit effects, GW/BSE context, and how to compare computed spectra to experiment independent of code syntax.

Engine-specific input lives in `__NEBULAMAT_AICC_ROOT__/tools/cp2k/references/tddft-xas.md`, Gaussian excited-state references, or other code skills. This file is the interpretation and workflow layer.

## Spectrum types

| Observable | Typical method | Main caveats |
|---|---|---|
| UV-Vis valence excitations | TDDFT, sTDA, delta-SCF, GW/BSE | functional dependence, charge-transfer error, conformers, solvent |
| XAS / core excitation | TDDFT/XAS, core-hole, transition-potential, GW correction | edge/atom selection, core-hole treatment, energy shifts |
| photoemission / quasiparticle gap | GW, delta-SCF, Koopmans-like estimates | empty-state convergence, alignment, screening |
| spin-orbit split spectra | SOC-TDDFT or relativistic response | spin state and relativistic treatment |
| NMR/EPR response | response/shielding/hyperfine methods | reference compounds, core/relativistic treatment |

## Ground-state prerequisites

Spectroscopy starts from a ground-state model:

- correct structure, conformer, phase, surface, solvation, and temperature model;
- converged charge/spin/magnetic state;
- documented functional, basis/potential, U/hybrid choices;
- enough virtual space if the method expands into unoccupied states;
- no unresolved SCF or geometry artifacts.

If the ground state is wrong, a sophisticated spectrum only explains the wrong model.

## TDDFT/UV-Vis interpretation

For every excitation, report more than the energy:

- oscillator strength or intensity;
- dominant orbital/transition character;
- charge-transfer distance or fragment character when relevant;
- spin multiplicity and spin contamination if open-shell;
- broadening/line-shape used for the plotted spectrum;
- whether an empirical shift was applied.

Charge-transfer excitations are often functional-sensitive. For donor-acceptor systems, inspect transition density, natural transition orbitals, attachment/detachment density, or fragment orbital contributions rather than relying on a single HOMO-LUMO label.

## XAS and core spectra

Define:

- absorbing element and edge;
- absorbing atom set or site average;
- core-hole/response method;
- spin/SOC treatment;
- energy shift or calibration point;
- broadening and instrument-like convolution;
- structural model and local coordination.

Raw absolute XAS peak positions often need alignment. Shape, relative splitting, site trends, and edge shifts under a consistent protocol can be more robust than unshifted absolute energies.

## Energy alignment and broadening

Computed sticks become a spectrum only after a line-shape choice:

```text
I(E) = sum_i f_i * L(E - E_i; width)
```

Report Gaussian/Lorentzian/mixed broadening, full width at half maximum, and any energy shift. Do not compare a narrow computed stick spectrum directly to a broadened experimental spectrum.

## Spin and SOC

Open-shell and heavy-element spectra require explicit spin treatment.

- Check the final ground-state spin/magnetic ordering before excited-state analysis.
- SOC can split states and redistribute oscillator strengths.
- Scalar relativistic corrections can shift core edges.
- For magnetic systems, compare spin channels and local moments when assigning peaks.

## GW/BSE context

GW/BSE is often used for quasiparticle energies and optical excitations. It is not a drop-in replacement for TDDFT without convergence work.

Key convergence axes:

- starting functional;
- number of empty states;
- dielectric/response cutoff;
- k-points/supercell;
- frequency grid/contour parameters;
- spin/SOC treatment.

Use GW/BSE to calibrate or benchmark when the question justifies the cost.

## Comparing to experiment

Before claiming agreement:

- match phase, temperature, protonation/charge state, concentration, and solvent/environment;
- account for conformer or site averaging;
- state shifts and broadening;
- compare peak assignments and intensity ratios, not only the largest peak position;
- explain missing peaks if the model lacks defects, vibronic coupling, or finite-temperature disorder.

## Red flags

- Reporting HOMO-LUMO gaps as optical gaps without excitation calculation.
- Comparing raw peak energies across different functionals or core-hole methods.
- Assigning XAS peaks without specifying absorbing site/edge.
- Ignoring SOC for heavy-element L edges or spin-orbit-sensitive spectra.
- Treating one cluster model as a periodic/material spectrum without checking boundary effects.
