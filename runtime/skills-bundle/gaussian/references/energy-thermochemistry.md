# Gaussian Energy and Thermochemistry Reading Rules

> Load this when: extracting energies, ZPE/H/G corrections, barriers, reaction energies, conformer populations, solvation free energies, or SP//opt composite quantities from Gaussian output.

Do not read one line by habit. The correct energy line depends on the method and the quantity being reported.

## Energy-source discipline

| Case | Use | Do not do |
|---|---|---|
| HF / ordinary DFT electronic energy | final `SCF Done` energy, after normal termination | call it Gibbs free energy |
| MP2 / CC / post-HF / double hybrid | method-specific final correlated energy | blindly use `SCF Done` |
| TD-DFT state energy | excitation energy plus relevant ground-state energy, or Gaussian's TD total-energy line when appropriate | confuse vertical excitation energy with state total energy |
| Opt+Freq thermochemistry | thermal correction from the frequency job at the optimized structure | mix correction from a different structure or PES |
| SP//Opt free energy | `E_SP + (G_opt - E_opt)` with levels stated | imply this is a fully high-level Gibbs free energy |
| solvation free energy estimate | matched gas/solution single points at the same geometry and level | compare gas and solution values with different structures unless intended |

Archive sections and legacy labels can be misleading; prefer the method-specific printed energy lines in the main output.

## Thermochemistry quantities

Gaussian frequency jobs report several distinct quantities. Keep the label exact:

- `E`: electronic energy;
- `E+ZPE`: electronic energy plus zero-point correction;
- `H`: enthalpy with thermal correction;
- `G`: Gibbs free energy with thermal correction.

The default thermochemistry convention is commonly 298.15 K and 1 atm. Use explicit `temperature=` and `pressure=` only when the comparison target differs, and state the values in the report.

## SP//Opt combination

For a high-level single point on a lower-level optimized/frequency-checked structure:

```text
G_approx(level_sp//level_opt) = E_sp(level_sp) + [G_opt(level_opt) - E_opt(level_opt)]
```

Use only when the geometry is validated at the optimization level. This approximation is common, but not equivalent to a frequency calculation at the high-level SP method.

## Barriers and reaction energies

- Barriers and reaction energies should be relative values from consistently treated species.
- For a reaction profile, all stationary points must use compatible electronic state, solvent model, dispersion, and standard state.
- Do not combine raw electronic energy for one species with Gibbs free energy for another.
- For TS barriers, the TS must pass frequency-mode validation and, when important, IRC/path validation before the energy is used.

## Conformers

Use Gibbs free energies for conformer populations when thermal corrections are available. At 298 K, `RT` is about 0.592 kcal/mol. Boltzmann weights are highly sensitive to small ΔG differences, so report the conformer set and whether solvent was included.

## Solution standard state

Gas-phase thermochemistry is often 1 atm; solution-phase free energies are often 1 M. At 298 K, the ideal 1 atm -> 1 M correction is about +1.89 kcal/mol per independently dissolved species. Apply it according to the reaction stoichiometry; it does not cancel when the number of solute species changes.

## Minimum report fields

For every energy table include:

- filename/log path and normal termination status;
- method, basis, dispersion, solvent;
- charge/multiplicity and electronic-state note if relevant;
- energy type (`E`, `E+ZPE`, `H`, `G`, or `E_sp + Gcorr`);
- units and relative reference;
- whether frequency/TS/IRC/stability validation passed.
