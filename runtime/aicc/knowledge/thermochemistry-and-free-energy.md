# Thermochemistry and Free-Energy Assembly

> Covers: assembling electronic energies, ZPE, thermal corrections, entropy, smearing/electronic entropy, phonon free energies, gas/surface/defect references, and when a free-energy expression is valid.

Use this before combining numbers from CP2K, VASP, Gaussian, phonopy, Shermo, VASPKIT, or any other tool.

For VASP-based workflows, this file defines the thermodynamic expression and consistency rules; the practical helper route for frequency/gas corrections is VASPKIT. After the expression is written, use `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` for VASPKIT 501/502 menus, selective-dynamics helper steps, gas `G(T,p)` tables, and validation/provenance expectations.

## Write the expression first

Do not run a set of calculations and invent the thermodynamics later. Define:

- reaction or formation expression;
- reference states and chemical potentials;
- sign convention;
- temperature/pressure/electrode potential/pH if applicable;
- which corrections are included and omitted;
- units.

Examples:

```text
Delta E_rxn = sum(E_products) - sum(E_reactants)
E_ads = E(slab + adsorbate) - E(clean slab) - E(gas adsorbate)
G(T,p) = E_elec + ZPE + Delta H(T) - T S(T) + pV + corrections
```

## Electronic energy is not always the reported free energy

Codes may report multiple energy-like values:

- electronic total energy;
- free energy including smearing entropy;
- extrapolated zero-smearing energy;
- solvation free-energy terms;
- thermostat/barostat conserved quantities in MD.

Use the correct quantity for the expression and keep the choice consistent across all terms.

## Gas-phase corrections

For isolated molecules:

- optimize the right charge/spin/conformer;
- compute frequencies at a stationary point;
- use appropriate standard-state conventions;
- include symmetry number, rotational constants, and low-frequency treatment carefully;
- report whether ideal-gas RRHO assumptions are used.

For VASP gas-molecule frequency outputs, VASPKIT task 502 is the local helper route for temperature/pressure thermochemistry and chemical-potential tables; read `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` before running it and reconcile the output convention with the formula here.

Low-frequency modes can dominate entropy. Hindered-rotor/quasi-RRHO corrections may be better than raw harmonic oscillator entropy for floppy molecules.

## Adsorbates and surfaces

Adsorbed species are not ideal gases. Common choices:

- electronic adsorption energy only;
- ZPE-corrected adsorption energy;
- harmonic adsorbate vibrational correction;
- hindered translator/rotor or quasi-RRHO approximation;
- explicit finite-temperature MD/free-energy sampling.

State the model. Do not silently apply gas-phase translational/rotational entropy to a bound adsorbate.

For VASP adsorbate or transition-state frequency outputs, VASPKIT task 501 is the local helper route for harmonic corrections after the frequency job has been validated. Use fixed-slab/selective-dynamics choices deliberately and record any low-frequency cutoff or entropy approximation.

## Phonon free energies

For solids the vibrational free energy comes from converged phonons/phonon DOS, and is only as trustworthy as the imaginary-mode check, q-mesh/supercell convergence, and (for soft modes) anharmonicity. Get those right with [vibrational-phonon-analysis.md](vibrational-phonon-analysis.md); separate the vibrational free energy from configurational/magnetic/electronic entropy when those are relevant.

## Defect and surface formation energies

Formation energies require chemical potentials and compatible reference phases. For a (possibly charged) defect:

```text
Delta E_f = E_defect - E_pristine + sum_i n_i mu_i + q(E_F + E_VBM) + corrections
```

Use only the applicable terms; charged defects need potential alignment and finite-size corrections. The surface-energy, chemical-potential phase-diagram, and single-atom/defect stability machinery — including the `DeltaN`-sign bookkeeping, chemical-potential bounds, and asymmetric/nonstoichiometric-slab formulas — lives in [surface-thermodynamics.md](surface-thermodynamics.md); use it rather than re-deriving here.

## Solvation and electrochemical cycles

Vacuum, implicit solvent, explicit solvent, and electrode/pH corrections are different thermodynamic models. Combine them only through a written cycle.

Examples:

- gas-phase molecule + solvated surface is not a complete solvation cycle;
- implicit-solvent adsorption energies require all relevant terms to be computed with the same solvent model or a stated correction;
- pH/electrode-potential expressions need consistent proton/electron references.

## Uncertainty and sensitivity

For small energy differences, test sensitivity to:

- functional and dispersion;
- basis/cutoff/grid/k-points;
- slab/vacuum/cell size;
- spin/U/hybrid state;
- smearing/electronic temperature;
- low-frequency entropy treatment;
- solvation/cavity parameters;
- conformer/site coverage.

Report enough uncertainty to support the claim. A 0.03 eV trend is not meaningful if the convergence and model uncertainty is 0.10 eV.

## Reporting checklist

- Written expression and sign convention.
- Electronic-energy source and whether smearing entropy is included.
- ZPE/thermal/entropy/solvation/dipole/finite-size corrections included or omitted.
- Reference states and chemical potentials.
- Stationary-point/frequency/phonon validation.
- Standard state and units.
- Sensitivity tests for the terms that control the conclusion.
