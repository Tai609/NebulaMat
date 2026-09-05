# Workflow state files and validation ladder

> Load this when: creating or updating a project state record (`.research/` and
> `workflow.md`), or deciding whether a result is real (the validation ladder).

## `.research/` — structured project state

For multi-stage, HPC, resumable, or handoff-heavy projects, create a `.research/`
directory using `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/`:

```text
.research/
  project.yaml
  tasks/
    T001.yaml
    T002.yaml
  leases/
    T002.json
  artifacts.jsonl
  decisions.jsonl
  events.jsonl
```

This is the source of truth for dependencies, artifact status, approvals, and events.
Use:

```bash
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/validate_state.py .research
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/ready_tasks.py .research
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/run_required_checks.py .research T002
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/claim_task.py .research T002 --owner <owner-id>
```

`workflow.md` remains a human-readable summary for scanning.

## `workflow.md` — the human-readable save-game

A real calculation is several steps (relax bulk → build slab → relax slab → add
adsorbate → energetics). `workflow.md` lists those steps and tracks which are done, so
a later session — or you tomorrow — can read it quickly. Create it beside `.research/`
for any task with more than one stage, HPC execution, or a chance of being resumed.
Keep it small and reconcile it from the structured state.

```markdown
# workflow: CO adsorption energy on Pt(111), PBE-D3
- entry: new-computation   # existing-inputs | existing-outputs | literature-derived | resume
- success criteria: all relaxations |F| < 0.02 eV/A ; E_ads with reference-state defined
- assumptions: 4-layer slab, bottom 2 fixed; no ZPE

## Reusable assets   # never recompute what already exists on-contract
| asset | where | fingerprint/settings |
| relaxed bulk | runs/bulk/ | PBE-D3 v1 |

## Stages / tasks
| id | skill | workdir | status | evidence |
| bulk-relax    | vasp | runs/bulk    | accepted  | job 8841230; parser ok; critic ok |
| slab-relax    | vasp | runs/slab    | running   | job 8841234 |
| co-slab-relax | vasp | runs/co-slab | proposed  | |
| energetics    | vasp | —            | proposed  | analysis belongs to the engine that made the outputs |
```

Before planning a new stage, check the **Reusable assets** table — if the asset exists
and was built under the same fingerprint/settings, reuse its path instead of recomputing.

## Task status

Structured task status lives in `.research/tasks/*.yaml`:

`proposed → approved → running → completed → validated → accepted`, plus `blocked`,
`failed`, and `cancelled`. `ready` is derived by `ready_tasks.py`; do not persist it.
For older `workflow.md` files, map `planned` to `proposed` and `done` to `completed`
when creating `.research/`.

Three distinctions carry weight:

- `completed` means the producer says files exist.
- `validated` means the engine parser/checker or release gate passed.
- `accepted` means a critic/orchestrator or user confirmed that the artifact answers the pre-registered objective and may feed formal downstream work. Only accepted artifacts may enter a report by default.

Acceptance is claim-level, not project completion. After each coherent calculation
wave, create an evidence packet and a result-critic task. If the critic returns
`needs-follow-up` or `inconclusive`, add new proposed tasks for the missing
calculation, validation, or post-processing step and keep the project open. A
stage report can summarize validated evidence, but it is not a final report and must
list the open follow-up tasks or waivers.

Execute **one stage at a time** unless independent tasks have explicit owner directories,
active leases, and no shared mutable outputs. Expensive HPC execution is single-owner by
default: multi-agent for cognition, single-owner for execution. A stale lease is a
recovery signal; reconcile scheduler state, files, logs, parser outputs, and events
before rerunning or resubmitting.

## Validation ladder

Engine skills parse their own outputs (each carries a parser script that exits non-zero
on failure). This skill owns the cross-engine discipline: report every result at its
rung, and never conflate rungs.

1. **Files exist** — the run produced its expected artifacts.
2. **Terminated normally** — or the failure reason is identified (engine skill's `references/errors.md`).
3. **Technically converged** — SCF/optimization criteria met; MD equilibrated and stable. (For a weakly-bound/floppy adsorbate, a residual soft-mode force at a genuinely stationary energy may be accepted *only* under the narrow, disclosed exception in `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/validation.md` — never as a silent pass, and never when the energy is still descending.)
4. **Scientifically valid** — right reference states, aligned settings across compared values, corrections accounted for, magnitude sane against expectation, **and the relaxed structure still is the intended model** (bonding topology survived relaxation: adsorbates where placed, no silent H transfer/dissociation/reconstruction — a run can converge cleanly into a different chemical species than the one the stage claims to model).

Rung 3 without rung 4 is "a converged number", not a result. A validated result without
acceptance is not yet reportable; it still needs a check against the pre-registered
objective, model, observable, and margin.

**Comparison rule:** values compared across runs must share functional, cutoff/basis,
k-density, U, dispersion, and convergence criteria — verified in the actual input files,
not from memory of what was intended. State the energy type (electronic E, E+ZPE, H, G)
and unit on every value, with file provenance.

## Advisory, not blocking

These rungs and the fingerprint comparison are **checks that surface facts** — the agent
(or the user) decides what to do. A deviation or an unmet rung is *reported and disclosed*,
not silently auto-corrected and not a hard gate on the agent's judgment. The one place the
workflow genuinely stops is a *scientific* outcome — a result that **contradicts** a claim —
which routes to the authors as a decision, not as a script blocking the agent.

This advisory rule does not weaken explicit release hooks. `check_pre_submit.py`,
`check_pre_accept_claim.py`, and `check_pre_report.py` are hard gates only at their
matching release points: HPC submission, claim acceptance, and final report generation.
They do not block upstream planning or model-building work whose purpose is to create
the missing evidence.
