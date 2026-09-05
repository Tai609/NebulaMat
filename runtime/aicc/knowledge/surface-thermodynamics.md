# Surface Thermodynamics, Vibrations, and Wulff Construction

> Covers: surface energies, chemical-potential-dependent surface stability, oxide surface phase diagrams, oxygen-coverage phase diagrams under an O2 atmosphere, adsorbate/transition-state vibrational frequencies and free-energy corrections, Wulff constructions.

Tool-agnostic science and practice — the formalism, equations, and how to set up and read these calculations; the same physics applies whichever DFT code produces the energies. Starting points to adapt, not fixed rules. *How to run* the underlying calculations lives in the tool skills (`__NEBULAMAT_AICC_ROOT__/tools/vasp` for slabs/frequencies; `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` for VASPKIT correction menus).

## Scope and dependencies

Surface thermodynamics links multiple calculations. Do not start from a single slab energy and call it a result.

Required ingredients:

- bulk reference calculation with converged cell and final static energy;
- slab calculations for every termination/facet/coverage being compared;
- consistent functional, ENCUT, POTCAR mapping, U/vdW/spin/dipole settings, and comparable k-point density;
- explicitly stated reference states and stoichiometry;
- vibrational/free-energy corrections only where they are physically meaningful and consistently applied;
- uncertainty notes for approximations such as neglecting slab vibrational free energies.

## Scripted free-energy evaluation guardrail

When writing a script or notebook for `gamma(mu)`, `DeltaG_O`, `Phi(mu)`, or reaction free energies, do not start by parsing total energies alone. First build an explicit correction table and pass it into the script. For VASP-backed workflows, load the `vaspkit` skill and `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` before coding correction extraction.

Minimum correction inputs:

- adsorbate or transition-state terms: run VASP finite-difference frequencies at the same method level; usually fix slab atoms and free only the adsorbate or reacting atoms; process harmonic corrections with VASPKIT task 501; record the frequency directory, free-atom set, temperature, units, and any low-frequency cutoff;
- gas terms: use JANAF/NIST, Gaussian thermochemistry, or VASP molecular frequency data processed with VASPKIT task 502; record the standard pressure, pressure unit, spin/reference scheme (especially for O2), and whether the value is a correction relative to `E_DFT` or an absolute chemical potential;
- slab and bulk vibrational terms: include them consistently or record the approximation that they are neglected; never silently set missing correction terms to zero.

## Clean stoichiometric surface energy

For a symmetric slab with both surfaces equivalent and fully relaxed:

```text
gamma = (E_slab - n * E_bulk_unit) / (2 * A)
```

Where:

- `E_slab` is the final slab energy;
- `E_bulk_unit` is the energy per atom or per formula unit matching `n`;
- `n` is the number of atoms/formula units in the slab;
- `A` is one-side surface area; the factor 2 accounts for top and bottom surfaces.

Unit conversion:

```text
1 eV/A^2 = 16.0218 J/m^2
```

Rules:

- For method 1, do not fix bottom layers: both surfaces contribute relaxation and must be treated equivalently.
- Use a thick enough slab and vacuum; test thickness if gamma is central to the conclusion.
- Keep bulk and slab settings comparable. Bulk and slab k-meshes do not need identical integers, but the reciprocal-space density must be comparable; slab has one k-point along vacuum.
- Use `E0` consistently from the final OSZICAR/OUTCAR, not mixed `F` and `E0` values.

A representative Au surface-energy workflow follows this pattern: optimize bulk Au, run a bulk static calculation, cut p(1x1) slabs such as (100), (110), (111), relax slabs, then evaluate gamma for each facet.

## Fixed-bottom slab correction

If a slab model fixes the bottom layers and only relaxes the top surface, split the surface energy into cut and relaxation terms:

```text
gamma = (E_slab_unrelaxed - n * E_bulk_unit) / (2 * A)
      + (E_slab_relaxed - E_slab_unrelaxed) / A
```

This avoids pretending that the fixed bottom surface gained the same relaxation energy as the free top surface. The unrelaxed and relaxed slabs must have the same atom count, cell, termination, constraints, and electronic settings except for ionic relaxation.

## Adsorption and coverage energies

For one molecular adsorbate:

```text
E_ads = E_adsorbate_slab - E_clean_slab - E_gas
```

For atomic fragments referenced to a gas molecule:

```text
E_ads(O*) = E_O_slab - E_clean_slab - 1/2 * E_O2
```

For N adsorbates on a cell with N0 sites:

```text
theta = N / N0
E_ads_avg(theta) = (E_slab+Nads - E_clean_slab - N * E_ads_ref) / N
```

Rules:

- State the sign convention. Many papers report `-E_ads` as a positive binding energy.
- Enumerate plausible sites. A top/bridge guess that relaxes to hollow is not a stable adsorption site.
- Set `ISYM=0` for adsorbates and low-symmetry surfaces unless there is a specific reason not to.
- For physical adsorption and weakly bound molecules, vdW corrections are usually part of the method, not an optional afterthought.
- Gas molecules need their own validated setup: large box, Gamma-only, correct spin/multiplicity, and thermochemical correction strategy.

## Oxygen coverage as a clean-slab grand potential

Oxygen-coverage phase diagrams are a special case of chemical-potential-dependent surface thermodynamics. If the surface cell, support/metal atom counts, slab thickness, constraints, and electronic settings are fixed, and only the number of adsorbed O atoms changes, use the clean slab as the reference instead of subtracting a bulk support term. This is the same grand-potential logic as

```text
Phi_j(mu_O) = E_j - N_CeO2 * E_CeO2_bulk - n_A * mu_A
              - DeltaN_O,j * mu_O - DeltaN_Ce,j * mu_Ce
```

but with no changing cation/support reservoir and no need for `N_CeO2 * E_CeO2_bulk`:

```text
DeltaG_O(N_O; T,p) = G_slab(N_O; T,p) - G_clean(T,p) - N_O * mu_O(T,p_O2)
```

Equivalently, when referencing the oxygen reservoir to O2:

```text
DeltaG_O(N_O; T,p) = G_slab(N_O; T,p) - G_clean(T,p)
                     - (N_O / 2) * mu_O2(T,p_O2)
```

If surface vibrational corrections are neglected consistently:

```text
DeltaG_O(N_O; T,p) ~= E_slab(N_O) - E_clean - (N_O / 2) * mu_O2(T,p_O2)
```

Use this quantity to compare O coverage states in the same surface cell. The stable oxygen coverage at a given `(T,p_O2)` is the state with the lowest total `DeltaG_O`, not necessarily the most negative average adsorption energy. If the y-axis should be a surface free energy rather than a cell grand potential, divide by the exposed area and state whether the slab is one-sided or two-sided:

```text
gamma_O(N_O; T,p) = DeltaG_O(N_O; T,p) / A_active
```

Use `A_active = A` for a one-sided adsorbate slab model with a fixed/passivated bottom or only the top surface decorated. Use `2*A` only when both surfaces are equivalent and decorated consistently.

Required coverage-series records:

- clean reference slab and every O-covered slab share the same surface cell, slab model, constraints, k-point density, spin/U/vdW/dipole settings, and convergence criteria;
- `N_O` is the number of adsorbed O atoms relative to the clean reference, not the total O count in an oxide support;
- `N_site` is the adsorption-site basis used for coverage, with `theta_O = N_O / N_site`;
- each candidate records final energy, convergence status, and whether adsorbed O remained on the intended sites;
- coverage states from different surface-cell sizes are compared only after normalization to a shared basis, with lateral O-O interactions treated as part of the model.

Average adsorption free energy per adsorbed O:

```text
G_ads_avg(N_O; T,p) = [G_slab(N_O) - G_clean
                       - (N_O / 2) * mu_O2(T,p_O2)] / N_O
```

Incremental adsorption free energy for adding the next O atom:

```text
G_ads_step(N_O) = G_slab(N_O) - G_slab(N_O - 1)
                  - 1/2 * mu_O2(T,p_O2)
```

Interpretation:

- `G_ads_avg < 0` means that average O coverage is favorable relative to `1/2 O2` at the chosen `(T,p_O2)`;
- `G_ads_step(N_O) < 0` means adding the `N_O`-th O atom is favorable from the previous coverage;
- the phase diagram lower envelope is built from total `DeltaG_O`, while average and incremental values answer different questions.

A common compatible oxygen chemical-potential expression is:

```text
mu_O2(T,p) = E_DFT_O2 + ZPE_O2 + Delta_mu_O2(T,p0)
             + k_B*T*ln(p_O2/p0)
mu_O(T,p)  = 1/2 * mu_O2(T,p)
```

Use the actual oxygen partial pressure, `p_O2 = y_O2 * p_total`, not the total feed pressure. Record whether `E_DFT_O2` is raw VASP O2, fitted/corrected O2, or replaced by an experimental reference scheme. If using JANAF-style data, reconcile the reference state with the DFT energy zero before mixing it into the expression.

Coverage workflow:

1. Enumerate O adsorption configurations for each `N_O`; relax all plausible sites.
2. If dopant segregation or reconstruction is part of the question, enumerate those structures for each coverage.
3. Build the correction table first, then compute `DeltaG_O(N_O; T,p)` over the target `T,p_O2` grid or at the reaction condition.
4. Plot all coverage states with the same reference zero and highlight the lower envelope.
5. Use the selected coverage for mechanism calculations only within the gas-condition range where it is lowest in free energy.

For a single reaction condition, a table is often clearer than a full phase diagram:

| candidate | `N_O` | `theta_O` | `DeltaG_O` | `G_ads_avg` | stable? |
|---|---:|---:|---:|---:|---|
| clean | 0 | 0 | 0 | n/a | compare |
| O1 | 1 | `1/N_site` | value | value | compare |
| O2 | 2 | `2/N_site` | value | value | lowest? |

## Chemical-potential-dependent surface energy

For non-stoichiometric or adsorbate-covered surfaces, express surface stability as a function of chemical potentials. Choose a stable bulk reservoir first.

For RuO2 surfaces with O chemical potential:

```text
gamma(mu_O) = [G_slab - N_Ru * G_RuO2_bulk + (2*N_Ru - N_O) * mu_O] / (2*A)
```

Equivalent interpretation: each Ru atom is referenced to one RuO2 formula unit, and the oxygen excess/deficit is balanced by `mu_O`.

For a surface also containing CO adsorbates:

```text
gamma(mu_O, mu_CO) = [G_slab - N_Ru * G_RuO2_bulk
                      + (2*N_Ru - N_O) * mu_O
                      - N_CO * mu_CO] / (2*A)
```

Rules:

- Count atoms for every slab: `N_Ru`, `N_O`, `N_CO`, and any dopants/support atoms. A wrong stoichiometric coefficient changes the slope and invalidates the phase diagram.
- If the slab is stoichiometric with the bulk reference, the chemical-potential slope term vanishes.
- It is common to approximate `G_slab` and `G_bulk` with DFT total energies because slab/bulk vibrational corrections often partly cancel. State this approximation explicitly.
- Gas-phase chemical potentials usually do not cancel and must be corrected for temperature and pressure.

## Single-atom and defect stability diagrams

The same chemical-potential formalism is useful beyond oxide/metal surface energies. It can compare which supported single-atom, vacancy, or small-cluster configuration is thermodynamically favored under an oxygen chemical potential. Pt/CeO2 is only one example. The supported metal can be Pt, Pd, Rh, Ru, Ir, Au, Cu, Ni, Co, Fe, or another element, and the support can be another oxide such as TiO2, RuO2, CuO, FeOx, CoOx, or a mixed oxide. Replace the supported-metal reservoir, bulk oxide reservoir, metal/oxygen stoichiometry, and competing-phase bounds with the system actually being modeled.

Choose one clean support or reference support model and write every candidate as a defect/dopant excess relative to it:

```text
Phi_j(mu) = G_j - G_ref - n_A * mu_A - sum_i DeltaN_i,j * mu_i
```

Where:

- `G_j` is the energy/free energy of candidate structure `j`;
- `G_ref` is the chosen support reference with the same cell size, for example clean CeO2 slab or another explicitly stated baseline;
- `n_A * mu_A` accounts for added supported metal atoms `A`, referenced to bulk metal, an isolated atom, a gas/solution precursor, or a cluster/nanoparticle reference depending on the scientific question;
- `DeltaN_i,j = N_i,j - N_i,ref` is the excess of reservoir species `i` relative to the reference support.

For a supported metal `A` on CeO2, such as Pt/CeO2:

```text
mu_Ce = mu_CeO2_bulk - 2 * mu_O
Phi_j(mu_O) = E_j - N_CeO2 * E_CeO2_bulk - n_A * mu_A
              - DeltaN_O,j * mu_O - DeltaN_Ce,j * mu_Ce
```

For a general oxide `M_xO_y`, the cation chemical potential constrained by the bulk oxide is:

```text
x * mu_M + y * mu_O = mu_MxOy_bulk
mu_M = (mu_MxOy_bulk - y * mu_O) / x
```

Examples:

```text
TiO2:  mu_Ti = mu_TiO2_bulk - 2 * mu_O
RuO2:  mu_Ru = mu_RuO2_bulk - 2 * mu_O
CuO:   mu_Cu = mu_CuO_bulk - mu_O
Cu2O:  mu_Cu = (mu_Cu2O_bulk - mu_O) / 2
```

Use the oxide phase that defines the support reservoir for the model. If multiple bulk oxides or reduced phases are plausible, include the relevant competing-phase bounds rather than assuming the chosen oxide is stable across the whole `mu_O` range.

Interpretation:

- An O vacancy has `DeltaN_O = -1`, so it contributes `+mu_O`; oxygen-poor conditions stabilize vacancy-containing structures.
- A Ce vacancy has `DeltaN_Ce = -1`; if `mu_Ce` is constrained by CeO2, this introduces a `mu_O` slope through `mu_Ce = mu_CeO2 - 2*mu_O`.
- Two O vacancies have twice the oxygen slope. Mixed defects have the sum of all reservoir terms.
- If the y-axis is a formation energy or grand-potential difference, the stable configuration at each `mu_O` is the lowest line, or the lower envelope, within the allowed chemical-potential bounds.

Choose the y-axis from the scientific question:

| Question | Better y-axis | Readout |
|---|---|---|
| Which candidate structure is most stable at each oxygen chemical potential? | `E_form(mu_O)` or `Phi(mu_O)` | lowest line is most stable |
| How far above the stable candidate is each metastable structure? | `Delta Phi(mu_O)` relative to the lower envelope or a named reference | zero line/reference line marks degeneracy |
| What supported-metal reservoir chemical potential would make this configuration competitive? | `mu_A(mu_O)` | threshold line; read with the stated inequality |

For most single-atom/defect comparisons, use `E_form(mu_O)` or `Phi(mu_O)` on the y-axis. It is easier to read and maps directly onto the question "which structure is thermodynamically preferred?". Do not label the y-axis vaguely as "energy" unless the reference is obvious from the formula. Use names such as `formation energy relative to clean support + Pt_bulk`, `grand potential difference per cell`, or `relative stability vs Pt10`, and state whether values are per cell, per metal atom, or per surface area.

Use a metal chemical potential on the y-axis only when that is the intended thermodynamic variable. Rearrange the same expression instead of inventing a new model:

```text
mu_A,j(mu_O) = [G_j - G_ref - sum_i DeltaN_i,j * mu_i] / n_A
```

This is useful for reservoir-threshold maps, for example plotting the `mu_Pt` required for a Pt single atom, Pt cluster, or supported nanoparticle to be thermodynamically competitive at each `mu_O`. The same plot can be made for other supported metals by replacing Pt with the chosen element. State the metal reference line, such as bulk Pt, Pt10, bulk Cu, or a named nanoparticle model, and define whether the stable region is read as the lower or upper envelope from the grand-potential inequality.

## Wrong-conditions models: a clean surface is often too reducing for an oxidizing experiment

A frequent and expensive mistake: testing a claim about a metal formed/operated under **oxidizing** conditions (calcination in air, O-rich or aqueous/hydroxylated environment) on a **clean, stoichiometric or cation-terminated** slab. The clean-slab adatom relaxes to a *reduced*, metal-coordinated site (short M–support-cation bond, near-zero/negative charge) — the wrong oxidation state — so its binding energy and charge answer a different question than the experiment poses. Taking that binding contrast at face value can manufacture a false `contradicts` (or a false confirmation).

The fix is a modeling decision, not a parameter tweak, and is an approval-gate item: impose the experiment's oxygen chemical potential. Either model the **O-terminated / O-rich (or hydroxylated) surface** so the metal can take its oxidized M–Oₙ coordination, and/or reference the energetics to an oxidizing reservoir (a volatile oxide species such as MOₓ(g), or μ_O fixed by T,p; see the next section and "single-atom and defect stability diagrams"). The oxidation-state side of this is in `electronic-structure.md` ("the surface termination sets the metal's oxidation state"). State explicitly what the clean-surface model can and cannot test before reporting any number from it.

## Scoping expensive surface calculations (feasibility, not just convergence)

Thickness/coverage *convergence* (above) is a science question; *feasibility* is a separate planning decision that is easy to skip and then blow a compute budget on. Magnetic, +U oxide surfaces (hematite, magnetite, NiO, ceria) are the usual offenders — a (2×2) AFM+U slab campaign is multi-day, a (1×1) is hours. Before launching:

- Decide what actually needs the big cell. A *binding-energy contrast* between two supports/sites is largely coverage-robust and can be settled in a small cell; an isolated-adsorbate property that must avoid adsorbate–image interaction (or a specific EXAFS coordination shell, e.g. no spurious M–M neighbor) needs the larger cell — size to the observable, not to habit.
- Cost scales steeply with magnetic + U + exact-exchange and with k-points × bands × ions; a small high-symmetry cell to fix the magnetic ground state and settings first, then one production cell, beats a speculative large run.
- Record the scoping choice and its justification in `workflow.md` (assumptions table) so a reviewer sees why the cell size is adequate for the claim.

## Volatile metal-oxide reservoirs and atom trapping

High-temperature oxidizing treatments can move a supported metal through volatile gas-phase species such as `PtO2(g)`, not only through a bulk-metal reservoir. Treat these cases as ordinary balanced reaction free energies rather than forcing them into an O-coverage phase diagram. Examples include evaporation from a stepped metal surface and trapping of a volatile oxide on an oxide support:

```text
M(slab) -> slab-with-M-removed + M(g)
MOn(g) + support -> M@support + (n/2) O2(g)
```

For any such reaction, write the stoichiometric free energy directly:

```text
DeltaG_rxn(T,p) = sum_products nu_k * G_k(T,p)
                  - sum_reactants nu_k * G_k(T,p)
```

Use DFT total energies for slab-like terms and add thermochemical corrections for gas-phase species:

```text
G_gas(T,p) = E_DFT + ZPE + DeltaH_0->T - T*S(T,p0)
             + k_B*T*ln(p/p0)
```

For gas molecules, include translational, rotational, vibrational, and ZPE contributions from a documented thermochemistry source or frequency calculation. For isolated gas atoms, rotational and vibrational terms are absent, but translational entropy and the pressure standard state still matter. Slab entropy and enthalpy corrections are often neglected for high-temperature stability estimates because they are expensive and may partly cancel, but this is an approximation that must be stated.

Rules:

- Balance the reaction before calculating energies; every missing gas molecule changes the oxygen-chemical-potential dependence.
- Divide row-removal or multi-atom evaporation energies by the number of metal atoms only after computing the total balanced reaction energy.
- Use actual gas partial pressures for pressure corrections, not total pressure unless the gas is pure.
- Do not mix `Pt(g)`, `PtO2(g)`, bulk Pt, and supported Pt references without saying which reservoir answers the stability question.
- For atom-trapping comparisons across supports, keep the same volatile precursor and gas products so differences reflect support binding, not inconsistent reservoirs.

Spreadsheet pattern:

```text
candidate,E_model,N_ref_formula,DeltaN_O,DeltaN_cation,n_A,E_form(mu_O)
A@CeO2,E_model,N_CeO2,0,0,1,E_model - N_CeO2*E_CeO2 - mu_A
A-Ov,E_model,N_CeO2,-1,0,1,E_model - N_CeO2*E_CeO2 - mu_A + mu_O
A-Cev,E_model,N_CeO2,0,-1,1,E_model - N_CeO2*E_CeO2 - mu_A + mu_Ce
A-Ov-Cev,E_model,N_CeO2,-1,-1,1,E_model - N_CeO2*E_CeO2 - mu_A + mu_O + mu_Ce
```

Validation rules:

- All candidate cells must have the same support size, slab thickness, vacuum, k-point density, and electronic settings unless the deviation is part of the stated model.
- Check that each `DeltaN` sign matches the actual POSCAR atom counts. A missing O is `DeltaN_O = -1`, not `+1`.
- State the supported-metal reference. Bulk metal, gas-phase atom, molecular/solution precursor, metal cluster, and supported nanoparticle answer different questions and cannot be mixed silently.
- Apply the bulk/support stability window before interpreting line crossings.
- If reduced Ce states are important, record how spin, U value, and localization were treated; a chemically wrong reduction pattern can change the relative stability.

## Chemical-potential bounds

Chemical potentials are not free over all real values. For RuO2:

O-rich upper bound:

```text
mu_O <= 1/2 * G_O2(T,p)
```

O-poor lower bound from RuO2 decomposition to Ru metal:

```text
mu_O >= 1/2 * (G_RuO2_bulk - G_Ru_bulk)
```

Other oxides may decompose into lower oxides instead of metal plus oxygen; choose the most relevant competing phase and document it.

For mixed O/CO atmospheres, include constraints that prevent bulk oxide reduction or gas-phase reactions from making the assumed surface reservoir unstable. Example logic for CO reducing RuO2:

```text
2 CO + RuO2 -> Ru + 2 CO2
```

Use the reaction free energy inequality to mark forbidden regions in `(mu_O, mu_CO)` space. Do not report a surface phase as stable outside the stability window of the underlying bulk/support.

## Mapping mu(T,p)

For an ideal gas species `i`:

```text
mu_i(T,p) = E_DFT_i + ZPE_i + Delta_mu_i(T,p0) + k_B*T*ln(p/p0)
```

For O atom chemical potential from O2:

```text
mu_O(T,p_O2) = 1/2 * mu_O2(T,p_O2)
```

Ways to obtain `Delta_mu`:

- NIST-JANAF tables: preferred when reliable experimental thermochemistry is available and the reference state is clear.
- VASPKIT gas thermochemistry, usually task 502: the local VASP-based helper route for gas calculations and pressure/temperature grids; load `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` for menus, validation, and provenance.
- Gaussian frequency/thermochemistry: often used for gas molecules; record method and standard-state corrections.

Reference consistency is the main risk. Do not mix a JANAF absolute chemical potential with a DFT energy expression unless the zero of energy and correction terms are explicitly reconciled.

## Vibrational frequencies in VASP

Optimization and frequency analysis must use the same level of theory: functional, ENCUT, k-points, U, vdW, dipole correction, spin, solvation, and relevant precision settings.

Finite-difference frequency template:

```ini
EDIFF  = 1E-7
IBRION = 5
POTIM  = 0.015
NSW    = 300       # do not set 0 for finite differences
ISIF   = 2
NFREE  = 2
ISYM   = 0
```

Notes:

- For surfaces, usually fix the slab atoms and release only adsorbates or the reacting atoms whose vibrational correction is needed. Use VASPKIT task 403 or careful POSCAR selective dynamics editing, then copy `POSCAR_fix` to `POSCAR`.
- The number of ionic force calculations is `6 * N_free_atoms + 1` for `NFREE=2`.
- Check progress with `grep -3 Finite OUTCAR` and final modes near the end of `OUTCAR`.
- For minima, no imaginary frequencies should remain in the active subspace. For transition states, exactly one imaginary mode should follow the reaction coordinate.
- Low-frequency adsorbate modes can give unphysical entropy. A common pragmatic treatment is to replace very low modes below about 50-60 cm^-1 with that cutoff for entropy estimates; state the cutoff.

## Vibrational spectra

VASP finite-difference frequencies give modes but not automatically a full experimental spectrum.

IR with DFPT/Born charges:

```ini
# Do not set KPAR for this task unless the local VASP build is known to support it safely.
IBRION   = 7      # DFPT without symmetry; 8 uses symmetry
LEPSILON = .TRUE.
NSW      = 1
NWRITE   = 3
ISYM     = 0
```

Then post-process frequencies and intensities with a recorded, versioned script (community tools such as `VASP-infrared-intensities` exist for this); record the exact script path/version and the columns used for `spectra.dat` in the run record.

Raman activity is not a default VASP frequency output. If Raman spectra are required, use a validated Raman workflow (for example finite differences of dielectric tensors with a known script) and document the method; do not infer Raman intensities from frequencies alone.

## Free-energy corrections for surface reactions

For a reaction state:

```text
G_state(T,p) = E_DFT + G_corr_adsorbates_or_gas(T,p)
```

Surface adsorbates:

- Use VASP frequencies with fixed slab atoms when the correction is for an adsorbate or TS on a surface.
- VASPKIT task 501 is the local helper route for harmonic thermochemistry from the frequency output for adsorbate-like systems; use `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` for the exact menu path and output checks.
- For adsorbed species, translational and rotational gas-like entropy is usually suppressed; treat active modes as vibrations.
- Do not add an `nRT` gas enthalpy term to adsorbed species unless the chosen thermochemical model explicitly requires it.

Gas molecules:

- Include translation, rotation, vibration, and pressure dependence.
- Use NIST-JANAF, VASPKIT 502, or Gaussian thermochemistry. Prefer experimental JANAF data for common stable gases when compatible with the reference scheme.
- Correct spin-sensitive species such as O2 carefully. Record whether the O2 reference is DFT raw, corrected, or experimental-thermochemical.

Build reaction profiles by writing the balanced reaction for every state first. Example for O migration from gas reference:

```text
1/2 O2 + * -> O*(FCC) -> TS -> O*(HCP)
```

Then put every state on the same free-energy zero. Never combine corrected gas energies with uncorrected adsorbate energies without saying that approximation was made.

## Wulff construction

Wulff construction needs a set of surface energies for facets, not a single number.

Workflow:

1. Compute converged `gamma_hkl` for the relevant facets, e.g. (100), (110), (111).
2. Use consistent units. Wulff uses ratios, so eV/A^2 and J/m^2 both work if not mixed.
3. Provide `(hkl, gamma)` to VESTA, ASE, pymatgen, or another Wulff tool.
4. Interpret the exposed area fractions as equilibrium thermodynamic morphology, not a kinetic growth shape.

For environment-dependent morphology, repeat the Wulff construction at each `(T,p)` or chemical-potential condition using `gamma_hkl(T,p)`. Adsorbates can change relative surface energies and therefore the predicted nanoparticle shape.

## Worked example pattern

A representative Au spreadsheet uses `Ebulk = -12.894514/4 = -3.2236285 eV/atom`, separates cut and relaxation terms for fixed-bottom slabs, and reports representative Au surface energies:

| Facet/model | gamma (eV/A^2) | gamma (J/m^2) | Note |
|---|---:|---:|---|
| Au(100) | 0.05548 | 0.889 | fixed-bottom cut + relaxation form |
| Au(110) | 0.05815 | 0.932 | fixed-bottom cut + relaxation form |
| Au(111) | 0.04628 | 0.741 | fixed-bottom cut + relaxation form |
| Au(111), 9-atom small model | 0.04438 | 0.711 | symmetric formula example |

Reusable pattern from the examples:

```text
celloptAu/       bulk cell optimization
celloptAu/sp/    bulk single-point energy used as E_bulk_unit
100/, 110/, 111/ slab facet calculations
*/opt/           corresponding slab relaxation directories where present
```

When extracting energies, use the final OSZICAR `E0` consistently. Preserve the spreadsheet formula or reproduce it in a script/notebook with explicit `A`, `n`, and unit conversion.

## Validation checklist

- Bulk and slab calculations converged and use compatible settings.
- Surface area `A` computed from the actual final slab cell vectors in the surface plane.
- Atom/formula counts match the chosen formula exactly.
- Fixed-bottom slabs use the cut-plus-relaxation formula, not the symmetric-slab formula.
- Chemical-potential bounds are shown on any phase diagram.
- Single-atom/defect stability diagrams state the support reference, metal reservoir, `DeltaN` signs, and whether the y-axis is per cell, per metal atom, or per surface area.
- Gas chemical potentials include temperature and pressure corrections, or the omission is justified.
- Frequency corrections use the intended free atoms only; fixed atoms are actually fixed in POSCAR.
- Scripts/notebooks read a provenance-bearing correction table instead of hardcoding missing corrections as zero.
- All thermodynamic plots state energy zero, pressure standard state, temperature, and units.
