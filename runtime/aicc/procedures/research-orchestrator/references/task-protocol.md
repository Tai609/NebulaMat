# Task Protocol

> Load this when: creating or reviewing `.research/tasks/*.yaml`, mapping
> `workflow.md` stages to task DAG nodes, or deciding how a task binds to skills and
> knowledge.

Each task is one project DAG node. It may be a cognitive task (method design, critic,
report synthesis) or a deterministic execution task (structure generation, parser run,
HPC submission), but it always names its inputs, outputs, dependencies, success
criteria, and release gates.

## Table of Contents

- [Minimal Task](#minimal-task)
- [Required Fields](#required-fields)
- [Optional but Recommended Fields](#optional-but-recommended-fields)
- [Structure Model Review DAG](#structure-model-review-dag)
- [Status Values](#status-values)
- [Inputs](#inputs)
- [Outputs](#outputs)
- [Execution Policy](#execution-policy)

## Minimal Task

```yaml
schema_version: 1
id: T003
title: Build candidate adsorption models
role: structure-modeler
role_contract: __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/references/roles.md#structure-modeler
skill: structure-prep
status: approved
depends_on:
  - T001
  - T002
approval: scientific_model_choice
inputs:
  - artifact_id: approved-model-spec
    min_status: accepted
can_read:
  - artifact_type: method-fingerprint
  - artifact_type: model-observable-decision
can_write:
  - artifact_type: structure-set
cannot:
  - submit production HPC jobs
outputs_expected:
  - artifact_id: candidate-structures
    type: structure-set
    path: work/models/
success_criteria:
  - no atomic overlaps
  - composition and PBC validated
  - provenance recorded
knowledge_required:
  - __NEBULAMAT_AICC_ROOT__/knowledge/surface-thermodynamics.md
required_refs:
  - __NEBULAMAT_AICC_ROOT__/tools/structure-prep/references/running.md
  - __NEBULAMAT_AICC_ROOT__/tools/structure-prep/references/validation.md
required_checks:
  - uv run {repo_root}/tools/structure-prep/scripts/convert_structure.py work/models/slab.vasp work/models/slab.vasp
  - uv run {repo_root}/procedures/research-orchestrator/scripts/check_structure_generator_boundary.py --forbid-engine-inputs work/scripts/
release_gates:
  - model-structure-review
execution_policy:
  mode: single_owner
  allow_parallel_subagents: false
  requires_claim: true
  lease_ttl_minutes: 60
  heartbeat_interval_minutes: 10
  owner_dir: work/runs/ads-relax/
  exclusive_paths:
    - work/runs/ads-relax/
assumptions: []
provenance: []
```

## Required Fields

| Field | Meaning |
|---|---|
| `schema_version` | Protocol version; the current schema supports `1`. |
| `id` | Stable task ID, e.g. `T001`. |
| `title` | Human-readable task title. |
| `role` | Logical role, e.g. `literature-method`, `structure-modeler`, `engine-runner`, `scientific-critic`, `synthesis-report`. |
| `skill` | Skill name expected to drive this task, e.g. `vasp`, `cp2k`, `gaussian`, `structure-prep`, `review-response`, `report`. This is a per-task routing contract; one project may use different software skills for different tasks. |
| `status` | Persisted task state. `ready` is not persisted; it is derived by `ready_tasks.py`. |
| `depends_on` | Upstream task IDs. Empty list is allowed. |
| `approval` | `none` or a policy item such as `scientific_model_choice`, `expensive_hpc_submission`, `promote_claim_to_report`. |
| `inputs` | Artifact or file inputs. |
| `outputs_expected` | Expected artifact IDs and paths. |
| `success_criteria` | Checkable conditions, written before execution. |
| `assumptions` | Unverified assumptions. |
| `provenance` | Source files, quotes, task IDs, job IDs, parser outputs, or other evidence. |

## Optional but Recommended Fields

- `knowledge_required`: tool-agnostic science references that must be consulted before
  this task can be accepted.
- `required_refs`: skill references that the executing agent must read.
- `required_checks`: deterministic commands that must run before validation or release.
  Use `uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/run_required_checks.py
  PATH/.research TASK_ID` to execute them from the project root.
  The runner expands `{repo_root}` to this skill repository and `{project_root}` to the
  active project root, so project state can live outside the skill repository.
- `role_contract`: repo path to the role contract section, e.g.
  `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/references/roles.md#scientific-critic`.
- `can_read`: artifact IDs, artifact types, paths, roles, or skills this task may read.
- `can_write`: artifact IDs or artifact types this task may produce.
- `cannot`: explicit authority boundaries, such as "submit production HPC jobs".
- `evidence_packet`: the minimal artifact set for critic/report decisions; see
  `references/evidence-packets.md`.
- `release_gates`: named gates such as `plan_gate`, `structure_gate`,
  `model-structure-review`, `result_gate`, `visualization-evidence`, `report_gate`,
  or `critic-acceptance`. Gate-producing tasks should emit a machine-readable verdict
  artifact; gate-consuming tasks should list that artifact in `inputs`.
- `execution_policy`: see below.
- `stage`, `wave_id`, and `iteration`: optional loop metadata. Use these to represent
  the scientific calculation loop while keeping `.research/tasks/*.yaml` acyclic.
- `source_proposal`: artifact ID of the `follow-up-proposal` that created this task.
- `follow_up_of`: claim, task, or artifact that motivated the follow-up.
- `resolves_follow_up`: `follow-up-proposal` artifact ID resolved by this task once
  the task is `accepted`.
- `report_mode`: `stage-synthesis` or `final` for report tasks. Final report readiness
  is blocked while report-blocking follow-up proposals remain unresolved.

Input entries may carry `optional: true`. Optional file inputs may be absent. Optional
artifact inputs may be unregistered, which is useful for tasks that inspect whether
supplied starting structures exist and self-build candidates when they do not.

The validator checks that `role` is legal, that `skill` names an existing repository
skill under `__NEBULAMAT_AICC_ROOT__/procedures/*/SKILL.md` or `__NEBULAMAT_AICC_ROOT__/tools/*/SKILL.md`, and that `role_contract`,
when present, points to an existing repo file. The validator also enforces role output
boundaries for restricted roles such as `scientific-critic`.

## Structure Model Review DAG

For slab, surface, defect, adsorbate, molecule-on-surface, or cluster-on-surface models,
split modeling into explicit review tasks before engine input generation:

```text
structure-modeler (inspect supplied structures; self-build if needed)
  -> surface-literature-reviewer, when facet/termination precedent matters
  -> structure-critic
  -> structure-modeler revision, if requested
  -> accepted structure-set + accepted structure_gate
  -> engine-runner / hpc-submit
```

The first structure-modeler task is allowed to run even when no original POSCAR/CIF,
slab, cluster, or archived input exists. Its job is to inspect the project for usable
initial structures and either preserve them with provenance or build documented
candidate models. Missing supplied structures are not a valid reason to set this task
to `blocked`. This inspection is bounded to the current project root/current working
directory, obvious project input/model subdirectories, registered `.research` paths,
and user-explicit paths. Do not scan `$HOME`, `/home`, `/opt`, `/`, shared software
trees, scratch roots, or unrelated archives.

The literature task checks whether the chosen Miller index, termination, slab thickness,
lateral cell, coverage, model-size economy, and adsorption motif are common or
defensible for the material and experimental condition. If the chosen Miller index
differs from the commonly used/synthesized/modeled facet, the review records why the
current facet is relevant. It writes `surface-literature-review`; if no precedent is
found, the artifact must say the model is exploratory rather than silently treating it
as standard. For very niche materials or unusual structural modifications, a documented
`exploratory/no-precedent-found` outcome is acceptable and should not block downstream
structure critique by itself.

The `structure-modeler` task must use `structure-prep` to generate structures and basic
validation evidence. It cannot write `structure-audit-report`,
`model-structure-review`, or `gate-verdict` artifacts. It also cannot write scheduler
submit scripts or final engine input packs before structure acceptance; scripts that
mutate structures should be checked with `check_structure_generator_boundary.py`, using
`--forbid-engine-inputs` when the task is only a structure-modeler task. The `structure-critic` task is
read-only: it checks the generated structures against the literature review and
`__NEBULAMAT_AICC_ROOT__/tools/structure-prep/references/validation.md`, then writes `structure-audit-report`
or `model-structure-review`/`structure_gate`. It can recommend changing facet,
termination, supercell, vacuum, layer count, adsorbate height, orientation, site,
coverage, or model size, but the coordinate edits go back to `structure-modeler`.

An engine or HPC task should consume the accepted structures it actually uses, an
accepted machine-readable `structure_gate` verdict, and an accepted `cluster-guide-read`
artifact proving that the target `~/.cluster-agents.md` was read before the job script
was prepared or submitted. The evidence file must include the guide path, read
timestamp, and `guide_size_bytes`; for local guides the generic pre-submit hook verifies
the recorded size against the current file. Remote guide evidence should include the
remote `stat` size or hash echo, but the hook cannot independently re-stat the remote
file unless it is running in that remote context. `cluster-guide-read` is normally
produced by the execution owner or a dedicated pre-submit/bootstrap task; rows with
`produced_by: external` are acceptable when the read was recorded before `.research/`
state existed.
The hook also enforces the gate verdict and cluster-guide-read evidence; projects may
additionally list the reviewed `structure-set` as an input when that artifact is
registered. If an engine task lists `structure_gate` in `release_gates`, it must also
declare the gate artifact itself in `inputs`, e.g. `artifact_id: structure-gate` with
`min_status: accepted`; otherwise `check_pre_submit.py` has no declared evidence to
consume and the validator will warn.
This keeps review in model design while preserving single-owner expensive execution.

## Engine Input Generation

Engine-runner tasks that write VASP, CP2K, Gaussian, LAMMPS, or similar inputs must
start from reviewed structures rather than rebuilding or mutating atoms inline. They
consume the engine skill's setup and validation references before writing files. For
VASP, list at least:

```yaml
required_refs:
  - __NEBULAMAT_AICC_ROOT__/tools/vasp/references/running.md
  - __NEBULAMAT_AICC_ROOT__/tools/vasp/references/validation.md
required_checks:
  - uv run {repo_root}/tools/vasp/scripts/check_inputs.py --strict-performance work/runs/ads-relax
```

The resulting `engine-input-set` artifact should record the input-standard choices:
task type, INCAR/KPOINTS source reference, ENCUT policy, k-policy, smearing, spin/U
policy, executable, and performance layout such as CPU default `NPAR=4`, optional
`KPAR`, or an explicit GPU/site-default rationale with no default `NPAR/NCORE`.
Omitting these fields is a review problem because
the job may be technically valid but unnecessarily slow or inconsistent with the local
standard.

## Gate Tasks and Hooks

For nontrivial review-response or multi-stage projects, split the major release points
into explicit gate-producing tasks, but keep the first HPC submission path short. The
first engine/HPC task should not depend on `scientific-critic`, `result_gate`,
`synthesis-report`, `report_gate`, or a stage-synthesis packet, because those consume
parser or analysis evidence that is only available after calculations run.

```text
first-submit path:
  plan/method task      -> plan_gate
  structure-critic task -> structure_gate   -> engine input or HPC submission

post-result path:
  parser/analysis result -> scientific-critic task -> result_gate
  accepted/waived claims -> synthesis-report task   -> report_gate -> final report
```

Stage synthesis, when useful, is also post-result work. It is an interim review packet
after a calculation wave that lists accepted evidence, validated-but-pending evidence,
critic outcomes, open follow-up proposals, and waivers. It is not a first-submit gate
and must not be required before engine input generation or Slurm submission.

Validator note: an `engine-runner` task that depends on `scientific-critic` or
`synthesis-report`, lists `result_gate`/`report_gate`, uses `promote_claim_to_report`,
or calls post-result hooks will receive a warning unless it explicitly marks itself as
post-result work with `stage: follow-up`, `stage: reanalysis`, `stage: recovery`, or
`allow_post_result_dependencies: true`.

Follow-up execution should be represented as a new wave of acyclic task nodes, not by
adding a dependency cycle. For example, a critic may produce an accepted
`follow-up-proposal`, then `scaffold_follow_up_tasks.py` can create `T007` with
`stage: follow-up`, `source_proposal: follow-up-proposal`, and
`resolves_follow_up: follow-up-proposal`. The final report remains blocked until that
proposal is resolved by accepted follow-up evidence, a waiver/limitation decision, or a
superseding artifact. If a final report task reaches `check_pre_report.py` while such
proposals remain open, the hook writes an interim stage-synthesis Markdown report and
attempts the same next-wave task scaffolding, but still exits blocked for the final
report.

Each gate-producing task writes a YAML verdict following
`__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/references/gate-contract.md`. Downstream tasks should
consume the verdict artifact by ID, not by chat memory. Narrative review files can
support the verdict, but they do not replace the YAML gate artifact:

```yaml
inputs:
  - artifact_id: structure-gate
    min_status: accepted
  - artifact_id: cluster-guide-read
    min_status: accepted
required_checks:
  - uv run {repo_root}/procedures/research-orchestrator/scripts/check_pre_submit.py {project_root}/.research T_ENGINE
```

The gate verdict stays general. It records whether model relevance, finite-size effects,
coverage or concentration, thermodynamic observable matching, parser validation, and
report-claim discipline were checked for the current project. It must not hard-code a
specific material system, adsorbate, supercell label, or reviewer case into the
protocol.

Hook scripts are deny-by-default. Missing verdicts, blocking verdicts, or waivers
without an approved decision keep the receiving release task blocked. This applies to
engine/HPC submission, claim acceptance, and report generation. It should not be used
to block upstream planning or structure-modeling tasks whose purpose is to create the
artifact that the gate will later review. It also should not be applied across release
points: `check_pre_submit.py` checks plan/structure readiness for execution handoff,
not result or report readiness. `check_pre_accept_claim.py` and
`check_pre_report.py` run only after parser/analysis evidence exists.

## Status Values

Allowed persisted statuses:

```text
proposed
approved
running
completed
validated
accepted
blocked
failed
cancelled
```

`ready` is intentionally absent. A task is ready when `ready_tasks.py` finds that its
dependencies, inputs, approvals, and output conflicts allow execution.

Authority boundaries:

- `completed` — the producing agent/worker says the artifact exists.
- `validated` — deterministic parser/checker or release gate says the artifact is
  technically valid.
- `accepted` — a critic/orchestrator or user confirms that the artifact answers the
  pre-registered objective and may feed formal downstream work.

Only accepted artifacts and claims are reportable by default.

## Inputs

Artifact input:

```yaml
inputs:
  - artifact_id: relaxed-slab
    min_status: accepted
```

File input:

```yaml
inputs:
  - type: source-document
    path: inputs/manuscript.pdf
```

`min_status` defaults to `accepted` for artifact inputs. Execution tasks may request
`validated`, but that choice should be explicit.

## Outputs

Every expected output must declare an artifact ID:

```yaml
outputs_expected:
  - artifact_id: vasp-inputs
    type: engine-input-set
    path: runs/co_ads/
```

The validator rejects duplicate expected output IDs and path escapes.

Downstream tasks may reference an upstream task's expected artifact before it exists in
`artifacts.jsonl`. `validate_state.py` allows that DAG reference; `ready_tasks.py` blocks
execution until the producing task is accepted and the artifact is registered at the
required status.

## Execution Policy

Default:

```yaml
execution_policy:
  mode: single_owner
  allow_parallel_subagents: false
```

Use multiple cognitive passes for planning and criticism, but use a single owner for
HPC submission and expensive execution.

For expensive execution, prefer:

```yaml
execution_policy:
  mode: single_owner
  allow_parallel_subagents: false
  requires_claim: true
  lease_ttl_minutes: 60
  heartbeat_interval_minutes: 10
  owner_dir: work/runs/ads-relax/
  exclusive_paths:
    - work/runs/ads-relax/
```

Field meanings:

- `requires_claim`: `true` means `claim_task.py` must create an active lease before
  work starts.
- `lease_ttl_minutes`: how long a lease stays fresh without heartbeat.
- `heartbeat_interval_minutes`: expected owner heartbeat cadence.
- `owner_dir`: the main project-root-relative working directory owned by this task.
- `exclusive_paths`: project-root-relative paths no other active lease may write.

Lease expiry only marks ownership stale. It never grants permission to blindly resubmit
an expensive job; run `reconcile_leases.py` and record the recovery decision first.
