---
name: electrochemical-adsorption-model-construction
description: Build provenance-controlled facet-specific electrochemical adsorption model cohorts from MatterGen candidates after MatterSim relaxation, including slab terminations, adsorption sites and orientations, acid or alkaline HER/OER intermediates, complete pathway manifests, and UMA-ready adsorption triplets. Use whenever a user asks to place adsorbates, construct HER/OER models, enumerate catalyst facets or sites, distinguish acidic from alkaline electrolysis, or model the water-to-hydrogen/oxygen pathway.
---

# Electrochemical Adsorption Model Construction

Construct an auditable family of surface and adsorbate structures. This skill creates model inputs and reaction-pathway bookkeeping; it does not prove catalytic activity, free energy, kinetics, surface stability, or experimental performance. Load [references/pathway-catalog.md](references/pathway-catalog.md) for the required HER/OER states and stoichiometry.

## Workflow

1. **Fix the electrochemical scope.** Record the target reaction (`HER` or `OER`), environment (`acidic` or `alkaline`), pH or electrolyte, temperature, potential convention, charge/spin policy, and the mechanistic branches to test. If acid versus alkaline or HER versus OER is unspecified, hold and ask; never infer it from the catalyst formula. Use the associative adsorbate evolution mechanism (AEM) as the baseline and add a lattice-oxygen mechanism (LOM) branch only when the material or evidence justifies it.
2. **Gate the parent structure.** Require a completed MatterGen run, a manifest-backed bulk standardization near the requested 60-atom target (default window 48-72), and a completed MatterSim bulk relaxation with matching input hash, converged forces, bounded geometry change, model/checkpoint, device, and protocol recorded. MatterSim is a geometry/energy proxy; it does not establish bulk or surface stability.
3. **Preserve the relaxed parent.** Use the MatterSim-relaxed artifact as the parent for every facet. Create a derived lineage record linking the MatterGen run, standardized bulk, MatterSim result, relaxed-file hash, and source atom ordering. If the existing surface standardizer cannot read or register the relaxed format, convert it deterministically and record the conversion hash, or stop; do not silently fall back to the unrelaxed MatterGen structure.
4. **Enumerate comparable facets.** Select symmetry-distinct low-index Miller indices and all relevant terminations rather than a single convenient surface. Start with up to 3-5 facets (for example, valid low-index analogues of `{100}`, `{110}`, and `{111}`) and expand only with a stated surface-exposure, coordination, or surface-energy reason. For every facet use an explicit layer count, vacuum (default 15 Angstrom), termination index, in-plane cell, and surface atom window. Build every slab from the same relaxed parent and record failed or unavailable Miller indices; do not call a tested subset exhaustive.
5. **Validate clean slabs.** Use `standardize_mattergen_structure` or the project surface-builder with `surface_miller_index`, `surface_layers=6`, `surface_target_atoms` near 60, `vacuum_angstrom`, and `termination_index`. Keep the vacuum direction unreplicated, retain the cell and atom ordering, check periodic minimum distances, and verify the manifest. About 60 atoms is a starting point for the clean substrate: enlarge laterally when the chosen coverage or adsorbate image interacts with its periodic copies. Keep six-layer thickness, vacuum, cell policy, and termination metadata comparable within a facet cohort.
6. **Enumerate sites and placements.** For each termination, identify symmetry-unique top, bridge, hollow, subsurface, and chemically distinct coordination sites that exist on that facet. Generate explicit orientations and heights for each intermediate, with an anchor atom, site coordinate, adsorption side, coverage, and placement method. Reject atom clashes, unintended subsurface insertion, vacuum crossing, and duplicate symmetry-equivalent structures. If no governed placement tool exists, use a deterministic workspace-local ASE/pymatgen script and retain its source, version, parameters, and SHA-256; never hand-edit coordinates without provenance.
7. **Build one triplet per state.** For every candidate state, retain the clean slab, an isolated adsorbate reference with explicit cell/pbc/charge/spin, and the combined adsorbed slab. Preserve exact slab cell, periodic flags, composition, and atom ordering. Run `standardize_uma_adsorption_structure_set` before UMA; its composition and atom-count checks must pass. Gas or solvent references such as H2, H2O, and O2 are separate thermochemical references and must not be confused with an adsorbate triplet.
8. **Cover the complete reaction path.** Load the pathway catalog and create every mandatory intermediate for the selected environment and mechanism. For HER include H* and both Volmer-Heyrovsky and Volmer-Tafel branches; for alkaline HER include H2O*/OH* when the water-dissociation route is being tested. For OER include OH*, O*, and OOH* plus the clean * state, and include the acid or alkaline water/OH stoichiometry. If LOM is in scope, add lattice-O, oxygen-vacancy, O-O coupling, and restored-lattice states as a separate branch. A partial state list is `hold`, not a complete pathway.
9. **Screen consistently.** Use `run_uma_adsorption_energy_screen` for the same-model initial screen with one `uma-s-1p2p1` checkpoint, one task (default `oc25`), one device, and one relaxation policy across a cohort. For the requested six-layer slab, set `relax=true`, freeze the bottom three atomic layers in the slab and adsorbed ordering, and leave the top three layers plus adsorbates mobile; the isolated adsorbate is never frozen. Inspect final forces, slab translation, reconstruction, and whether the six-layer identity is preserved before comparison. Never mix UMA, MatterSim, and VASP energies in one adsorption expression. Use the existing UMA surface-MD skill only as a later dynamics branch, not as a substitute for site or pathway construction.
10. **Assemble and audit the model set.** Write a model manifest, facet/termination manifest, site manifest, intermediate manifest, adsorption-set manifests, and UMA result links. Record parent and artifact hashes, Miller index, termination, layer count, cell/vacuum, site/anchor/orientation, coverage, environment, pH/electrolyte, mechanism, reference convention, charge/spin, model/task/device, relaxation protocol, and every missing or held state. A converged UMA screen remains an uncalibrated descriptor; calculate pathway free energies, limiting potential, or overpotential only after a separate same-protocol DFT/VASP thermochemistry workflow with ZPE, entropy, solvation, and potential corrections.

## Parameter Rules

- Keep the parent bulk near 60 atoms for the initial MatterSim relaxation (default 48-72 window), but size each surface cell by lateral separation and coverage rather than forcing every slab to exactly 60 atoms.
- Use six atomic layers and vacuum of 15 Angstrom or more unless a convergence study documents another value. Freeze the bottom three layers for every slab and adsorbed-system relaxation; the top three layers and adsorbates remain mobile.
- Use one governed relaxation with the bottom three layers fixed and the top three layers plus adsorbates mobile. Do not interpret the three free layers as three optimizer passes; `max_steps` remains the optimizer iteration limit.
- Estimate the cohort size before construction as facets x terminations x sites x orientations x coverages x intermediate states. The 3-5 facet starting set is a cost-controlled default; a request for all facets means all symmetry-distinct indices inside a declared index bound, not an undocumented subset. If the product is large, stage deterministic construction and cheap screening, disclose the count, and obtain confirmation before expensive relaxation or DFT.
- Compare facets only under matched slab thickness, vacuum, in-plane cell convention, coverage, charge/spin, model checkpoint, and relaxation protocol. Do not compare different terminations as though they were the same surface.
- Enumerate both adsorption sides only when physically needed; for one-sided slabs record the dipole/asymmetry limitation and carry the same convention into every reference calculation.
- Do not infer acid or alkaline conditions from a pH-free request. Record the proton/electron reference and whether water or hydroxide is the reactant in each elementary step.
- Treat `H*`, `OH*`, `O*`, `OOH*`, `H2O*`, and any lattice-O/vacancy states as distinct structures. Do not reuse one geometry under a renamed label or assume that a gas-phase molecule is an adsorbed intermediate.
- Do not call a low adsorption energy a favorable reaction step. Static UMA values omit, unless explicitly modeled and calibrated, ZPE, entropy, solvation, electrode potential, pH effects, coverage corrections, reconstruction, and kinetic barriers.
- Keep every generated structure and manifest in a new active-workspace run directory. Never overwrite a previous facet, site, or intermediate result.

## Tool Contract

Use the governed tools where available:

```text
run_mattersim_stability_screen(
  structure_path=<manifest-backed-standardized-bulk>,
  structure_kind="bulk", relax=true, relax_cell=false,
  fmax_ev_per_angstrom=0.05, max_steps=200,
  output_dir=<workspace-relative-parent-relaxation>
)

standardize_mattergen_structure(
  source_path=<MatterSim-relaxed-parent-with-lineage>,
  output_dir=<workspace-relative-facet-directory>,
  policy={
    "surface_miller_index": [h, k, l],
    "surface_layers": 6,
    "surface_target_atoms": 60,
    "vacuum_angstrom": 15,
    "termination_index": <termination>
  }
)

standardize_uma_adsorption_structure_set(
  slab_path=<clean-slab>, adsorbate_path=<isolated-intermediate>,
  adsorbed_path=<combined-adsorbed-slab>,
  output_dir=<workspace-relative-adsorption-set>
)
```

Use the UMA adsorption skill for `run_uma_adsorption_energy_screen` after each triplet passes standardization. Set `relax=true` and derive the zero-based `freeze_indices` for the bottom three layers in both slab orderings. If any tool cannot preserve the relaxed-parent lineage, cell, atom ordering, or pathway metadata, return `hold` with the missing capability rather than improvising an untraceable structure.

## Failure Handling

Classify failures as missing reaction scope, invalid parent/provenance, unavailable facet or termination, placement clash/duplicate, incomplete intermediate path, inconsistent adsorption triplet, model/environment, or interpretation. Preserve partial artifacts for diagnosis, but do not rank them or use them for a mechanistic claim. Report the exact held facet/site/state and the next required input or validation.
