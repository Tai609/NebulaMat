# Molecular QC Practical Rules

> Covers: tool-agnostic method-choice rules for finite-molecule quantum chemistry — how to avoid common wrong-but-runnable calculations. Gaussian-specific syntax lives in `__NEBULAMAT_AICC_ROOT__/tools/gaussian/references/`.

This is not a textbook and not a universal protocol. Source-paper settings, group conventions, and validated benchmarks override these defaults.

## 0. Default posture

- Define the scientific quantity before choosing keywords: electronic energy, Gibbs free energy, barrier, binding energy, solvation free energy, vertical absorption, emission, charge trend, or orbital picture are different targets.
- Prefer the simplest input that expresses the target. Extra keywords are not evidence of expertise.
- Treat failures as information. Do not bypass SCF/Opt/Freq/IRC errors until the model, state, numerical settings, and validation target have been checked.
- A numerical result is not usable until the relevant validation gate passes: SCF convergence and stability, Opt convergence, Freq check, TS mode, IRC connection, state assignment, and energy-source correctness.

## 1. Method and basis

- HF: reference/initial guess only; no electron correlation and no dispersion.
- Routine molecular opt/freq: dispersion-aware DFT with polarized DZ/TZ basis.
- Final relative energies: higher-level single point on validated geometry; report as `SP//opt` and keep thermal correction provenance explicit.
- Weak interactions/conformers: use dispersion-capable DFT or a validated noncovalent method. Plain B3LYP/HF are unsafe for dispersion-dominated claims.
- MP2: often useful for H-bonds and ordinary vdW, but can overbind π-stacking and has significant BSSE.
- CCSD(T): benchmark for small, near-single-reference systems; not routine optimization for large systems.
- Semiempirical/xTB/PM7: screening/pre-optimization; not final quantitative evidence unless explicitly benchmarked.
- Polarization functions are the floor for serious molecular calculations.
- Diffuse functions are required for anions, Rydberg states, diffuse/lone-pair reactive sites, and often weak interactions/CT/barriers; they also raise linear-dependence and SCF risk.
- ECPs: use matched ECP + valence basis for heavier atoms; do not mix arbitrary ECP and basis families. Avoid ECP shortcuts for first- to third-row atoms unless reproducing a source method.

Compared energies must share method, basis, spin/charge, dispersion, solvation, grid/integral accuracy, and convergence criteria. Cross-program differences often trace to these details, including pure-vs-Cartesian functions, frozen-core conventions, and fitting defaults.

## 2. Electronic state and SCF

Before changing algorithms, check geometry, units, charge, multiplicity, dangling bonds, heavy-element treatment, and basis linear-dependence risk.

- Diffuse/large-basis failure: converge a smaller or no-diffuse job first, then read that wavefunction into the target level.
- Small-gap/conjugated/near-degenerate systems: use better initial guesses, level shifting, and alternative spin states; confirm the result with a stability analysis (a wavefunction instability is common here).
- Grid-sensitive DFT: raise integration grid and integral accuracy.
- Hard but chemically sane SCF: use robust quadratic fallback; do not just add cycles.
- Unconverged SCF invalidates gradients, frequencies, TDDFT, and post-SCF corrections.
- Converged SCF is not necessarily the correct state. Run stability checks for radicals, stretched bonds, transition metals, open-shell singlets, antiferromagnetic coupling, and any spin-density claim.
- Open-shell singlets/biradicals require unrestricted broken-symmetry search, stability test, spin-density inspection, and high-spin comparison. The word “singlet” in the charge/multiplicity line is not sufficient evidence.

## 3. Stationary points and reaction paths

- Opt+Freq at the same level is the minimum validation unit for thermochemistry.
- Minimum: optimized structure and 0 imaginary frequencies.
- TS: optimized first-order saddle, exactly 1 imaginary frequency, mode follows intended reaction coordinate, important cases validated by IRC.
- Higher-level SP improves electronic energy, not the lower-level thermal correction; state the approximation explicitly.
- Optimization failures should be diagnosed by symptom: starting geometry, Hessian quality, coordinate system, step size, grid noise, or electronic state. Change one thing at a time.
- Scans generate guesses and mechanistic clues; scan maxima are not validated TSs.
- Constrained optimization can be physically useful, but the result is not a full-space stationary point; imaginary modes after constraints are not automatically surprising.
- IRC must start from a validated TS at the TS level. If IRC fails numerically, try smaller steps or another path algorithm before discarding the TS.

## 4. Solution phase, weak interactions, and BSSE

- Solvent changes the potential-energy surface, not just the final number. Apply the solvent model consistently across comparable species in solution-phase opt/freq/TS/IRC/SP work.
- Use explicit solvent when solvent makes or breaks key H-bonds, ion pairs, coordination, proton-transfer coordinates, or charge-transfer contacts.
- SMD-type continuum models are a common default for solvation free energies because they include fitted non-electrostatic (cavitation/dispersion/repulsion) terms; for many systems they work well, but validate against the source method. Custom solvents need documented parameters.
- Track standard states: gas-phase thermochemistry is often 1 atm, solution free energy often 1 M. At 298 K, the ideal 1 atm -> 1 M correction is about +1.89 kcal/mol per independently dissolved species.
- Define noncovalent energy: rigid-monomer interaction vs relaxed-monomer dissociation; their difference is deformation energy.
- Dispersion affects the PES. If binding/conformer/barrier energetics depend on dispersion, keep the dispersion treatment consistent in opt/freq/scan/IRC.
- BSSE decreases with basis size. DFT/TZ often has modest BSSE; post-HF can remain significant at TZ. CP correction is positive and can overcorrect, so report raw and corrected values when it changes the conclusion.

## 5. Excited states and spectra

- A TD calculation gives the property at the input geometry: ground-state geometry -> vertical absorption; excited-state geometry -> vertical emission; two optimized states -> adiabatic quantity.
- Compute more states than the visible target peak count; too few states biases assignments and spectra.
- CT, Rydberg, d-d, MLCT, open-shell, conical-intersection, and multireference cases need extra skepticism and often benchmark methods.
- Functional choice shifts excitation energies; range-separated/high-HF-exchange functionals are often safer for CT states, but do not tune a functional to one experimental peak without saying it is empirical.
- Assign states using orbitals/NTOs/density differences, not orbital numbers alone.
- Oscillator strength indicates absorption intensity; near-zero states can still matter for ECD or photochemistry.
- ECD is conformer-sensitive: compute and Boltzmann-weight credible conformers before comparing to experiment.

## 6. Reporting floor

Every numeric conclusion needs file provenance, units, energy type (`E`, `E+ZPE`, `H`, `G`), method/basis, solvation/dispersion state, charge/spin, and validation status. Report relative energies, barriers, binding energies, populations, or spectra; do not make conclusions from bare total energies.
