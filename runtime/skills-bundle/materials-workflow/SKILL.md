---
name: materials-workflow
description: Coordinate the materials multi-agent workflow with durable state, role gates, and bounded evidence-backed self-evolution.
---

# Materials workflow DAG

The coordinator task DAG is the source of truth for dependencies, parallelism,
review votes, and completion. OpenCode agents provide reasoning and call the
coordinator tools; prose alone never changes task state.

Every agent receives an `AgentTaskInput` and returns an `AgentTaskOutput` with
`task_id`, `workflow_id`, `agent`, `status`, `artifacts`, `evidence`, findings,
uncertainty, blockers, metrics, and an optional learning proposal. A completed
task without an artifact is invalid.
Call `get_material_agent_schemas` when a task starts; the runtime catalog is
authoritative when a bundled prompt and package version differ.

## Roles

- `materials-supervisor`: plans the goal and delegates stages.
- `materials-discovery`: searches providers and writes candidates.
- `materials-validator`: runs deterministic formula, structure, unit, and DFT checks.
- `materials-screener`: applies declared criteria and writes exclusions.
- `materials-designer`: maps benchmark advantages/failures, proposes novel
  falsifiable candidates, and interprets human results.
- `materials-synthesis`: writes a reproducible, safety-gated synthesis and
  characterization plan for human approval.
- `materials-dft`: prepares and dispatches remote calculations.
- `materials-reviewer`: independently audits evidence and controls review gates.
- `chemistry-reasoner`: provides bounded stoichiometry, speciation,
  thermodynamics, kinetics, and mechanism analysis.

The `alkaline-electrolysis` domain profile adds:

- `electrochemistry-analyst`: condition-normalized half-cell and full-cell metrics.
- `catalyst-scientist`: catalyst identity, active state, and mechanism alternatives.
- `interface-transport-specialist`: electrolyte, diaphragm, wetting, bubbles,
  transport, conductivity, and crossover.
- `degradation-analyst`: supported failure mechanisms and lifetime boundaries.
- `electrolysis-safety`: blocking chemical, gas, pressure, thermal, and shutdown checks.
- `electrochemistry-experimentalist`: reproducible protocols for named-human execution.

## DAG gates

The minimum graph is `plan -> discover:* -> normalize -> validate -> screen ->
review:* -> review:judge -> complete`. The four provider discovery tasks become
ready together and should run concurrently. `normalize` uses a two-provider
quorum, so useful work can continue while optional sources are pending and
later results can produce an enriched artifact version. Chemistry,
data/provenance, and DFT
review tasks also run independently. The Judge records the vote summary; it
cannot complete without an approved quorum.

For alkaline water electrolysis, create the DAG with
`domain_profile="alkaline-electrolysis"`. After `validate`, six independent
`domain:*` tasks must complete before `screen`. The review fan-out also adds
electrochemistry and safety votes; the Judge depends on all declared votes.

`list_material_tasks` returns primary `ready` work separately from
`background_ready`. Dispatch `reconcile:providers` from the background list
after all source tasks terminate; it must write a new immutable candidate
artifact instead of overwriting the quorum snapshot.

When DFT is requested, the approved Judge releases
`dft:prepare -> dft:audit -> dft:human-review -> dft:run -> dft:parse ->
dft:postprocess -> independent DFT review`. `dft:prepare` must attach the selected AICC engine preflight and, for
VASP, a versioned VASPKIT plan. `dft:parse` must attach its deterministic
`validation.json`. `dft:postprocess` executes every applicable VASPKIT task or
records a scientifically justified `not_applicable` decision. The reviewer,
not the parser or executor, owns the scientific-validity rung, and design
workflows cannot release synthesis until that review is recorded. Use
`blocked` when required evidence is absent; do not convert missing data into a
negative property.

`dft:audit` is an independent AI model-and-cost audit and must record the model
scope, parameters, wall-time range, core-hours, memory, planned run count,
lower-cost alternative, and `0.1 CNY/core-hour` cost. `dft:human-review` is a
real human gate: `human:<id>` must approve the exact SHA-256-bound
`DFTRunSpec.json`, model audit, and cost estimate before `dft:run`. A requested
change invalidates that approval and resets preparation/audit to a new version.
All child task packets and responses must use the workflow `response_language`.

With `design_mode=true`, the approved screening review releases
`design:brief -> design:candidates:N -> design:validate:N -> design:audit:N ->
synthesis:plan:N -> experiment:record:N -> experiment:interpret:N`. The
`experiment:record:N` role is `human`; agents must not claim or complete it.
Only a `human:<id>` or the review Judge may append another evidence-linked round
with `start_material_design_iteration`. Final completion remains Judge-owned.

Under `alkaline-electrolysis`, the experiment segment expands to
`synthesis:plan:N -> experiment:protocol:N -> experiment:safety:N ->
experiment:record:N -> experiment:analyze:*:N -> experiment:interpret:N`.
Electrochemistry, catalyst, transport, and degradation analyses run in parallel
after the human record. The designer integrates them without hiding conflicts.

## Bounded self-evolution

Each role may load approved context and record an evidence-backed experience.
Reusable lessons are proposals, not instructions. A proposal must pass the
deterministic materials benchmark, historical workflow replay, an explicit
canary cohort, and Reviewer or `human:<id>` promotion. Any regression triggers
append-only rollback. Approved rules are hypotheses and never replace
deterministic validation or source provenance. Agents must not edit their own
prompts, permissions, or tools.

Provider runtime policies are a separate allowlisted contract covering only
timeouts, budgets, attempts, concurrency, circuits, cache TTL, batch size, and
leases. They must pass the same offline replay, canary, explicit promotion, and
rollback gates. Endpoint, authentication, permission, and tool changes are not
self-evolvable.
