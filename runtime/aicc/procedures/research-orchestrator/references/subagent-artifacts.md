# Subagent Artifacts

> Load this when: a cognitive subagent, reviewer pass, critic pass, or synthesis pass returns information that should survive context compaction or be consumed by later tasks.

## Purpose

Subagent output is not durable by default. Treat chat text as transient unless it is written to a project file and registered in `.research/artifacts.jsonl`. Valuable findings should become artifacts under `work/agents/` so later agents can cite them by ID instead of relying on conversation memory.

Use this for read-only cognitive work such as literature/method review, structure critique, result critique, planning alternatives, synthesis notes, or handoff summaries. Do not use it for raw engine outputs, large trajectories, licensed data, secrets, or full copied article text.

## Recommended Paths

Use project-root-relative paths:

```text
work/agents/T001-literature-review.md
work/agents/T002-structure-critic.md
work/agents/T003-result-critic.md
work/agents/T004-synthesis-note.md
work/agents/T005-handoff-note.md
```

A role-specific suffix is better than a generic transcript name. Keep one file per task/pass when possible. If multiple passes are needed, add a version or short scope label:

```text
work/agents/T003-result-critic-v2.md
work/agents/T003-result-critic-oer-free-energy.md
```

## Artifact Types

Allowed/common types:

```text
subagent-finding
literature-method-review
structure-review-note
critic-report
result-review-note
synthesis-note
handoff-note
follow-up-proposal
```

Use the most specific type available. `subagent-finding` is the generic fallback. `critic-report` is appropriate for a review that can influence an acceptance or gate decision, but a machine-readable gate verdict is still required when a release hook needs one.

## Markdown Template

```markdown
# Subagent Finding: <short scope>

- task_id: <Txxx>
- role: <literature-method | structure-critic | scientific-critic | synthesis-report | other>
- artifact_type: <subagent-finding | literature-method-review | structure-review-note | critic-report | result-review-note | synthesis-note | handoff-note | follow-up-proposal>
- scope: <what the subagent was asked to decide>
- input_artifacts: [<artifact-id>, <artifact-id>]
- input_paths: [<project-root-relative path>]
- produced_at: <ISO 8601>
- status_recommendation: <accepted | validated | draft | rejected | inconclusive>
- should_block_downstream: <yes | no | only-if-gate-agrees>

## Conclusion

<Compact conclusion. State what downstream task can safely use, and what it cannot use.>

## Evidence

| item | evidence or observation | source artifact/path | implication |
|---|---|---|---|
| E001 | <observation> | <artifact/path> | <why it matters> |

## Uncertainties / Limitations

- <missing evidence, ambiguity, assumptions, timeout/no-response, or weak inference>

## Recommended Next Tasks

| recommendation | reason | suggested skill/task | priority |
|---|---|---|---|
| <follow-up> | <why> | <skill or Txxx> | <high/medium/low> |

## Downstream Use

- may_consume_as: <planning evidence | critic input | report limitation | gate support | follow-up proposal>
- required_follow_up_before_report: <yes/no and why>
```

Do not paste long source text. Record source locations and paraphrase. If a subagent timed out or returned partial information, register the artifact as `draft` or `validated` and state that the evidence is inconclusive.

## JSONL Registry Examples

```jsonl
{"artifact_id":"T001-literature-review","type":"literature-method-review","path":"work/agents/T001-literature-review.md","produced_by":"T001","status":"accepted","created_at":"2026-06-28T00:00:00+08:00","provenance":["source-evidence-map","method-fingerprint"],"summary":"Literature/method review findings that seed the calculation plan."}
{"artifact_id":"T002-structure-critic","type":"structure-review-note","path":"work/agents/T002-structure-critic.md","produced_by":"T002","status":"validated","created_at":"2026-06-28T00:00:00+08:00","provenance":["candidate-structures","structure-audit-report"],"summary":"Read-only critique of candidate structures; supports but does not replace structure_gate."}
{"artifact_id":"T003-result-critic","type":"result-review-note","path":"work/agents/T003-result-critic.md","produced_by":"T003","status":"validated","created_at":"2026-06-28T00:00:00+08:00","provenance":["parser-result","method-fingerprint","model-observable-decision"],"summary":"Result critic notes; supports result_gate and follow-up decisions."}
```

## Handoff Rules

- Register valuable subagent outputs before ending the turn when they will influence later work.
- Downstream tasks should list the artifact in `inputs` or `evidence_packet`; do not cite only chat memory.
- A narrative subagent note can support a gate, but it does not replace a machine-readable `gate-verdict` when a hook expects one.
- Use `follow-up-proposal` when the main output is a proposed new calculation, post-processing step, or validation task.
- If the output contains private or copyrighted source details, summarize and cite the source location instead of copying the sensitive text.
