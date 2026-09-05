# Cluster Operating Guide Template (remote `~/.cluster-agents.md`)

> Load this when: writing or updating a cluster's operating guide (the remote `~/.cluster-agents.md`) — this is the template to copy and fill.

> Copy this file to **`~/.cluster-agents.md` in your home directory on the cluster** — the operating guide the agent reads after logging in (tier 3 of the discovery model in `__NEBULAMAT_AICC_ROOT__/AGENTS.md` "Site environment"). Authoring it on the cluster means later sessions and teammates inherit it. Fill only facts confirmed by the user, local docs, or direct probing.
>
> This guide is read by the agent, not parsed by code, so prose, lists, and pasted command blocks are all fair game. The headings below are a checklist, not a rigid schema: drop sections that don't apply, and add your own. An empty field means "ask the user before relying on it."
>
> **Not here:** how to *reach* this machine (login command, ssh alias/port, file-transfer pattern). Those are the local bootstrap — you already used them to get here, and they must live on the operator's machine, not on the cluster. Keep this guide to what's true *once you are logged in*.

## Identity

- Cluster name:
- When to use this cluster:
- Login node policy:
- Do not use for:

## Custom Instructions

> Free-text. Anything specific to this machine the agent must follow that doesn't fit a field below — group etiquette, billing rules, "always do X before Y", quirks worth a sentence. Write as much or as little as you like.

## Scheduler

- Scheduler: `slurm` / `pbs` / `none`
- Default queue/partition:
- Available queues/partitions:
  - name:
    nodes/cores:
    memory:
    walltime:
    GPU:
    account/QOS:
    notes:
- Submit command:
- Queue/status command:
- Cancel command:
- Accounting/history command:
- Max unattended jobs:

## Storage

- Home path:
- Scratch/work path:
- Project/group path:
- Temporary directory policy:
- Quota command:
- Large files to avoid copying:

## Software Environment

- Shell initialization needed:
- Module command availability:
- Conda/mamba/uv/Python recipe:
- Agent may create environments: yes/no
- Package index / channel mirror (region-specific): e.g. `UV_DEFAULT_INDEX` for a PyPI mirror, or `.condarc` channels for a conda-forge mirror — fill the actual URLs your site uses (kept here, never in the repo)
- Provider for helper-script deps (pymatgen/rdkit/ovito/…): default `uv run` (point at a PyPI mirror if needed); fall back to a prepared conda/mamba env (conda-forge mirror) — notably for ovito (conda-blessed, its own channel) or when uv/PyPI is blocked
- Proxy/offline package install constraints:

## Computational Codes

### VASP

- Module/load command:
- CPU binary:
- GPU binary:
- Recommended launcher:
- POTCAR library path:
- Site-tested parallel layout (cores/node, NCORE/KPAR or GPU rank model — performance only, not method):

### Gaussian

- Module/load command:
- Binary:
- Scratch variable/path:
- Launcher/job script convention:

### LAMMPS

- Module/load command:
- Binary:
- Recommended launcher:

### DeePMD-kit / DPMD

- Module/load command or conda/uv environment:
- `dp` binary:
- CPU/GPU training launcher:
- Recommended GPU partition/count:
- Scratch/checkpoint/restart policy:
- LAMMPS-DeePMD module or binary, if separate:

### GROMACS

- Module/load command:
- Binary (`gmx`, `gmx_mpi`, or site wrapper):
- Recommended launcher:
- CPU/GPU/PME/OpenMP policy:
- Checkpoint/restart policy:

### Analysis Tools

- VASPKIT:
- Bader:
- VTST scripts:
- Phonopy:
- OVITO:
- Other:

## Job Script Patterns

### CPU job

```bash
# Paste the site-tested minimal CPU job header and launch command here.
```

### GPU job

```bash
# Paste the site-tested minimal GPU job header and launch command here.
```

### Array job

```bash
# Paste the site-tested array-job pattern here, if available.
```

## Validation Commands

- Check queues/nodes:
- Check modules:
- Test job without submitting:
- Confirm compute-node environment:
- Check quota:

## Known Problems

- Common pending reasons:
- Module/MPI conflicts:
- Filesystem or scratch pitfalls:
- Queue habits:
- Recovery procedure:

## Update Rules For Agents

- Before preparing any job script for any code, read this whole file and the
  relevant engine section; do not treat this as a VASP-only guide.
- Before using this cluster, read this whole file and the relevant engine skill.
- If a required fact is blank, ask the user before connecting, transferring, or submitting.
- Record stable newly discovered facts here after verification, so the user is never asked twice.
- Put secrets, tokens, passwords, and licensed file contents nowhere.
