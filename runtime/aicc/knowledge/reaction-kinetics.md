# Surface Reaction Kinetics

> Covers: converting DFT energies/free energies into rate constants, elementary-step rates, reaction mechanisms, RDS/TDTS/TDI analysis, BEP relations, volcano curves, and microkinetic-model inputs.

Tool-agnostic science and practice — the bridge from computed thermochemistry to kinetics; the same formalism applies whichever code produced the energies. Starting points to adapt, not fixed rules. It does not replace a microkinetic solver: for CatMAP execution use `__NEBULAMAT_AICC_ROOT__/tools/catmap`.

## Required inputs

- Balanced overall reaction and all proposed elementary steps.
- Free-energy diagram at the target temperature and pressure, including intermediates and transition states.
- Site definitions and site balance: one site type or multiple site types, site density/area if adsorption rates need absolute units.
- Gas partial pressures or concentrations, and a clear standard state.
- A decision on whether to use hand analysis, a rate-determining approximation, or a full microkinetic model such as CatMAP.

## Elementary rates

For an elementary surface step, write forward and reverse rates explicitly before inserting numbers.

```text
A* <-> B*
r_f = k_f theta_A
r_r = k_r theta_B
R = r_f - r_r
```

Bimolecular Langmuir-Hinshelwood step:

```text
A* + B* <-> AB* + *
r_f = k_f theta_A theta_B
r_r = k_r theta_AB theta_*
```

Eley-Rideal step:

```text
A* + B_g <-> AB* + *
r_f = k_f theta_A p_B
r_r = k_r theta_AB theta_*
```

Surface site balance must close:

```text
sum_i theta_i = 1
```

For multiple site types, write one balance per site type.

## TST and Eyring rate constants

For activated elementary steps, use the free-energy barrier at the target condition:

```text
k(T) = (k_B*T/h) * exp(-DeltaG_a/(k_B*T))
```

Rules:

- `DeltaG_a` is the free energy of the transition state minus the relevant initial state for that elementary step.
- Use the same free-energy zero for all species in a path.
- The usual default is transmission coefficient `kappa = 1`. State this; tunneling, recrossing, and dynamic effects are outside plain TST.
- A 0.1 eV barrier error can change rates by orders of magnitude. Report kinetics as order-of-magnitude unless uncertainties are quantified.

A rough activity screen often treats `r > 1 site^-1 s^-1` as facile, but this is only a heuristic; mechanism, pressure, and site density matter.

## Adsorption and desorption

Barrierless adsorption cannot usually be treated by the same TS frequency model as activated surface steps. A common gas collision form is a Knudsen-Langmuir-like adsorption rate constant:

```text
k_ads ~ S0 * a_site / sqrt(2*pi*m*k_B*T) * exp(-DeltaE_ads^‡/(k_B*T))
```

Practical rules:

- If no adsorption barrier is known, set the exponential term to 1 and document the sticking coefficient `S0`.
- Literature often uses `S0` between about 0.5 and 1 for rough modeling; rates are usually less sensitive to `S0` than to DFT barriers.
- Desorption can be obtained either from detailed balance (`K = k_ads/k_des`) or from a desorption free-energy barrier in Eyring form.
- Keep gas pressure units consistent with the microkinetic model convention.

## Mechanism classes

Langmuir-Hinshelwood (LH): both reactants adsorb before reacting.

```text
A_g + * <-> A*
B_g + * <-> B*
A* + B* -> AB_g + 2*
```

High coverage by either A* or B* can poison the surface and lower TOF.

Eley-Rideal (ER): one adsorbed species reacts with a gas-phase species.

```text
A_g + * <-> A*
A* + B_g -> AB_g + *
```

Mars-van Krevelen (MvK): lattice atoms/vacancies participate; include vacancy and reoxidation steps and maintain the support stoichiometry balance.

## Steady-state microkinetics

Mean-field microkinetic modeling usually assumes:

1. steady state: all `d theta_i / dt = 0`;
2. mean-field coverages: adsorbate energies do not depend explicitly on local configurations unless interactions are modeled;
3. fixed gas pressures/concentrations during the steady-state solve.

Workflow:

1. Compute all intermediate and transition-state free energies.
2. Convert elementary barriers/free energies to forward and reverse rate constants with thermodynamic consistency.
3. Build rate expressions and site balances.
4. Solve for steady-state coverages.
5. Compute TOF, production rates, selectivity, apparent activation energy, and reaction orders.

If two or more steps have similar kinetic control, a single RDS approximation is unreliable; solve the full microkinetic equations.

## RDS, TDTS, and TDI

The slowest elementary `k` is not always the kinetic bottleneck because coverages and reversibility couple steps.

For a simple RDS approximation:

```text
TOF ~ k_RDS * activity_of_RDS_initial_state * (1 - gamma)
```

where `gamma` is the overall reversibility. When `gamma = 1`, the net rate is zero at equilibrium.

For energy-span thinking, identify:

- TDTS: TOF-determining transition state, often the highest relevant TS in the cycle;
- TDI: TOF-determining intermediate, often the most stable resting state;
- effective span: `DeltaG_eff ~ G_TDTS - G_TDI` plus cycle corrections.

Use this as interpretation, not a replacement for microkinetics when multiple pathways or coverages matter.

## BEP relations and volcano curves

For related elementary reactions, a Bronsted-Evans-Polanyi relation may approximate barriers:

```text
E_a = E0 + alpha * DeltaE
```

Rules:

- Fit only chemically similar reactions. Different mechanisms or active-site families usually need separate lines.
- Slopes and intercepts can differ between terraces, steps, alloys, oxides, and supports.
- Outliers are scientifically meaningful; do not force BEP if the electronic structure changes qualitatively.

Volcano curves connect a descriptor, often an adsorption energy, to TOF. The left/right sides usually reflect different limitations such as weak binding versus poisoning/desorption limits. Near the volcano top, RDS approximations often overestimate TOF because several steps compete; use microkinetics.

## Preparing data for CatMAP

Use CatMAP when the mechanism has several coupled steps, multiple coverages, descriptor scans, temperature/pressure maps, or volcano plots.

Prepare:

- species names with consistent suffixes (`_g`, `*_s`, transition-state names);
- free energies or electronic energies plus frequencies for gases/adsorbates/transition states;
- site names and total site balances;
- reaction expressions with reversible steps and transition states;
- descriptor names/ranges if scaling or volcano maps are needed.

Then switch to the `catmap` skill for file formats, setup parameters, execution, and output validation.

## Validation checklist

- Every elementary step is atom-balanced and site-balanced.
- Forward and reverse barriers satisfy thermodynamic consistency with the reaction free energy.
- Gas pressures and standard states match the thermochemistry correction scheme.
- The chosen mechanism class is stated: LH, ER, MvK, or mixed.
- Report whether results are RDS estimates, energy-span interpretation, or full microkinetic solutions.
