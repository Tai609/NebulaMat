# Recovery Protocol

> Load this when: a lease is stale, a task is `running` after a disconnect, a scheduler
> job left the queue, or files exist without accepted parser output.

## Recovery Order

1. Validate `.research/`.
2. Inspect active and stale leases.
3. Reconcile filesystem state, scheduler accounting, logs, parser outputs, and events.
4. Decide one recovery action.
5. Record the decision in `decisions.jsonl`.
6. Update task status, lease status, and events.

## Recovery Actions

Use one of:

- `resume-monitoring`: job still exists or output is still being written.
- `parse-existing-output`: job finished and output needs parser validation.
- `mark-failed`: evidence shows the run failed.
- `mark-blocked`: missing human approval, missing files, or ambiguous state blocks safe
  recovery.
- `rerun-approved`: explicit approval exists to rerun or supersede previous output.
- `cancel`: user or policy cancels the task.

## Required Evidence

Do not infer completion from a scheduler job leaving the queue. Recovery evidence should
name at least one of:

- scheduler accounting record or queue output;
- job stdout/stderr or engine log;
- parser command and result;
- owner directory file listing;
- prior decision ID approving rerun or overwrite.

## Stale Lease Policy

An expired lease is a safety signal, not a permission grant. Never submit a replacement
job only because `expires_at` is in the past. First determine whether the previous job is
still running, already produced usable output, failed, or is ambiguous.
