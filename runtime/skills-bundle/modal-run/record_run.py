#!/usr/bin/env python3
"""Record a remote (SSH/HPC/Modal) experiment run into the Open Science provenance.

Remote runs execute off the laptop, so the app can't capture their environment,
hardware, or outputs. This helper — called by the remote-compute / modal-run skills
AFTER a job completes and its results are fetched — appends an accurate run
record to <workspace>/.openscience/remote-runs.jsonl, which the app merges into
the Runs view. It owns the record schema so the agent never hand-writes JSON.

Record EVERYTHING the run touched, not a sample: pass every script that ran as a
repeated --code, every fetched output as a repeated --output. On a plain SSH box
the software environment is ambient (whatever happens to be installed), not
declared, so it is lost unless captured on the box at run time — pass the fetched
manifest as --env-file to pin the interpreter + package versions. (Modal/Slurm
runs declare their environment in the versioned spec — the Image/module lines —
so they need no --env-file.)

Usage (run from the workspace root):
  python record_run.py --surface ssh --command "bash run.sh" \
      --status ok --host home-3090 --wall-ms 3002 \
      --hardware "used: 24 CPU cores, 62 GB RAM (CPU-only; GPUs idle)" \
      --code run.sh --code humanoid_sim.py \
      --output results/humanoid-sim/20260708-201944-12345/result.json \
      --output results/humanoid-sim/20260708-201944-12345/trajectory.npz \
      --env-file results/humanoid-sim/20260708-201944-12345/env.txt
"""
import argparse
import hashlib
import json
import os
import sys
import time

STORE = os.path.join(".openscience", "remote-runs.jsonl")
ENV_DIR = os.path.join(".openscience", "env")  # package lockfiles, content-addressed
HASH_CAP = 5_000_000  # bytes; larger files are recorded by size only
FREEZE_MARKER = "--- pip freeze ---"


def artifact(path, missing):
    """A {path, hash?, size} record for a workspace file (size 0 if missing).

    A path that resolves to size 0 is appended to `missing` so the caller can
    warn — a recorded-but-absent file usually means the fetch step was skipped.
    """
    rec = {"path": path.replace(os.sep, "/")}
    try:
        size = os.path.getsize(path)
        rec["size"] = size
        if size == 0:
            missing.append(path)
        elif size <= HASH_CAP:
            with open(path, "rb") as f:
                rec["hash"] = hashlib.sha1(f.read()).hexdigest()[:16]
    except OSError:
        rec["size"] = 0
        missing.append(path)
    return rec


def read_env(path):
    """Parse a remote env manifest into an `env` object (ProvenanceEnv shape).

    The manifest is written on the remote by run.sh (see the SKILL) and fetched
    back. Expected shape (order-free header, then an optional freeze section):
        Python 3.11.2
        PLATFORM=linux-x86_64
        --- pip freeze ---
        numpy==2.4.4
        scipy==1.17.1
    The full freeze is stored as a content-addressed lockfile under
    .openscience/env/<hash>.txt (mirroring how the app records local runs), and
    `packages` points at it. Returns None if the file is missing/empty.
    """
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return None

    python = platform = None
    freeze, in_freeze = [], False
    for raw in lines:
        s = raw.strip()
        if s == FREEZE_MARKER:
            in_freeze = True
            continue
        if in_freeze:
            if s and "==" in s and not s.startswith("#"):
                freeze.append(s)
            continue
        if s.startswith("Python "):
            python = s.split(None, 1)[1].strip()
        elif s.upper().startswith("PLATFORM="):
            platform = s.split("=", 1)[1].strip().lower().replace("darwin", "macos")

    env: dict[str, object] = {
        "platform": platform or "unknown",
        # Which app version recorded this; injected into the sidecar's env.
        "app": os.environ.get("OPENSCIENCE_APP_VERSION", "unknown"),
    }
    if python:
        env["python"] = python
    if freeze:
        text = "\n".join(freeze) + "\n"
        h = hashlib.sha1(text.encode()).hexdigest()[:16]
        os.makedirs(ENV_DIR, exist_ok=True)
        lock = os.path.join(ENV_DIR, f"{h}.txt")
        if not os.path.exists(lock):
            with open(lock, "w", encoding="utf-8") as f:
                f.write(text)
        env["packages"] = {"count": len(freeze), "hash": h}
    return env


def existing_output_owner(path):
    """Return the run id that already recorded an output path, if any."""
    try:
        with open(STORE, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for output in record.get("outputs") or []:
                    if output.get("path") == path:
                        return record.get("runId") or "unknown run"
    except OSError:
        return None
    return None


def reject_reused_output_paths(record):
    """Remote outputs must be immutable: a new run needs a new result path."""
    conflicts = []
    for output in record.get("outputs") or []:
        path = output.get("path")
        if not path:
            continue
        owner = existing_output_owner(path)
        if owner:
            conflicts.append((path, owner))
    if not conflicts:
        return

    print("error: output path already recorded; refusing to overwrite run provenance.", file=sys.stderr)
    for path, owner in conflicts:
        print(f"  {path} was already recorded by {owner}", file=sys.stderr)
    print(
        "fetch this run into a new immutable result directory, e.g. "
        "results/<job-name>/<YYYYmmdd-HHMMSS>-<run-id>/, then record those paths.",
        file=sys.stderr,
    )
    raise SystemExit(2)


def main():
    p = argparse.ArgumentParser(description="Record a remote run into Open Science provenance.")
    p.add_argument("--command", required=True, help="the submit command, e.g. 'sbatch train.slurm'")
    p.add_argument("--surface", required=True, choices=["hpc", "modal", "ssh"], help="compute surface")
    p.add_argument("--status", default="ok", choices=["ok", "failed"], help="terminal outcome")
    p.add_argument("--host", help="cluster host / Modal app the run executed on")
    p.add_argument("--job-id", dest="job_id", help="scheduler job id / Modal call id")
    p.add_argument("--hardware", help="hardware the job USED, e.g. '1x A100, CUDA 12.2' or "
                   "'24 CPU cores, 62 GB (CPU-only)'. State what ran, not what the box has.")
    p.add_argument("--wall-ms", dest="wall_ms", type=int, help="wall-clock duration in milliseconds")
    p.add_argument("--code", action="append", default=[],
                   help="a script that ran — pass one per script (entry AND its helpers), repeatable")
    p.add_argument("--output", action="append", default=[],
                   help="a fetched output file — pass one per file, repeatable")
    p.add_argument("--env-file", dest="env_file",
                   help="fetched remote env manifest (SSH runs); pins interpreter + packages")
    p.add_argument("--session-id", dest="session_id", help="originating conversation id")
    args = p.parse_args()

    # The skill passes `--session-id "$(cat .openscience/session.txt)"`, which is
    # empty when the marker is absent — treat that as "no session".
    if args.session_id is not None and not args.session_id.strip():
        args.session_id = None

    ts = int(time.time())
    run_id = "run_" + hashlib.sha1(f"{time.time_ns()}:{args.command}".encode()).hexdigest()[:16]

    missing = []
    record = {
        "runId": run_id,
        "ts": ts,
        "command": args.command,
        "surface": args.surface,
        "status": args.status,
        "code": [artifact(c, missing) for c in args.code],
        "outputs": [artifact(o, missing) for o in args.output],
    }
    if args.env_file:
        env = read_env(args.env_file)
        if env:
            record["env"] = env
        else:
            missing.append(args.env_file)
    for key, val in (
        ("host", args.host),
        ("jobId", args.job_id),
        ("remoteHardware", args.hardware),
        ("wallMs", args.wall_ms),
        ("sessionId", args.session_id),
    ):
        if val is not None:
            record[key] = val

    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    reject_reused_output_paths(record)
    with open(STORE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    print(f"Recorded {args.surface} run {run_id} ({args.status}) → {STORE}", file=sys.stderr)
    if not args.code:
        print("warning: no --code recorded — the run's code is not pinned.", file=sys.stderr)
    if not args.output:
        print("warning: no --output recorded — the run produced no traceable artifacts.", file=sys.stderr)
    for m in missing:
        print(f"warning: {m} not found (recorded as size 0) — was it fetched back?", file=sys.stderr)


if __name__ == "__main__":
    main()
