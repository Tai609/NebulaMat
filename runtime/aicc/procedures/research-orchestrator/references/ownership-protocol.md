# Execution Ownership Protocol

> Load this when: preparing to run, submit, monitor, recover, or resume any task that
> writes a calculation directory, consumes substantial compute, or has
> `execution_policy.requires_claim: true`.

## Purpose

Ownership converts "task is ready" into "one agent owns this execution path." It prevents
multiple agents from writing the same run directory or submitting competing HPC jobs for
the same objective.

## Rules

- Claim before writing `owner_dir` or submitting an expensive job.
- Keep one active lease per `single_owner` task.
- Keep one active lease per `exclusive_paths` entry.
- Heartbeat while monitoring long work.
- Release the lease when the task is completed, blocked, failed, cancelled, validated,
  or accepted.
- Reconcile stale leases before any resume, rerun, or recovery action.

## Execution Policy

Use this shape for expensive or stateful execution:

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

`owner_dir` is the primary working directory. `exclusive_paths` includes every mutable
project path the task may write. Paths are relative to the project root.

## Claim Boundary

`ready_tasks.py` answers whether a task may be claimed. `claim_task.py` performs the
claim, writes the lease, changes task status to `running`, and records events.

The claim does not validate scientific choices. It assumes approvals, artifacts, and
release gates already made the task ready.

## Parallelism Boundary

Parallel subagents are appropriate before claim for planning and after parser output for
criticism. They are not appropriate for independent production submissions against the
same owner directory, objective, or expensive task.

## Stale Boundary

A stale lease means the owner missed the TTL. It does not mean the job stopped, failed,
or may be rerun. Reconcile scheduler state, files, logs, parser outputs, and events
before changing task status or submitting anything new.
