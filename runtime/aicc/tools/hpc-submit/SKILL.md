---
name: hpc-submit
description: Submit, monitor, and recover computational chemistry jobs locally, over approved SSH targets, or through Slurm/PBS schedulers. Use for job scripts, dry runs, queue checks, job arrays, log monitoring, resume decisions, and durable execution of long-running calculations.
---

# HPC Submit

Use only after the engine skill's scientific preflight passed. Scheduler state (`COMPLETED`/`FAILED`) describes the process; only the engine's parser decides whether the calculation succeeded.

This is the scheduler gate for every engine, not a VASP-specific helper. Whenever
an engine or workflow needs a Slurm/PBS/local batch script (VASP, CP2K,
Gaussian, LAMMPS, DeePMD, phonopy arrays, GROMACS if present, or post-processing
jobs), enter this skill before drafting the script and read the target
`~/.cluster-agents.md`.

If the project has `.research/` state and the execution task declares
`execution_policy.requires_claim: true`, do not submit until that task has an active
lease from `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/claim_task.py`. Record the lease
ID alongside the job ID, heartbeat while monitoring long work, and run
`reconcile_leases.py` before any recovery or rerun after disconnects. When `.research/`
uses `check_pre_submit.py`, register an accepted `cluster-guide-read` artifact in the
engine/HPC task inputs after reading the target `~/.cluster-agents.md`; this is the
machine-checkable evidence that the site guide was consulted.

## Know the cluster first (three-tier discovery)

**Already running on the target cluster?** Then there's nothing to connect to and no file transfer — commands run locally. Skip tier 1 and the rsess session; read `~/.cluster-agents.md` and the MOTD as local files, and submit directly. The tiers below cover the remote case.

Every cluster is different. **Do not connect to any server, guess any hostname/partition/module, or submit anything until you know the target machine.** Discover its facts in three tiers, cheapest first (full rules in `__NEBULAMAT_AICC_ROOT__/AGENTS.md` "Site environment"):

1. **Local bootstrap — just enough to connect.** The minimum to reach the box and move files: connection command/alias + file-transfer (scp/rsync) pattern. Lives locally (a small file the user points to, your own memory, or taught this session) — never guessed, never in this repo. For a stateful shell that survives disconnects, the `rsess` skill is recommended: open a session once per campaign, then `rsess run` for every remote command.
2. **On login, read the MOTD/banner.** Partitions, quotas, and policy are often announced there; follow any pointer it gives to an operating guide.
3. **Read `~/.cluster-agents.md` in the remote home** — the cluster's own operating guide (scheduler/partitions, modules, code launch lines, POTCAR/library paths, job-script templates, quotas, policy). Authored once on the cluster so later sessions and teammates inherit it. **On conflict it wins over any MOTD-pointed guide** — that's the center's generic default; this is the user's tested convention.

If `~/.cluster-agents.md` is absent or incomplete, ask the user and probe (`sinfo`, `module avail`, `scontrol show partition`) for the smallest missing set — scheduler/partitions/account, code launch (module, binary, mpirun vs srun), licensed potential/basis library paths, the modern-Python recipe — then **offer to write `~/.cluster-agents.md`** (template: `references/cluster-guide-template.md`) so it persists. Connection facts go to the local bootstrap; operating facts go to the remote guide. Both are private: never committed, never echoed into reports.

## Where to find what

| Situation | Go to |
|---|---|
| new cluster / missing environment fact / writing the remote `~/.cluster-agents.md` | `references/cluster-guide-template.md` + ask the user |
| need a persistent remote shell — stateful commands, survives disconnects, faithful output capture | use the `rsess` skill to open a session; then `rsess run`/`rsess peek` for all remote work |
| writing a job script (Slurm/PBS), job arrays, command translation, monitoring patterns, remote workspace setup | `references/running.md` |
| wait for a job to finish when chaining stages (without false positives from a transient `squeue` hiccup) | `scripts/wait_for_job.sh` — confirms a terminal state via `sacct`; exit 0 only on COMPLETED, then still gate on the engine parser |
| execution-side preflight; what to record at submission | `references/validation.md` |
| pending forever, OOM-kill, TIMEOUT, node failures, module/MPI problems, corrupted transfers, lost session output | `references/errors.md` |
| working examples to copy and adapt | `examples/` |
| not covered locally (Slurm/PBS docs, reason codes) | `references/resources.md` |

## Hard guardrails

- **Move files only via the configured transfer route.** Never push file content through a terminal/tmux session — line-wrapping corrupts it silently. If using rsess for commands, scp/rsync works transparently with the same target name.
- **Open a persistent remote session before any remote work.** The `rsess` skill provides stateful commands (cwd/env/venv persist), survives connection drops, and captures output faithfully through files — immune to terminal-corruption issues. Use `rsess run` for commands, `rsess peek` to verify; never rely on one-shot `ssh host cmd`. If rsess is not available in the environment, use whatever connection method the local bootstrap specifies.
- **Read the target cluster guide before preparing any job script.** Use the local
  `~/.cluster-agents.md` when already on the cluster, or the remote user's file
  after connecting. Apply its custom instructions, scheduler, storage, software,
  and engine-specific sections before writing headers, module loads, launch
  commands, scratch paths, GPU requests, or Python/conda/uv setup.
- **Set up the remote workspace properly**: copy the engine's preflight/parser scripts to the remote workdir and run them there with a modern Python obtained via the remote guide's Python recipe (create an agent env if allowed). Do not degrade scripts to fit an old system interpreter.
- **Do not submit from structure-generation scripts.** Structure-modeler code that deletes atoms,
  adds adsorbates/fragments, substitutes atoms, or otherwise mutates geometry must stop
  before `submit.sh`/scheduler creation. Engine/HPC submission starts only from an
  engine-runner task after accepted structure gates and `check_pre_submit.py`.
- **Approval breakpoint** before expensive batch submissions unless this batch was already approved.
- **Ownership breakpoint** before expensive batch submissions when `.research/` is in
  use: the execution task must be claimed and its owner directory protected by an active
  lease.
- Never resubmit blindly: diagnose → change one thing → resubmit → record what changed.
- Long jobs go through the scheduler; detached `tmux`/`nohup` only where no scheduler exists (record PID + log path).
- Record job ID, command, script path, workdir, and lease ID immediately after
  submission (into `.research/events.jsonl` and `workflow.md` when they exist).
- No deleting/overwriting outside the job's own working directory; no secrets or licensed file contents in logs; SSH targets must be explicitly approved.
- Cluster facts learned the hard way (partitions, cores/node, launcher) get recorded in the remote `~/.cluster-agents.md`; connection facts in the local bootstrap. Never in repo files.
