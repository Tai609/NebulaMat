# Decisions and Events

> Load this when: recording approvals, assumptions, scientific choices, acceptance
> decisions, job events, or reconciliation history.

`decisions.jsonl` records choices. `events.jsonl` records how the project reached its
current state.

## Decisions

Each line is one JSON object:

```json
{"decision_id":"D001","task_id":"T002","kind":"approval","decision":"approved","by":"user","reason":"Use smallest credible slab model","created_at":"2026-06-25T00:00:00+08:00"}
```

Required fields:

| Field | Meaning |
|---|---|
| `decision_id` | Stable ID. |
| `kind` | `approval`, `assumption`, `method-choice`, `scope-change`, `acceptance`, or `rejection`. |
| `decision` | `approved`, `rejected`, `deferred`, `accepted`, or the selected option. |
| `by` | `user`, `orchestrator`, `critic`, or `autonomous-default`. |
| `reason` | Why the decision was made. |
| `created_at` | ISO 8601 timestamp. |

Optional: `task_id`, `artifact_id`, `approval_type`, `evidence`, `supersedes`.
For a generic `kind: approval` decision that should satisfy a task approval gate,
record `approval_type` with the exact task `approval` value, for example
`expensive_hpc_submission`. This prevents a method-choice or artifact-acceptance
decision from accidentally opening an unrelated execution gate.

Record decisions for:

- expensive HPC submission approval;
- scientific model, observable, reference-state, and method choices;
- overwrite or deletion approvals;
- promotion of exploratory or assumption-laden evidence to a report;
- review-response Approval #1 and Approval #2;
- acceptance or rejection of a scientific claim;
- autonomous-mode defaults that would have asked a human in semi-automatic mode.

## Events

Each line is one JSON object:

```json
{"event_id":"E001","task_id":"T001","event":"status_changed","from":"approved","to":"completed","created_at":"2026-06-25T00:00:00+08:00","evidence":["work/method-fingerprint.md"]}
```

Common events:

```text
task_created
status_changed
artifact_registered
decision_recorded
validation_passed
validation_failed
required_check_passed
required_check_failed
job_submitted
job_finished
task_claimed
task_heartbeat
task_released
lease_stale
recovery_decided
claim_classified
report_built
reconciled
```

## Append-Only Rule

Events are append-only. Current state lives in task YAML and `artifacts.jsonl`; the event
log explains how the state got there.

If current state and events disagree, do not silently pick one. Reconcile from evidence:
filesystem, scheduler accounting, parser outputs, and recorded decisions.
