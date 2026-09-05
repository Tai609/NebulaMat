# Scheduler & Execution Troubleshooting

> Load this when: a job won't start, dies for non-scientific reasons, or queue behavior is confusing. Engine-level errors belong to the engine skill's errors.md.

| Symptom | Likely cause | Fix |
|---|---|---|
| Job `PENDING` forever | priority, partition limits, or impossible request | `squeue -j ID --start` / reason code: `Resources` = wait, `QOSMax*` = over limits, `PartitionConfig` = request impossible (e.g. more cores than nodes have) |
| `slurmstepd: oom-kill` / job killed, engine log just stops | out of memory | more nodes / `--mem` higher; engine-side: lower KPAR, NCORE per node, %mem for Gaussian |
| `TIMEOUT` | walltime exceeded | restart from checkpoints (CONTCAR→POSCAR, `read_restart`, `opt=restart`); next submission 2× walltime; record it's a continuation |
| `NODE_FAIL` / job dies at a consistent node | hardware | `sacct` for the node ID; resubmit with `--exclude=nodeXYZ`; report to admins after repeats |
| `Invalid account/partition/QOS` | wrong cluster-specific names | `sinfo`, `sacctmgr show assoc user=$USER`; record the right names in project notes |
| `command not found` on compute node, works on login | module not loaded inside the job script, or login-shell-only PATH | `module load` inside the script after `module purge`; never rely on login environment |
| Job starts then instantly exits, empty engine output | wrong workdir (`cd` failed), input missing on compute filesystem, or MPI launcher mismatch | check the `.err` file first; verify the filesystem is mounted on compute nodes; srun vs mpirun per cluster |
| CPU-only engine build submitted to a GPU partition hangs, duplicates rank output, or wastes GPUs | wrong executable/partition pairing; CPU MPI build running on GPU nodes without GPU request or with too many CPU ranks | use the site's GPU-enabled build with the engine's GPU rank model (see the engine skill's GPU reference), or move the CPU build back to a CPU partition |
| GPU job lands on the wrong GPU model or mixed nodes | untyped `--gpus=N` on a mixed GPU partition | request typed GRES such as `--gres=gpu:<type>:N` (or site equivalent) and verify placement with `sbatch --test-only` |
| GPU job hangs after startup despite valid inputs | GPU binding hides peer GPUs or rank/GPU mapping is wrong | match ranks to the engine's GPU model (usually ranks = GPUs); avoid `--gpu-bind=single:1`; use `--gpu-bind=none` when recommended by the site template |
| `Disk quota exceeded` mid-run | WAVECAR/trajectory blew the quota | clean scratch; LWAVE=.FALSE. when not needed; point dumps at scratch |
| MPI errors (`MPI_ABORT`, rank crashes) with no engine message | rank/core mismatch or mixed MPI libraries | ranks = ntasks; one MPI implementation (the module the engine was built with) |

## Recovery discipline

Diagnose → change ONE thing → resubmit → record what changed. Never resubmit a failed job unchanged "to see if it works now" (except confirmed node failures, excluded).

## Remote-session and transfer failures (terminal-wrapper sessions)

| Symptom | Likely cause | Fix |
|---|---|---|
| File pushed via heredoc/paste through a tmux/screen session arrives corrupted (wrapped lines, stray escape sequences) | the terminal layer re-wraps and echoes long lines | never transfer file content through a terminal session; use the file-transfer route from the local bootstrap (scp/rsync); verify with `cksum` on both ends when it matters |
| Command output comes back empty/partial through a session wrapper, but the command ran | capture race in the wrapper layer; plain `ssh host cmd` output is fragile | use `rsess run` (from the `rsess` skill) — it captures output in per-command files on the remote with a `tmux wait-for` signal, immune to terminal-layer corruption and capture races; also use `rsess peek` to verify pane state |
| Repo helper script fails remotely with a SyntaxError | old system Python on the remote | do NOT edit the script down; obtain a modern Python via the cluster guide Python recipe (conda/uv/module) or create an agent env and install what is needed |
