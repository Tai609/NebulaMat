#!/usr/bin/env sh
# wait_for_job.sh — block until a Slurm job reaches a TERMINAL state, robustly.
#
# The naive `until [ -z "$(squeue -h -j ID)" ]; do sleep; done` loop treats a
# transient query failure (ssh drop, slurmctld timeout, sacct lag) as "job
# finished" and fires a false positive — advancing the next stage onto an
# unconverged structure. This waiter avoids that:
#   * a failed/empty query is "unknown, keep waiting" — never "done";
#   * the TERMINAL state is confirmed via `sacct` (authoritative), not by the
#     job's absence from `squeue`;
#   * exit 0 ONLY on COMPLETED; non-zero on FAILED/TIMEOUT/CANCELLED/OOM/...
#
# A scheduler-terminal state is NOT scientific convergence. After this returns 0,
# still gate on the engine parser (e.g. tools/vasp/scripts/parse_vasp.py: "reached
# required accuracy") before consuming a CONTCAR/restart. See ../references/validation.md.
#
# Usage: wait_for_job.sh JOBID [--poll SECONDS] [--timeout SECONDS]
#   --poll     seconds between checks (default 30)
#   --timeout  give up after this many seconds (default 0 = no limit)
#
# Run it where squeue/sacct work — on the cluster, or inside a persistent rsess
# session — NOT by opening a fresh ssh per poll. Requires Slurm accounting
# (sacct); if sacct is disabled it exits 4 rather than guess success.
# PBS analogue: squeue->`qstat`, sacct->`qstat -x -f`; the logic is identical.
#
# Exit codes: 0 COMPLETED | 1 ended non-successfully | 2 usage | 3 timeout |
#             4 left queue but no terminal state from sacct (verify manually).
set -u

JOBID=""
POLL=30
TIMEOUT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --poll)    POLL="${2:?--poll needs a value}"; shift 2 ;;
    --timeout) TIMEOUT="${2:?--timeout needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    -*) echo "wait_for_job.sh: unknown option: $1" >&2; exit 2 ;;
    *)  if [ -z "$JOBID" ]; then JOBID="$1"; shift
        else echo "wait_for_job.sh: unexpected argument: $1" >&2; exit 2; fi ;;
  esac
done
[ -n "$JOBID" ] || { echo "usage: wait_for_job.sh JOBID [--poll S] [--timeout S]" >&2; exit 2; }

started=$(date +%s 2>/dev/null || echo 0)

# First word of the job allocation's sacct State ("CANCELLED by 123" -> CANCELLED).
sacct_state() { sacct -j "$JOBID" -X -n -o State 2>/dev/null | awk 'NF{print $1; exit}'; }

unknown=0
while :; do
  if [ "$TIMEOUT" -gt 0 ] && [ "$started" -gt 0 ]; then
    now=$(date +%s 2>/dev/null || echo 0)
    if [ $((now - started)) -ge "$TIMEOUT" ]; then
      echo "wait_for_job.sh: TIMEOUT after ${TIMEOUT}s; job $JOBID still not terminal" >&2
      exit 3
    fi
  fi

  q=$(squeue -h -j "$JOBID" -o '%T' 2>/dev/null); q_rc=$?

  # squeue command itself failed (transient: ssh/slurmctld) -> never conclude.
  if [ "$q_rc" -ne 0 ]; then sleep "$POLL"; continue; fi
  # still pending/running/completing -> keep waiting.
  if [ -n "$q" ]; then unknown=0; sleep "$POLL"; continue; fi

  # squeue cleanly reports the job is gone. Confirm the terminal state via sacct.
  case "$(sacct_state)" in
    COMPLETED)
      echo "job $JOBID: COMPLETED (scheduler terminal state — NOT yet convergence; gate on the engine parser)"
      exit 0 ;;
    FAILED|TIMEOUT|CANCELLED|OUT_OF_MEMORY|NODE_FAIL|BOOT_FAIL|DEADLINE|PREEMPTED|REVOKED)
      echo "wait_for_job.sh: job $JOBID ended non-successfully: $(sacct_state)" >&2
      exit 1 ;;
    RUNNING|PENDING|REQUEUED|RESIZING|SUSPENDED|COMPLETING|CONFIGURING)
      unknown=0; sleep "$POLL"; continue ;;   # sacct lagging behind squeue
    *)
      # Job left the queue but sacct gave no usable state: lag or accounting off.
      unknown=$((unknown + 1))
      if [ "$unknown" -ge 3 ]; then
        echo "wait_for_job.sh: job $JOBID left the queue but sacct returned no terminal state (accounting off/lagging). Not assuming success — verify manually." >&2
        exit 4
      fi
      sleep "$POLL"; continue ;;
  esac
done
