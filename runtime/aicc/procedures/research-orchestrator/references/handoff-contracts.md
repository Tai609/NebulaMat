# Handoff Contracts

> Load this when: one task consumes another task's output, a subagent returns work to
> the orchestrator, or a report/critic task needs to decide whether evidence is usable.

## Contract

A handoff is artifact-based. Chat summaries can explain intent, but downstream work
must consume registered artifacts or declared files with provenance.

Subagent/cognitive handoff: if a subagent result will affect later planning, gates, claims, reports, or follow-up tasks, write it under `work/agents/` and register it as a durable artifact. See `references/subagent-artifacts.md` for names, types, and the Markdown template.

Minimum producer handoff:

- task status updated to `completed`, `validated`, or `accepted`;
- output artifact registered in `artifacts.jsonl` when it exists;
- artifact path inside the project root;
- provenance lists source files, commands, parser outputs, job IDs, or decision IDs;
- assumptions and limitations are recorded in the task or artifact.

Minimum consumer handoff:

- task declares the input artifact and `min_status`;
- task declares `role_contract`, `can_read`, `can_write`, and `cannot` when the role
  boundary matters;
- task declares `evidence_packet` when a critic or report decision depends on multiple
  artifacts.

Minimum structure handoff:

- surface/facet choices are backed by a `surface-literature-review` artifact or clearly
  marked exploratory;
- generated structures are registered as `structure-set` artifacts with provenance;
- a read-only `structure_gate`/`model-structure-review` records slab dimensions, vacuum
  lower/upper bounds, computational economy, fixed layers, closest contacts with
  covalent-radius thresholds/margins, adsorbate-surface distances, periodic-image
  separation, and any requested revisions; complex projects may split this into a
  separate `structure-audit-report`;
- downstream engine tasks consume accepted structures, not merely generated files.
- downstream engine tasks consume an accepted `structure_gate` or
  `model-structure-review` verdict, not merely a narrative discussion.

Minimum claim/report handoff:

- result claims are separated from raw parser values;
- a `result_gate` verdict records whether the evidence supports `addresses`,
  `inconclusive`, `contradicts`, or `needs-follow-up`;
- report tasks consume accepted `scientific-claim` artifacts and an accepted
  `report_gate` verdict;
- unsupported or waived evidence remains labeled as a limitation in the report.

Claim/report handoff begins only after the first relevant calculation wave has parser
or analysis evidence. Do not put `scientific-critic`, `result_gate`,
`synthesis-report`, `report_gate`, or stage-synthesis artifacts on the first engine/HPC
submission path. The pre-submit handoff is limited to the accepted plan/model choice,
accepted structures and `structure_gate` when structures are in scope, engine preflight
evidence, execution approval, and single-owner lease state.

## Status Discipline

- Planning tasks usually require accepted method/model artifacts.
- Critic tasks may read validated parser results when the goal is to decide whether a
  claim can be accepted.
- Report tasks should consume accepted claims and accepted figure/report inputs.
- If a report must mention a non-accepted result, mark it as a limitation, blocked
  access issue, or exploratory note rather than a conclusion.

## Execution Handoff

Execution handoff is deliberately narrow. Once an expensive HPC path is approved, one
`engine-runner` task owns the run directory, submission, monitoring, recovery, parser
output, and job record. Other agents may review the plan or results, but they do not
submit alternate production jobs unless a new approved task and run directory are
created.

## Handoff Checklist

- The receiving task can name every consumed artifact by ID.
- Required artifact statuses satisfy `min_status`.
- The writer role is allowed to create the expected output type.
- Paths do not escape the project root.
- Numeric outputs have units and file provenance.
- Claims are separated from raw parser values.
- Subagent findings that matter downstream are registered under `work/agents/`.
- Gate verdicts are machine-readable and registered as artifacts.
- Contradictions and inconclusive outcomes stay visible downstream.
