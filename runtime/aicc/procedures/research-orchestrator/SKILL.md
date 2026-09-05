---
name: research-orchestrator
description: Define and maintain machine-readable research project state for multi-stage computational chemistry work. Use when a project needs task DAGs, artifact registries, decision logs, ready/blocked task checks, or structured handoff between cognitive roles and deterministic tool skills.
---

# Research Orchestrator

This procedure defines the project-level control plane. It does not replace
`comp-chem-workflow`, `review-response`, or any engine skill. It records who proposed
what, which artifacts exist, what is ready, what is blocked, and which validated or
accepted evidence may flow downstream.

Core boundary: **skills carry the operational and scientific guardrails; this
orchestrator carries state, handoff, and permissions.** A task that names `vasp`,
`structure-prep`, `ovito`, or `report` still requires that skill's `SKILL.md`, selected
references, and deterministic scripts.

## When to Use

- A calculation campaign has multiple stages, reusable artifacts, HPC jobs, report
  outputs, or a chance of being resumed later.
- A review-response or literature-derived project needs structured approvals,
  `addresses`/`contradicts`/`inconclusive` outcomes, and reportable claims.
- Multiple cognitive passes are useful for planning, model/observable choices, or
  result criticism.
- You need to list ready tasks and blocked reasons without reading chat history.

For a quick one-step parser or conversion job, go directly to the relevant tool skill.

## Capability Scope

The orchestrator has three capabilities. They are not workflow phases and should not be
mapped onto project task IDs such as `T001`, `T002`, or `T003`.

State protocol:

- `.research/project.yaml`
- `.research/tasks/*.yaml`
- `.research/artifacts.jsonl`
- `.research/decisions.jsonl`
- `.research/events.jsonl`
- `scripts/validate_state.py`
- `scripts/ready_tasks.py`

No background scheduler, database, message queue, long-lived worker, or real concurrent
execution is introduced by the state protocol itself.

Role contracts and handoff discipline:

- named role contracts for orchestrator, literature/method, execution support,
  scientific critic, and synthesis/report work;
- surface-literature and structure-critic roles for Miller index, termination, slab
  size, adsorbate/cluster geometry, and periodic-image review;
- evidence packets for critic and report handoff;
- machine-readable gate verdicts for plan, structure, result, and report release
  decisions;
- explicit `can_read`, `can_write`, `cannot`, and `role_contract` task fields;
- validator checks for legal roles, role-contract paths, and role output boundaries.

These role contracts still do not introduce autonomous parallel HPC execution.
Expensive submit, monitor, and recovery work remains a single-owner execution task.

Execution ownership:

- `.research/leases/*.json` records active and released execution claims;
- execution tasks use owner directories, exclusive paths, heartbeat intervals, and TTLs;
- scripts claim, heartbeat, release, and reconcile tasks before any expensive run;
- stale leases require reconciliation, not blind resubmission.

## Control Principles

- **Multi-agent for cognition, single-owner for execution.** Use independent or
  multi-trajectory passes for literature extraction, model/observable selection, result
  criticism, and report review. Expensive HPC execution is owned by one execution task
  at a time after the plan is accepted.
- **Cognitive subagent waits are soft-gated.** Read-only literature, model, structure,
  result, and report-review subagents should use a default wait of 300 seconds. Treat
  60 seconds as a soft status checkpoint only; do not close the subagent at that point.
  Use 600 seconds as the hard timeout for slow reviewer tasks, then record a
  `multi-agent-timeout` event with the role, scope, waited seconds, and any partial
  output. Timeout/no-response evidence is `inconclusive`, not a gate block by itself.
- **Knowledge is a planning dependency.** Task files can declare `knowledge_required`
  for tool-agnostic science such as electrochemistry, surface thermodynamics,
  molecular dynamics, electronic-structure interpretation, or visualization.
- **Release gates are verdict artifacts, not advice.** Plan, structure, result, and
  report gates should write machine-readable verdicts. Missing, malformed, blocking, or
  unwaived gate verdicts stop only their matching downstream release actions: plan and
  structure gates can stop engine/HPC submission; result gates can stop claim
  acceptance; report gates can stop final report generation. Scientific-critic,
  result-gate, report-gate, and stage-synthesis work belongs after the first validated
  calculation wave and must not be placed on the first HPC-submission critical path.
  Gates do not stop upstream model construction: when initial structures are missing or
  inadequate, create a structure-modeler task to build documented candidate models,
  then send those candidates to the structure gate.
  Structure artifacts must pass `structure-prep` validation. For
  slabs/adsorbates/clusters, engines should consume them only after an accepted
  `model-structure-review`/`structure_gate`.
  A `structure-modeler` cannot write `structure-audit-report`,
  `model-structure-review`, or `gate-verdict` artifacts. Human-facing figures must
  follow `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md`; reports must pass
  `__NEBULAMAT_AICC_ROOT__/tools/report/references/validation.md`.
- **Ready is derived, not persisted.** `ready_tasks.py` computes readiness from task
  status, dependencies, inputs, approvals, and output conflicts.
- **Accepted is not self-asserted.** `completed` is producer output, `validated` is a
  deterministic checker or parser verdict, and `accepted` is an orchestrator/critic or
  user decision that the artifact answers the pre-registered objective.
- **Research state is cyclic, not linear.** A first batch of calculations produces
  evidence for criticism, not an automatic final report. Result critics may create
  `follow-up-proposal` artifacts; accepted follow-ups become new task nodes and the
  DAG loops back through execution, validation, and criticism until remaining gaps are
  accepted, waived, or explicitly reported as limitations.

## Where to Find What

| Need | Go to |
|---|---|
| `.research/` layout, source-of-truth rule, `project.yaml` | `references/state-files.md` |
| task YAML schema, statuses, skill/knowledge binding, execution policy | `references/task-protocol.md` |
| role boundaries, allowed outputs, single-owner execution rule | `references/roles.md` |
| slab/facet/adsorbate multi-agent model review gate | `references/model-structure-review.md` |
| machine-readable gate verdict schema and hook policy | `references/gate-contract.md` |
| producer-to-consumer handoff rules | `references/handoff-contracts.md` |
| durable subagent findings under `work/agents/` | `references/subagent-artifacts.md` |
| critic inputs, checks, outcomes, and write restrictions | `references/critic-contract.md` |
| evidence packet contents for critic/report handoff | `references/evidence-packets.md` |
| execution ownership, owner directories, exclusive paths | `references/ownership-protocol.md` |
| lease schema, TTLs, heartbeats, release rules | `references/lease-contract.md` |
| stale task reconciliation and recovery decisions | `references/recovery-protocol.md` |
| artifact registry, status rules, provenance, reportable evidence | `references/artifact-contract.md` |
| human decisions, assumptions, append-only events, reconciliation | `references/event-log.md` |
| ready/blocked rules and CLI behavior | `references/ready-rules.md` |
| validate a `.research/` directory | `uv run scripts/validate_state.py PATH/.research` |
| list ready and blocked tasks | `uv run scripts/ready_tasks.py PATH/.research` |
| claim a ready execution task | `uv run scripts/claim_task.py PATH/.research TASK_ID` |
| refresh an active execution lease | `uv run scripts/heartbeat_task.py PATH/.research TASK_ID` |
| release an active execution lease | `uv run scripts/release_task.py PATH/.research TASK_ID --status completed` |
| report or mark stale leases | `uv run scripts/reconcile_leases.py PATH/.research` |
| initialize a new `.research/` project | `uv run scripts/init_project.py PROJECT --project-id ID --title TITLE --objective OBJECTIVE` |
| run a task's deterministic required checks | `uv run scripts/run_required_checks.py PATH/.research TASK_ID` |
| check a structure generator does not cross into engine/submission work | `uv run scripts/check_structure_generator_boundary.py --forbid-engine-inputs PATH/TO/SCRIPTS` |
| validate a plan/structure/result/report gate YAML | `uv run scripts/validate_gate.py work/reviews/GATE.yaml --research PATH/.research` |
| block HPC submission unless structure gates and cluster-guide-read evidence passed | `uv run scripts/check_pre_submit.py PATH/.research TASK_ID` |
| block claim acceptance unless result gates passed | `uv run scripts/check_pre_accept_claim.py PATH/.research CLAIM_ID --outcome addresses` |
| block final report generation unless claims/report gates passed; write stage synthesis and scaffold follow-up tasks when open follow-ups remain | `uv run scripts/check_pre_report.py PATH/.research TASK_ID` |
| scaffold next-wave tasks from an accepted follow-up proposal | `uv run scripts/scaffold_follow_up_tasks.py PATH/.research FOLLOW_UP_PROPOSAL_ID` |
| record artifact validation, acceptance, or rejection | `uv run scripts/accept_artifact.py PATH/.research ARTIFACT_ID --status accepted --reason ...` |
| classify a scientific claim | `uv run scripts/classify_claim.py PATH/.research CLAIM_ID --outcome addresses --reason ...` |
| scaffold a report manifest from accepted claims | `uv run scripts/scaffold_report_manifest.py PATH/.research -o work/report-manifest.json` |
| run protocol smoke tests | `uv run scripts/smoke_tests.py` |
| minimal working example | `examples/minimal-project/` |
| role handoff example | `examples/role-handoff-project/` |
| execution ownership examples | `examples/claim-ready-project/`, `examples/claimed-execution-project/`, `examples/stale-lease-project/` |

## Workflow

1. Create `.research/project.yaml` with objective, mode, success criteria, and default
   approval policy.
2. Add task YAML files for the current project stages. Bind each task to the relevant
   role contract, skill, knowledge references, expected artifacts, approval type, and
   release gates. `skill` is per task: one project can route different tasks to
   `structure-prep`, `vasp`, `cp2k`, `gaussian`, `hpc-submit`, `ovito`, or `report`.
3. Register existing source files or generated outputs in `artifacts.jsonl`.
4. Record approvals, assumptions, model choices, and acceptance decisions in
   `decisions.jsonl`.
5. Append important status changes and job events to `events.jsonl`.
6. Run `validate_state.py` before handing the state to another agent.
7. Run `ready_tasks.py` to decide what can proceed; execute through the named skill.
8. Submit the first calculation wave after the plan/model choice, structure gate where
   relevant, engine preflight, execution approval, and single-owner lease are in place.
   Do not wait for scientific critics, result gates, report gates, or stage synthesis
   before this first HPC handoff; those consume parser evidence that does not exist yet.
9. After each calculation wave, assemble evidence packets for scientific-critic tasks.
   Convert `needs-follow-up`/`inconclusive` outcomes into new proposed tasks rather
   than drafting final claims from incomplete evidence. Use stage synthesis only here:
   as an interim packet that shows validated/accepted/pending evidence and follow-up
   tasks after results exist.
   Use `scaffold_follow_up_tasks.py` when an accepted `follow-up-proposal` contains
   structured `recommended_tasks`; generated tasks are marked `stage: follow-up`,
   `source_proposal`, and `resolves_follow_up`.
10. Generate a final report only when open follow-up proposals are resolved by accepted
   evidence, explicit waivers, or visible limitation notes and the report gate passes.
   If `check_pre_report.py` finds unresolved follow-up proposals for a final report
   task, it keeps the final report blocked, writes a temporary stage-synthesis Markdown
   report, and scaffolds next-wave `stage: follow-up` tasks from accepted structured
   proposals when possible.

`workflow.md` or `response-workflow.md` remains useful as a human-readable summary, but
`.research/` is the source of truth for structured state.

## Hard Guardrails

- Do not use this procedure to bypass tool skill validation. Engine parser/checker
  scripts remain authoritative for technical validation.
- Do not allow more than one task to write the same run directory. Phase 1 records
  `execution_policy`; Phase 3 enforces leases and heartbeats.
- Do not submit expensive HPC tasks until the required model/observable, method,
  structure, gate verdict, and approval artifacts are present and accepted.
- Do not let structure producers approve their own structures. Engine/HPC tasks should
  consume accepted structure artifacts plus an accepted `model-structure-review` or
  `structure_gate` produced by an independent reviewer role.
- Do not let a report task consume non-accepted claims unless the task explicitly marks
  them as limitations or blocked access issues.
- Do not let a stage synthesis masquerade as a final report. Interim reports must state
  which claims are accepted, pending critic review, `needs-follow-up`, or waived.
- Do not put secrets, tokens, full POTCAR contents, licensed force-field contents, or
  private cluster connection details in `.research/`.
