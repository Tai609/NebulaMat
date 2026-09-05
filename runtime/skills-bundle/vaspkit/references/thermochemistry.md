# VASPKIT Thermochemistry and Surface-Thermodynamics Helpers

> Load this when: using VASPKIT for selective dynamics setup, VASP frequency thermochemistry, gas chemical potentials, free-energy corrections, or helper steps in surface thermodynamics/Wulff workflows.

VASPKIT is a helper. The scientific model, balanced reactions, reference states, and surface-energy equations live in the knowledge library (`__NEBULAMAT_AICC_ROOT__/knowledge/surface-thermodynamics.md`).

## Task map

Task numbers can change by VASPKIT version; confirm with the local menu before automating. Commonly used routes:

| Need | VASPKIT route | Notes |
|---|---|---|
| Fix atoms by coordinate range / selective dynamics | `403` | Used before surface frequency jobs; copy `POSCAR_fix` to `POSCAR` after inspection |
| Adsorbate/surface frequency thermochemistry | `5 -> 501 -> T` | Harmonic correction from VASP frequency output |
| Gas molecule thermochemistry / chemical potential | `502 -> T -> p -> ...` | Used for `G(T)` corrections and pressure/temperature grids |
| XDATCAR trajectory conversion | `405` | Useful for checking optimization/MD trajectories in VMD/Jmol |

Always record task ID, menu answers, VASPKIT version, input files, and output lines used.

## Fixing atoms for surface frequencies

For adsorbate or transition-state frequency corrections, usually freeze the slab and release only the adsorbate/reacting atoms.

Typical interactive pattern (menu answers vary by version — verify against the installed menu):

```text
vaspkit
403
1
2
0 0.48
cp POSCAR_fix POSCAR
```

Interpretation depends on the installed VASPKIT menu and coordinate convention. After `POSCAR_fix` is generated:

- inspect selective dynamics flags manually;
- confirm only the intended atoms are `T T T`;
- confirm fixed substrate atoms are `F F F`;
- preserve the pre-fix POSCAR as provenance.

## Adsorbate thermochemistry from VASP frequencies

Run VASP finite-difference frequencies first (`IBRION=5`, `NFREE=2`, tight `EDIFF`, fixed slab atoms as appropriate). Then in the frequency directory:

```text
vaspkit
5
501
298.15
```

Record at least:

```text
Zero-point energy E_ZPE
Thermal correction to U(T)
Thermal correction to H(T)
Thermal correction to G(T)
Entropy S
```

For surface adsorbates, the local convention is to treat translations/rotations as frustrated vibrations and not add a gas-like `nRT` enthalpy term. Low frequencies can inflate entropy; if a cutoff such as 50 or 60 cm^-1 is used, record it.

## Gas molecule thermochemistry and chemical potentials

For gas species, include translation, rotation, vibration, and pressure dependence. Three acceptable routes:

- NIST-JANAF tables: https://janaf.nist.gov/
- Gaussian thermochemistry from molecular frequency calculations.
- VASPKIT task 502 from VASP molecular frequency data.

Local non-interactive example:

```bash
printf '502\n100\n1\n3\n' | vaspkit | grep 'G(T):'
```

If the local VASPKIT version asks a yes/no confirmation in an established workflow, include that answer explicitly in the recorded input sequence, for example `printf '...\ny\n...'`. Do not hide prompts with blind `yes | vaspkit` until the menu path has been tested interactively.

Example output shape:

```text
Thermal correction to G(T): ... kcal/mol ... eV
```

Do not use this number blindly. Determine whether it is a correction relative to the VASP electronic energy, a standard-state quantity, or a menu-specific convention for the installed VASPKIT version. Reconcile it with the reaction-energy formula before building a table.

Pressure dependence for an ideal gas should follow:

```text
Delta_mu(T,p) = Delta_mu(T,p0) + k_B*T*ln(p/p0)
```

For oxygen atom chemical potential:

```text
mu_O = 1/2 * mu_O2
```

## JANAF/NIST linkage

Use JANAF/NIST when common gas thermochemistry dominates the uncertainty or when comparing to experimental thermodynamic conditions. Record:

- species and phase;
- temperature and pressure/standard state;
- whether values are `H(T)-H(0)`, `S(T)`, `G(T)-H(0)`, or another column;
- conversion to eV per molecule;
- how the table value is combined with DFT electronic energy.

Common mistake: mixing an experimental absolute Gibbs energy with a DFT total energy without a shared zero. Write the formula before inserting numbers.

## Batch grids for surface and defect stability diagrams

For RuO2-like `gamma(mu_O)` plots, `(mu_O, mu_CO)` diagrams, or single-atom/defect stability diagrams on metal oxides such as Pt/CeO2, Pt/TiO2, Pt/RuO2, or CuO-derived models with different O-vacancy counts:

1. Generate a temperature/pressure grid for each gas species with VASPKIT 502 or JANAF data.
2. Generate adsorbate or transition-state harmonic corrections from completed VASP frequency jobs with VASPKIT 501 when those terms appear in the free-energy expression.
3. Convert each correction to the chemical-potential or `G_corr` variable used in the VASP surface-thermodynamics equation.
4. Apply bulk/support stability bounds before plotting stable surfaces or stable defect structures.
5. Save the raw `T, p, Delta_mu` and adsorbate `G_corr` tables beside the phase diagram.

Suggested output table columns:

```text
species,T_K,p_bar,Delta_mu_eV,mu_absolute_or_relative,source,notes
```

For adsorbate or transition-state corrections, keep a companion table with:

```text
species_or_state,T_K,G_corr_eV,ZPE_eV,S_eV_per_K,frequency_dir,free_atoms,vaspkit_task,notes
```

For single-atom/defect diagrams, also keep a candidate table with:

```text
candidate,E_model,E_ref,metal_reference,DeltaN_O,DeltaN_Ce,DeltaN_other,Phi_formula,notes
```

Do not let VASPKIT hide the chemistry. The slope of each line still comes from the atom-count differences and reservoir choices in the VASP thermodynamic expression; VASPKIT only helps supply gas chemical potentials or vibrational/free-energy corrections.

## Validation

- Upstream VASP frequency jobs finished and contain the expected number of finite-difference steps.
- VASPKIT parsed the intended `OUTCAR`/frequency file, not a stale file in the directory.
- Units are converted explicitly: kcal/mol, kJ/mol, Hartree, eV, cm^-1.
- Adsorbate corrections and gas corrections are not mixed without a balanced reaction expression.
- Every pressure correction states the standard pressure (`p0`) and whether pressure is in bar, atm, or Pa.
