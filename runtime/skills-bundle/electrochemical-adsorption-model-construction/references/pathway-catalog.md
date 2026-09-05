# Electrochemical HER/OER Pathway Catalog

Use this catalog to build a complete, environment-specific state graph. `*` is a clean catalytic site. A label such as `H*` means an explicitly constructed adsorbed structure, not a gas-phase reference. These reactions are stoichiometric bookkeeping for model construction; they are not permission to derive free energies from uncorrected UMA energies.

## Scope and references

Record the reaction, environment, pH/electrolyte, temperature, potential convention, charge/spin state, and mechanism branch in every pathway manifest. Keep gas or solvent references (`H2(g)`, `O2(g)`, `H2O(l)`, and, where needed, `H2O(g)`) separate from slab-bound intermediates. For a surface calculation, preserve the same reference convention for every facet and coverage.

The computational hydrogen electrode relation between proton/electron chemical potential and hydrogen is a thermochemical convention, not an adsorption-energy correction. ZPE, entropy, solvation, electric-field, and potential terms require a separate calibrated thermochemistry workflow.

For the complete water-electrolysis bookkeeping, keep both half-reactions and the overall reaction in the pathway manifest:

| Environment | HER half-reaction | OER half-reaction | Overall reaction |
| --- | --- | --- | --- |
| Acidic | `4H+ + 4e- -> 2H2(g)` | `2H2O(l) -> O2(g) + 4H+ + 4e-` | `2H2O(l) -> 2H2(g) + O2(g)` |
| Alkaline | `4H2O(l) + 4e- -> 2H2(g) + 4OH-` | `4OH- -> O2(g) + 2H2O(l) + 4e-` | `2H2O(l) -> 2H2(g) + O2(g)` |

The HER and OER surface-state graphs are half-cell models. Their endpoint structures and reference molecules must conserve the corresponding atoms, charge convention, and electron/proton or hydroxide bookkeeping before the two graphs are combined.

## HER branches

### Acidic HER

Mandatory surface states: `*`, `H*`. Add `H2*`, `H2O*`, or coadsorbed states only when the selected mechanism or coverage requires them.

| Branch | Elementary step | Required references or notes |
| --- | --- | --- |
| Volmer | `* + H+ + e- -> H*` | Proton/electron reference; keep the adsorption site explicit. |
| Heyrovsky | `H* + H+ + e- -> H2(g) + *` | Gas `H2` reference; the transition state is not represented by a static endpoint. |
| Tafel | `2H* -> H2(g) + 2*` | Requires two compatible sites and a coverage definition. |

If the mechanism is unknown, construct both Heyrovsky and Tafel branches rather than selecting one from the final adsorption energy.

### Alkaline HER

Mandatory surface states: `*`, `H*`; construct `H2O*` and `OH*` when testing the water-dissociation/Volmer route or a coadsorbed intermediate. Keep hydroxide and water references explicit.

| Branch | Elementary step | Required references or notes |
| --- | --- | --- |
| Volmer | `* + H2O(l) + e- -> H* + OH-` | Water and hydroxide stoichiometry; distinguish from acidic proton delivery. |
| Heyrovsky | `H* + H2O(l) + e- -> H2(g) + OH- + *` | Preserve the same water/OH convention as Volmer. |
| Tafel | `2H* -> H2(g) + 2*` | Requires two compatible sites and the same coverage as the Volmer state. |

Do not label an alkaline `H*` value as an intrinsic water-dissociation barrier. A barrier requires a transition-state calculation; static endpoint structures only define candidate states.

## OER associative adsorbate evolution

Mandatory surface states for both environments: `*`, `OH*`, `O*`, `OOH*`. Construct multiple OOH orientations and O-O binding motifs when the site geometry permits them. `O2(g)` and `H2O(l)` are references, not replacements for `OOH*`.

### Acidic OER

| Step | Elementary reaction | Required references or notes |
| --- | --- | --- |
| 1 | `* + H2O(l) -> OH* + H+ + e-` | Water reference and acid proton/electron convention. |
| 2 | `OH* -> O* + H+ + e-` | Preserve the same site and spin/charge policy. |
| 3 | `O* + H2O(l) -> OOH* + H+ + e-` | Include distinct OOH orientations/sites if chemically possible. |
| 4 | `OOH* -> O2(g) + H+ + e- + *` | Gas oxygen reference and regenerated clean site. |

### Alkaline OER

| Step | Elementary reaction | Required references or notes |
| --- | --- | --- |
| 1 | `* + OH- -> OH* + e-` | Hydroxide reference; do not substitute an acid proton step. |
| 2 | `OH* + OH- -> O* + H2O(l) + e-` | Water product and hydroxide reactant must be recorded. |
| 3 | `O* + OH- -> OOH* + e-` | Retain OOH orientation and site metadata. |
| 4 | `OOH* + OH- -> O2(g) + H2O(l) + * + e-` | Oxygen/water references and regenerated clean site. |

The AEM state graph is incomplete if any of `OH*`, `O*`, or `OOH*` is missing. If a candidate cannot support a state without a clash, record the state as failed/held rather than silently deleting that step.

## Optional lattice-oxygen branch

For reducible oxides or evidence of lattice oxygen participation, keep a separate LOM graph. Add explicit lattice-O labels, an oxygen-vacancy state (`V_O`), O-O coupling or peroxide-like states, and the restored-lattice/product state. Record which lattice atom changed identity and its atom index. Never merge AEM and LOM energies or call an AEM-only set a complete mechanism when LOM is chemically plausible.

## State-manifest minimum

Each intermediate record should include:

- `state_id`, `reaction`, `environment`, `mechanism`, and predecessor/successor state IDs;
- adsorbate formula, isolated-reference path/hash, slab path/hash, combined path/hash, and exact atom count/composition;
- facet Miller index, termination, layer count, cell/vacuum, adsorption side, coverage, site type, anchor atom index, Cartesian or fractional site coordinate, height, and orientation;
- charge, spin, pH/electrolyte, temperature, potential/reference convention, model/task/device, and relaxation policy;
- status (`complete`, `held`, or `failed`) and a reason for every missing, clashing, duplicate, or mechanism-inapplicable state.

The final pathway report must distinguish: constructed structures, UMA adsorption descriptors, DFT/VASP thermochemical quantities, and experimental observations. Do not use one category as evidence for another.
