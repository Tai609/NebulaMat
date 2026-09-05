# materials-mcp

`materials-mcp` is the provider-neutral materials interface used by the
NebulaMat materials skills. It normalizes Materials Project, OQMD,
AFLOW, and NOMAD records to one schema and exposes deterministic validation
tools through MCP.

The package belongs in its own `materials` Python environment. It intentionally
keeps database adapters, pymatgen/ASE/RDKit validation, and future ML packages
out of the general science-MCP environment.

The `ml` extra (`torch` and `matgl`) is opt-in and must only be installed into
this materials environment after a remote/local hardware decision; the desktop
setup does not pull those large packages by default. The separate `uma` extra
adds `fairchem-core` for the gated FAIR Chemistry UMA weights and should be
installed only on the GPU-capable materials runner.

## Tools

- `get_material_agent_schemas()`
- `get_material_design_operators()`
- `compile_material_evidence_graph(graph, output_path)`
- `apply_material_design_operators(base_state, operators)`
- `validate_material_design_candidate(candidate, evidence_graph)`
- `pre_dft_physics_screen_candidate(candidate, conditions, output_path, candidate_sha256, evidence_graph_hash)`
- `run_mattersim_stability_screen(structure_path, ...)`
- `run_uma_adsorption_energy_screen(slab_path, adsorbate_path, adsorbed_path, ...)`
- `run_uma_surface_md(adsorbed_path, output_dir, ...)`
- `get_materials_runtime_status(write_status)`
- `get_material_capabilities()`
- `search_materials(query, providers, limit)`
- `discover_materials(elements, formulas, providers, limit)`
- `search_material_formulas(formulas, providers, limit)`
- `get_material_provider_status(providers)`
- `resume_material_queries(providers, limit)`
- `get_material(provider, material_id)`
- `normalize_material(provider, record)`
- `validate_material(payload)`
- `validate_structure_file(path, min_distance)`
- `create_materials_workflow(goal, constraints, include_dft, design_mode, domain_profile, response_language, route, capability_plan)`
- `create_material_discovery_workflow(goal, chemical_system, reaction, constraints, existing_cluster_expansion, include_reactor, include_spatial, shortlisted_candidate_count, spatial_candidate_limit, providers, response_language)`
- `get_materials_workflow(workflow_id)`
- `advance_materials_workflow(workflow_id, actor, to_stage, ...)`
- `record_material_experience(...)`
- `propose_material_rule(...)`
- `get_material_agent_context(agent)`
- `promote_material_rule(proposal_id, approved_by)`
- `record_chemistry_memory(...)`
- `search_chemistry_memories(...)`
- `evaluate_chemistry_memory(...)`
- `start_chemistry_memory_canary(...)`
- `finish_chemistry_memory_canary(...)`
- `promote_chemistry_memory(...)`
- `rollback_chemistry_memory(...)`
- `list_chemistry_memories(...)`
- `list_material_tasks(workflow_id)`
- `claim_material_task(workflow_id, task_id, actor)`
- `heartbeat_material_task(workflow_id, task_id, actor)`
- `recover_material_tasks(workflow_id)`
- `retry_material_task(workflow_id, task_id, actor, note)`
- `complete_material_task(workflow_id, task_id, actor, output)`
- `record_dft_human_review(workflow_id, task_id, actor, decision, note, requested_changes)`
- `start_material_design_iteration(workflow_id, actor, note)`
- `record_material_novelty_audit(workflow_id, iteration, auditor, search_scope, candidate_results)`
- `record_material_review_vote(...)`
- `get_material_review_summary(workflow_id)`
- `finalize_material_review(...)`
- `run_materials_benchmark(case_ids)`
- `replay_material_workflow(workflow_id)`
- `evaluate_material_rule(...)`
- `start_material_rule_canary(...)`
- `finish_material_rule_canary(...)`
- `rollback_material_rule(...)`
- `propose_material_runtime_policy(...)`
- `evaluate_material_runtime_policy(...)`
- `start_material_runtime_canary(...)`
- `finish_material_runtime_canary(...)`
- `promote_material_runtime_policy(...)`
- `rollback_material_runtime_policy(...)`
- `select_material_active_learning_batch(...)`
- `generate_material_inverse_design_candidates(...)`

Set `design_mode=true` on `create_materials_workflow` to extend the reviewed
discovery DAG into a computable mechanism/failure evidence graph, explicit
operator-derived candidate design, a hash-frozen handoff to an isolated
Novelty Auditor, deterministic candidate validation, independent design audit,
situated pre-DFT physics/chemistry screening with explicit uncertainty and
`reject`/`hold`/`promote_to_dft` routing,
synthesis planning, a human-owned experiment record, and evidence-bounded
result interpretation. Completed experiment
interpretations can release another numbered iteration without rewriting prior
artifacts.

The default `route="standard"` uses one planner/materials path with bounded
discovery, validation, screening, and synthesis. Use `route="fast"` for a
small local decision record. Use `route="high-risk"` for the full provider
quorum and independent review DAG; DFT and design mode promote to this route
automatically. This prevents a routine screening question from paying for all
providers and reviewers.

For modular agent orchestration, call `get_material_capabilities()` first and
submit an explicit `capability_plan` to `create_materials_workflow`. Each node
names one registered capability, its parameters, and explicit `depends_on`
task IDs. Plans can be serial, parallel, or branched; unknown capabilities,
duplicate IDs, and cycles are rejected. Only the submitted nodes execute: the
runtime does not silently append a MatterGen -> MatterSim -> UMA -> VASP path,
reviewer, or completion task. A plan containing VASP or experiment capabilities
is automatically routed to `high-risk` and remains subject to scope/cost audit,
human approval, and tool governance.

Example plan for an electrocatalysis screening branch:

```json
[
  {"task_id": "generate", "capability": "structure.generate.mattergen", "parameters": {"chemical_system": "Ni-Fe-Co-O"}},
  {"task_id": "edit", "capability": "structure.edit.ase", "depends_on": ["generate"], "parameters": {"operations": ["build_surface"]}},
  {"task_id": "validate", "capability": "structure.validate", "depends_on": ["edit"]},
  {"task_id": "stability", "capability": "stability.screen.mattersim", "depends_on": ["validate"]},
  {"task_id": "adsorption", "capability": "adsorption.screen.uma", "depends_on": ["validate"]}
]
```

Here `stability` and `adsorption` are independent branches and can run in
parallel after `validate`; adding `property.compute.vasp` is an explicit,
high-risk decision rather than an automatic next step.

## Electrocatalysis discovery template

`create_material_discovery_workflow` turns a catalyst question into an explicit
candidate-to-kinetics DAG:

```text
MatterGen
  -> standardize + validate
  -> pymatgen phase stability / Pourbaix       -> MatterSim bulk proxy
  -> [smol, only with an existing cluster expansion]
  -> CatKit + ASE + pymatgen facets/terminations/sites
  -> FairChem UMA adsorption and configuration screen
  -> Catalysis-Hub / OC20 / OC22 / OC25 / literature evidence
  -> declared scaling relations + BEP completion
  -> CatMAP pH-potential-field microkinetics
  -> [Cantera/OpenMKM reactor validation]
  -> [kmos for a small, explicitly shortlisted spatial subset]
```

The template is a plan constructor, not an implicit executor. It records model
and source boundaries in the workflow snapshot and writes an `optional_stages`
list when prerequisites are absent. In particular, `smol` is omitted and
marked `existing_cluster_expansion_missing` unless a compatible expansion is
provided; it never fits a new expansion. Reactor validation requires an
explicit request, and kmos requires `shortlisted_candidate_count` at or below
`spatial_candidate_limit` (default 8). Missing adsorption, reaction, BEP, or
scaling labels remain evidence gaps rather than fabricated values. When smol
is enabled, the workspace-relative expansion path and SHA-256 are frozen in
the workflow scope and task parameters for executor-side provenance checks.

Example MCP call:

```json
{
  "goal": "Find stable alkaline HER candidates with low predicted kinetic barriers",
  "chemical_system": "Ni-Fe-Co-O",
  "reaction": "alkaline HER",
  "constraints": {
    "samples": 32,
    "surface_specs": {"miller_indices": [[1, 1, 1], [1, 0, 0]]},
    "adsorption_specs": {"adsorbates": ["H", "OH"]},
    "conditions": {
      "pH_range": [10, 14],
      "potential_range": [-0.3, 0.2]
    }
  },
  "include_reactor": false,
  "include_spatial": true,
  "shortlisted_candidate_count": 4
}
```

The pre-DFT screen includes optional OER and HER descriptor layers. HER accepts
`physics.her_descriptors.delta_g_h` and can additionally inspect an alkaline
water-dissociation barrier proxy. It reports uncertainty intervals and keeps
missing descriptors as evidence gaps; these proxies do not replace explicit
surface/solvent DFT, AIMD, kinetic calculations, or electrochemical measurement.

MatterGen surface standardization v1.1 treats `surface_layers` as the exact
number of real atomic planes along `cross(a,b)` and `vacuum_angstrom` as the
total periodic gap. The default in-plane target is 96 atoms with a 20% window;
both lateral vectors must be at least 12 A, `c/min(a,b)` must not exceed 4, and
the solid slab thickness must not exceed 20 A. Older manifests must be rebuilt.

## MatterSim first-stage screen

MatterSim-v1.0.0-5M is an optional energy/force/stress model for the first
structure screen. Install the pinned v1 package in the isolated materials
environment:

```bash
pip install -e "runtime/materials-mcp[mattersim]"
```

Place the official checkpoint at
`runtime/mattersim/models/mattersim-v1.0.0-5M.pth`, or set
`NEBULAMAT_MATTERSIM_MODEL` to an explicit workspace path. The MCP tool and
CLI do not silently download a checkpoint. A typical run is:

```bash
materials-mattersim-screen --structure materials/design/iteration-1/bulk.cif \
  --structure-kind bulk --device cuda \
  --output-dir materials/design/iteration-1/mattersim
```

For a slab, use `--structure-kind slab` and keep the cell fixed. A converged
relaxation, energy/atom, force, and stress are recorded as a stability proxy;
they do not prove formation stability, aqueous stability, surface stability,
or experimental synthesizability. MatterSim-v1 is primarily a bulk model, so
slab results must be calibrated against representative VASP calculations.

## UMA electrocatalysis screen

UMA is an optional fairchem energy/force model used here for adsorption-energy
pre-screening and ASE-driven surface molecular dynamics. Install it in the
GPU-capable materials environment:

```bash
pip install -e "runtime/materials-mcp[uma]"
hf auth login
```

The Hugging Face account must have access to `facebook/UMA`. For an
electrocatalysis run, use the `oc25` task and the same model/protocol for all
three structures:

```text
E_ads = E(slab + adsorbate) - E(slab) - E(adsorbate)
```

The MCP tool accepts a slab, an isolated adsorbate, and the combined adsorbed
structure. It records input SHA-256 values, the model/task, relaxation status,
the sign convention, and an explicit `uncertainty.status=not_calibrated`.
The default checkpoint is `uma-s-1p2p1`, the current 1.2-series patch
checkpoint; keep `uma-s-1p2` as a fixed baseline until a local OC25
calibration confirms ranking and error behavior for your catalyst family.
Relaxation is mandatory: the standardized slab, isolated adsorbate, and
adsorbed slab are all relaxed with the same model/task before their energies
are evaluated. The bottom three real slab planes are fixed by default. A
`relax=false` request is rejected, and any non-converged structure returns
`status=hold` without `energies_ev` or `adsorption_energy_ev`. The tool does not
model potential, pH, solvent, coverage, field, reconstruction, or kinetic
barriers; representative candidates must be calibrated against same-protocol
VASP calculations before experimental selection. Do not replace this gate with
a custom script that calls UMA for direct single-point energies.

For a local command-line run:

```bash
materials-uma-screen --task oc25 --device cuda \
  --slab slab.cif --adsorbate co.xyz --adsorbed co_on_slab.cif \
  --fixed-bottom-layers 3 \
  --output-json materials/design/iteration-1/uma-co.json
```

## UMA surface molecular dynamics

`run_uma_surface_md` uses ASE as the MD integrator and UMA as the energy/force
calculator; LAMMPS is not required. The input must be the `adsorbed.extxyz`
artifact produced by `standardize_uma_adsorption_structure_set`. The runner
repeats the complete adsorption system `2 x 2 x 1` by default, preserving the
supplied coverage, fixes the bottom two atomic planes, and runs three seeded
replicas. The vacuum direction is never replicated and ordinary 3D NPT is
rejected.

On Windows, the lightweight materials MCP remains in its native isolated
environment. If `fairchem-core` is absent there, the tool automatically uses
the `tools.uma.runtime.wsl_python` interpreter from `materials/runtime.json`,
converts workspace paths through WSL, and returns Windows-accessible artifact
paths to the desktop client.

```bash
materials-uma-md --task oc25 --device cuda \
  --adsorbed materials/design/iteration-1/cohort/adsorbed.extxyz \
  --output-dir materials/design/iteration-1/uma-md
```

The default protocol is NVT at 300 K with a 0.5 fs step, 5 ps equilibration,
and 20 ps production. Each seed writes the full `trajectory.extxyz`, a compact
`trajectory-preview.extxyz` capped at 600 frames for the desktop viewer,
`thermo.csv`, a final CIF, a representative frame, and a closest-contact frame. The root
`md-manifest.json` records hashes, model/checkpoint identity, expansion,
coverage policy, fixed atoms, protocol, quality guards, and replica summaries.
These trajectories remain ML-potential screening evidence and require
same-protocol DFT energy/force checks on representative and anomalous frames.

Set `domain_profile="alkaline-electrolysis"` to add parallel chemistry,
electrochemistry, catalyst, interface/transport, degradation, and safety tasks
before screening.
The design loop then requires a frozen electrochemical protocol, an independent
safety gate, a named-human experiment record, and separate electrochemistry,
catalyst, transport, and degradation analyses before integrated interpretation.

Numeric properties use `{ "value": ..., "unit": ... }` for a stable contract
(`eV`, `eV/atom`, `angstrom3`, and similar canonical units). Set `MP_API_KEY`
for Materials Project access. OQMD, AFLOW, and NOMAD adapters are best-effort
public endpoints; provider errors are returned alongside any successful records
instead of hiding partial results.

Workflow tools enforce a typed task DAG with parallel provider discovery,
two-source discovery quorum, non-blocking late-source reconciliation,
independent reviewer votes, and append-only events under `.openscience/`.
Workflow snapshots use transactional SQLite with optimistic revisions; JSON
files remain readable mirrors. Claimed tasks have leases and heartbeats, and
expired work is retried or moved to dead-letter after its attempt budget.

DFT workflows add a mandatory `dft:audit -> dft:human-review -> dft:run` gate.
The AI may propose and audit a model, input parameters, wall-time estimate, and
cost estimate, but only a named `human:<id>` can approve the exact hashed
artifacts. A requested change invalidates the old approval and returns the
preparation and audit tasks to a new revision. Costs use `0.1 CNY/core-hour`.
The workflow infers `response_language` from the user's goal unless explicitly
provided; supervisors must pass it to every child task and use it in the final
response.

Provider access is a deterministic data plane rather than an agent-owned HTTP
loop. It chooses element-set queries when supported, fans formula fallbacks out
under bounded per-provider concurrency, records every query by idempotency key,
and checkpoints results in SQLite. Request/provider budgets, retry, circuit
breaking, caching, health metrics, and explicit `not_found` versus
infrastructure-failure observations are part of the public result contract.
Agent learning is bounded: proposals must pass offline benchmark and replay,
then an explicit canary, before a materials reviewer or `human:<id>` approver
can promote them. Approved rules remain rollbackable.
The same process applies to allowlisted runtime policy changes; agents cannot
evolve endpoints, credentials, permissions, tools, or scientific conclusions.

## Governed chemistry memory

NebulaMat implements separate plan, execution, and knowledge memories under
`.openscience/chemistry-memory.jsonl`. Records are append-only and deduplicated
by a stable content fingerprint. Ordinary search returns approved memories
only. An active canary is visible only when the caller supplies a member of its
explicit cohort; rollback removes a memory from retrieval without erasing its
audit history.

Retrieval is local, deterministic, and model-agnostic. It uses Unicode-aware
weighted token overlap with domain/tag and confidence weighting. Plan and
execution memories are searched first; knowledge associations are used as a
fallback when direct retrieval is weak. Retrieved content remains a hypothesis
and never replaces current scientific evidence or deterministic validation.

The three-memory architecture is adapted from
[ChemAgent](https://github.com/gersteinlab/ChemAgent) and its ICLR 2025 paper,
[ChemAgent: Self-updating Library in Large Language Models Improves Chemical Reasoning](https://arxiv.org/abs/2501.06590).
This integration is implemented inside NebulaMat's existing workspace,
benchmark, replay, canary, reviewer-approval, and rollback boundaries. It does
not import ChemAgent's model client, credential configuration, vector-store
dependency, or generated-code execution path.
