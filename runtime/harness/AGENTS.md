# Harness startup contract

This file is the small, workspace-scoped contract copied into new session
workspaces. It complements the project root `AGENTS.md`; it is not a second
workflow engine.

## Default behavior

- Start with the `fast` route unless the request involves scientific evidence,
  external computation, experiments, or a runtime/model policy change.
- Keep every user-visible natural-language response in the language of the
  user's latest request, using the locale supplied by the host when present.
  English skill files, tool descriptions, command names, filenames, and source
  material never override that language. For materials workflows, preserve the
  same locale in `response_language` for the workflow and all delegated tasks;
  never accept the schema's English default when the user requested another
  language.
- `planner` classifies the request and chooses the minimum required module. It
  may answer directly; delegation is an optimization, not a gate.
- Use at most one compact synthesis for a standard task. Do not run a reviewer
  on routine edits or read-only exploration.
- Treat the process current directory as the active conversation workspace and
  the only filesystem boundary. Resolve relative output paths from it. Do not
  `cd` to an ancestor repository or write conversation artifacts there.

## Modules

| Module | Scope | Typical triggers |
| --- | --- | --- |
| `planner` | route, budget, final synthesis | every non-trivial task |
| `materials` | MatterGen, MatterSim, UMA, structures | candidate discovery and screening |
| `literature` | search, extraction, evidence links | literature or mechanism claims |
| `compute` | VASP/DFT and remote plans | high-cost computational work |
| `experiment` | synthesis and electrochemical protocol | laboratory decisions |
| `reviewer` | independent targeted check | high-risk or explicit review |

## Route gates

- `fast`: no subagent, no reviewer, no DAG.
- `standard`: only named modules, bounded batch/concurrency, one synthesis.
- `high-risk`: scope/cost audit, provenance, explicit human approval, and
  targeted review before submission or external claims.

If a task becomes riskier, promote it and explain the new gate. Never activate
the complete role catalog by default.

## Experience loop

Record a concise lesson with evidence and outcome after a meaningful run.
Lessons are append-only and can be proposed as rules only after benchmark or
replay evidence plus reviewer/human approval. No automatic self-editing of
`AGENTS.md`, tool policy, model selection, or permissions is allowed.

## Materials preflight

For materials tasks, inspect `materials/runtime.json` and write the current
machine-specific result to `.openscience/materials-runtime.status.json` when a
preflight is requested. Report `configured`, `discovered`, `ready`, and
`missing` separately. A checkpoint file alone never proves that its Python
environment or gated weights are usable.

All generated inputs, scripts, manifests, and structures must stay inside the
active session workspace. Never write a result to a repository root, sibling
session, or other remembered path merely because it appeared in prior context.

MatterGen standardization means a controlled bulk supercell near the declared
atom target (40 by default) and, when a surface is requested, an explicit
Miller-index slab with an exact real atomic-plane count along `cross(a,b)`, a
total vacuum gap, and a comparable in-plane atom window (96 atoms by default).
Require both lateral vectors to be at least 12 A, `c/min(a,b) <= 4`, and slab
thickness no greater than 20 A. Use `standardize_mattergen_structure` or the
standardization artifacts recorded by the MatterGen runner. Sorting sites,
reducing the formula, changing
symmetry notation, or rewriting the same-size CIF/POSCAR is not
standardization. MatterSim must receive the manifest-registered `bulk.cif` or
`surface.cif`, never the raw MatterGen CIF or an ad hoc renamed copy.

UMA adsorption screening must call `run_uma_adsorption_energy_screen`. It fixes
the bottom three real slab planes by default and relaxes the slab, isolated
adsorbate, and adsorbed slab before evaluating any energy. Reject `relax=false`;
if any relaxation is not converged, keep the result on hold without energy
fields. Never replace this gate with an ad hoc direct single-point UMA script.

### Windows and WSL2 environment truth

On this machine, the native app-managed MatterGen venv may exist but be empty.
Do not conclude that PyTorch or MatterGen is absent from the machine until the
registered WSL2 runtime has been checked. The verified WSL interpreter is:

`/root/mattergen/venv/bin/python`

Use this read-only preflight from Windows before proposing installation:

```powershell
wsl.exe --exec /root/mattergen/venv/bin/python -c "import torch, mattergen; print(torch.__version__); print(mattergen.__file__)"
```

The verified baseline is PyTorch `2.2.1+cu118` and MatterGen `1.0.3`. The
default `chemical_system` checkpoint is available on the Windows side under
`C:\Users\泰\Desktop\NebulaMat\mattergen\models\chemical_system` and is
accessible from WSL through `/mnt/c/Users/泰/Desktop/NebulaMat/mattergen/models`.
The desktop environment detector labels these results `WSL2`; do not describe
the empty native venv as proof that the WSL runtime or checkpoint is missing.
