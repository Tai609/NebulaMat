# Ready and Blocked Rules

> Load this when: interpreting `ready_tasks.py` output or deciding why a task can or
> cannot start.

Readiness is derived. A task file never needs to persist `ready`.

## Ready Conditions

A task is ready when all are true:

1. `status` is `proposed` or `approved`.
2. All `depends_on` task IDs exist and have status `accepted`.
3. Every non-optional artifact input exists in `artifacts.jsonl`.
4. Every present artifact input satisfies its `min_status`; default is `accepted`.
5. Every file input exists, unless the input is marked `optional: true`.
6. If `approval` is not `none`, a matching approved decision exists in
   `decisions.jsonl`. The match is explicit: `kind` may equal the approval value
   itself, `scientific_model_choice` may be satisfied by a `method-choice` decision,
   or a generic `kind: approval` decision must carry `approval_type: <task approval>`.
   A generic method or artifact acceptance record does not unlock unrelated gates such
   as `expensive_hpc_submission`.
7. Every expected output artifact ID is not already an active non-superseded accepted
   artifact, unless the task explicitly supersedes it.
8. A final `synthesis-report`/`report` task has no unresolved report-blocking
   `follow-up-proposal` artifacts. Stage-synthesis report tasks are allowed while
   follow-up proposals remain open because their job is to summarize the current state.
   When a final report is blocked this way, running `check_pre_report.py` writes a
   temporary stage-synthesis Markdown report and scaffolds next-wave `stage: follow-up`
   tasks from accepted structured proposals when possible.
9. The task is not `blocked`, `running`, `completed`, `validated`, `accepted`,
   `failed`, or `cancelled`.

## Output

`ready_tasks.py` prints `READY` and `BLOCKED` sections:

```text
READY
T003  Build candidate adsorption models

BLOCKED
T004  Run slab relaxation       waiting for T003 accepted
T005  Draft report              input artifact reaction-energy is not accepted
T006  Submit production job     missing approval: expensive_hpc_submission
```

## Execution Boundary

Ready means the task may start. It does not mean the task may bypass the named skill's
`SKILL.md`, required references, deterministic scripts, or approval breakpoints.
For release-sensitive actions such as HPC submission, claim acceptance, or report
generation, run the matching hook (`check_pre_submit.py`, `check_pre_accept_claim.py`,
or `check_pre_report.py`) even if a human is driving the command directly. The hooks
are the last guard against bypassing machine-readable gate verdicts.

Those hooks are not the readiness rule for upstream modeling. If a task's purpose is to
inspect supplied structures, build candidate models, repair a structure gate finding,
or draft the gate verdict itself, do not mark it blocked just because the release gate
does not exist yet. Missing gate verdicts block the release action that consumes the
gate, not the task that produces the evidence for that gate.

`validate_state.py` checks whether the project state is well-formed. It intentionally
allows a task to be blocked by missing approval, a not-yet-registered upstream artifact,
or an artifact below `min_status`; those are readiness conditions, not schema errors.

HPC and expensive execution tasks should normally include:

```yaml
execution_policy:
  mode: single_owner
  allow_parallel_subagents: false
```

Multiple subagents may debate the plan before this point; only the single execution
owner should submit and monitor the expensive run.

When `execution_policy.requires_claim: true`, ready means the task may be claimed. The
owner still must run `claim_task.py` successfully before editing the owner directory or
submitting an expensive job.
