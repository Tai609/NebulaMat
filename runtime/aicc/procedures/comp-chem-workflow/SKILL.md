---
name: comp-chem-workflow
description: Entry point and controller for computational chemistry and materials workflows. Use when the agent must design, prepare, run, monitor, resume, validate, or report multi-stage atomistic work - DFT, quantum chemistry, MD, machine-learning potentials, phonons, HPC pipelines, benchmarks, reproductions, or literature/reviewer-derived calculations.
---

# Computational Chemistry Workflow Controller

Use this skill first for any nontrivial computational task. It owns the lifecycle, the durable state record, the validation ladder, iterative scientific review loops, and the approval breakpoints; domain skills (`structure-prep`, `vasp`, `gaussian`, `gromacs`, `lammps`, `mlp`, `phonopy`, `hpc-submit`) own the engine-specific work, including parsing their own outputs.

For multi-stage, HPC, resumable, or handoff-heavy projects, durable state is the
`.research/` protocol from `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/`: task DAG, artifact
registry, decisions, and events. `workflow.md` remains a human-readable summary.

Global guardrails live in the repository `__NEBULAMAT_AICC_ROOT__/AGENTS.md` and always apply.

## 1. Classify the entry

1. **New computation from a scientific goal** — "calculate CO adsorption on Pt(111)", "compute phonons of MgO". Plan the full lifecycle below.
2. **Existing inputs or run directory** — "run this POSCAR", "check this folder", "resume this job". Inspect what exists before generating anything; route to the engine skill, then `hpc-submit`.
3. **Existing outputs** — "parse this OUTCAR", "is this converged", "plot the DOS". Go directly to the engine skill that produced them; each carries its own parser script and analysis section.
4. **Document-derived** — a third-party paper, SI, or report routes through `literature-to-calculation` to extract a concrete target and seed `.research` evidence artifacts (`source-evidence-map`, `method-fingerprint`, `model-observable-decision`, `triage-plan`) before execution planning. A manuscript-plus-peer-review package routes through `review-response`, which orchestrates this skill per reviewer comment.
5. **Resume/monitor** — jobs already submitted. Read `.research/` when present, then `workflow.md`, filesystem state, scheduler state, and parser outputs; continue from the earliest non-accepted stage/artifact. Never resubmit blindly.

## 2. Scope before computing

Before generating any input, state and confirm:

- **Objective** — the scientific quantity or decision, not the job type.
- **Proposal** — your own idea of what calculation(s) would answer the objective; reason it out. `__NEBULAMAT_AICC_ROOT__/knowledge/` is optional reference for hints, not a menu to choose from and not binding.
- **Model system** — composition, phase, surface, defects, adsorbates, charge, spin.
- **Method** — functional/level, dispersion, U, force field, reference states.
- **Code** — the executing program (VASP, QE, CP2K, …): a separate, downstream choice by availability/convention; the same proposal can be realized with different codes. Route to that tool skill once chosen.
- **Execution target** — local, SSH host, or scheduler; rough cost estimate.
- **Success criteria** — observable, checkable outcomes (converged to X, value within Y of reference).
- **Non-goals** — what is explicitly out of scope (prevents scope creep on long runs).

Missing original structures, calculation archives, or fully specified methods do **not**
by themselves block computation. They change the workflow into a designed/reconstructed
route: build candidate models from crystallographic databases, manuscript
characterization, field convention, and `structure-prep`; choose a defensible method
fingerprint from surviving evidence and related literature; label every assumption and
model origin. The block comes only if the agent tries to submit production work without
an accepted plan, accepted structure review, and disclosed designed/reconstructed method,
or if a required scientific fork still needs user approval in semi-automatic mode.

The practical default after intake is therefore: inspect supplied initial structures in
the current project root/current working directory and any user-explicit input paths;
if none are usable, self-build candidate models; then run the structure gate. Do not
run unbounded filesystem discovery over `$HOME`, `/home`, `/opt`, `/`, shared software
trees, or unrelated archives. If the operator supplied structures, they should be in
the project folder or in a path they named. Do not insert separate smoke/preflight-only
or caveated-summary milestones as default DAG tasks. Technical preflight remains a
required check inside the later engine task.

When the objective is a charge, oxidation-state, or bonding claim, fix the *observable* now, at planning time: read `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` (+ `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`). Charge partitioning alone is often a weak discriminator — plan for ≥2 observables, preferring one anchored to experiment. When the objective is an **electrocatalytic step** (OER/ORR/HER/CO₂RR/NRR), the decisive observable is usually the **CHE ΔG step diagram / limiting potential** (`__NEBULAMAT_AICC_ROOT__/knowledge/electrochemistry.md`), not a bare adsorption energy — plan to compute the diagram. And when the model is a **supported metal / surface whose oxidation state matters**, the surface *termination* sets that oxidation state: match it to the synthesis condition (`__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`), not the most stable cut.

If the task is expensive and a scientific choice is ambiguous (e.g., which termination, which functional), stop at an approval breakpoint with a recommendation.

For slab, surface, defect, adsorbate, molecule-on-surface, cluster-on-surface, or catalytic reaction pathway model
building, read `__NEBULAMAT_AICC_ROOT__/knowledge/catalytic-reaction-pathways.md` when a mechanism or path diagram is involved, then split the structure stage into a reviewed mini-DAG before engine handoff:
surface-literature review for Miller index/termination/slab-size/coverage precedent
where available, or an explicit exploratory/no-precedent-found record for niche systems,
`structure-prep` generation, then read-only structure criticism of slab dimensions,
vacuum, fixed layers, closest contacts, adsorbate-surface distances, and periodic-image
separation. Do not block solely because no direct literature analogue exists. Do not
force top/bottom slab symmetry when it would create the wrong termination,
stoichiometry, adsorbate placement, or excessive model size; instead record asymmetry,
polarity/dipole handling, and limitations. Review stoichiometry and charge balance
against the declared chemical environment, treating effectively fixed-valence systems
differently from redox-active or variable-valence systems.
Downstream engine/HPC tasks should consume accepted structures that passed the
`model-structure-review` gate.

## 3. Durable state: `.research/` + `workflow.md`

For any task with more than one stage, HPC execution, or a chance of being resumed later, create a `.research/` directory in the project run directory using `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/`. It is the source of truth for task dependencies, artifact status, approvals, and events.

Also keep a small `workflow.md` human summary: objective, success criteria, assumptions, reusable assets, current task statuses, job IDs, and next action. Reconcile the summary from `.research/`, filesystem/scheduler state, and parser outputs on resume.

Full format, stage/task statuses, and the reuse rule: `references/state-and-validation.md`. Execute **one stage at a time** unless independent tasks have explicit owner directories and leases. For any task with `execution_policy.requires_claim: true`, run `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/claim_task.py` before editing the owner directory or submitting HPC work, heartbeat while monitoring, and release the lease when execution stops. `completed` ≠ `validated` (only the engine parser/checker promotes a stage to `validated`) and `validated` ≠ `accepted` (a critic/orchestrator or user confirms it answers the objective).

## 4. Preflight before expensive execution

Before writing engine inputs, load the engine skill's setup reference and record the
input-standard choices in the engine-input-set: task type, method fingerprint, k-policy,
precision/cutoff policy, smearing, spin/U policy, executable, and performance layout
such as VASP CPU default `NPAR=4`, optional `KPAR`, or an explicit GPU/site-default
rationale with no default `NPAR/NCORE`. Do not generate INCAR/KPOINTS-style files from
memory.

Every **generated job** must pass preflight before submission — *every* one, not just the headline relaxation: statics, frequencies, NEB images, post-processing, and any script-generated input. A homegrown static or freq job that skips preflight is exactly how an NGXF=0 hang, bad k-mesh, missing VASP parallel-layout record, or an `IBRION`/`NCORE` abort reaches full walltime before anyone notices.

When `.research/` is present, preflight is not the final release gate. Run the
pre-submit hook for the engine/HPC task before submission; it blocks missing accepted
structure gates and missing `cluster-guide-read` evidence that the target
`~/.cluster-agents.md` was read. If the execution task requires a claim, claim it after
preflight and before submission:

```bash
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/check_pre_submit.py .research T004
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/claim_task.py .research T004 --owner <owner-id>
```

If a prior task is still `running`, run `reconcile_leases.py` and inspect scheduler/log
state before any resume or rerun.

- inputs exist, are mutually consistent, and pass the engine skill's validation (e.g.,
  `__NEBULAMAT_AICC_ROOT__/tools/vasp/scripts/check_inputs.py --strict-performance` for production VASP
  inputs) — run it on each generated job dir, not once for the whole campaign
- executable/module availability confirmed on the execution target
- estimated cost is sane for the resource request
- an engine-specific smoke test only when it adds information: novel executable/module/queue templates, new POTCAR/basis locations, or a new generated-input family. Treat it as an optional technical probe inside execution setup, not a scientific milestone or default DAG gate. A VASP `NELM=5` smoke test is only an environment/input-start check, not a convergence check, and should not be repeated for every near-identical generated job. For hard magnetic, +U, redox-active, metallic-slab, or adsorbate-on-oxide systems, use realistic production SCF headroom (`NELM=200-300` when needed) instead of inheriting smoke-test limits.

On a crash, warning, or non-convergence during execution, match the exact stdout/log string in the engine's `references/errors.md` *before* changing any input — one fix at a time (see the AGENTS.md reflex table). Don't reinvent a fix the engine skill already documents.

## 5. Validation ladder

Engine skills parse their own outputs (each carries a parser script that exits non-zero on failure). This skill owns the cross-engine discipline: report every result at its rung, never conflate rungs. The four validation rungs: **files exist → terminated normally → technically converged → scientifically valid** (right references, aligned settings, sane magnitude, and the relaxed structure is *still the intended model*). Rung 3 without rung 4 is "a converged number", not a result. A validated artifact enters a report only after acceptance against the pre-registered objective.

The first wave of calculations is almost never the end of a serious project. After a
coherent batch of results validates technically, assemble an evidence packet and run a
scientific-critic/review pass before promoting claims or drafting final conclusions.
That pass may return `addresses`, `contradicts`, `inconclusive`, or
`needs-follow-up`. `needs-follow-up` is not a report-writing problem: convert it into
new proposed `.research/tasks/*.yaml` nodes, route them through the relevant skills,
and repeat validation and criticism. A stage synthesis may summarize the current state,
but it must be labeled interim and list open follow-up tasks.

Before accepted artifacts are turned into a final report or response package, run the
`__NEBULAMAT_AICC_ROOT__/tools/report/references/validation.md` pre-report soft gate. It checks whether
high-temperature/free-energy corrections, DOS/PDOS, charge/work-function, or other
low-cost post-processing evidence is needed; do the analysis or record a visible
waiver/limitation before writing final claims.

Full ladder, the cross-run comparison rule, and the advisory-not-blocking principle (checks surface facts; only a `contradicts` outcome halts): `references/state-and-validation.md`.

## 6. Iteration and report release

Do not treat `plan -> compute -> report` as a linear pipeline. Use this loop:

```text
plan accepted -> execute current wave -> parser/validation -> evidence packet
  -> scientific critic/result gate -> follow-up tasks or accepted claims
  -> repeat until claims are accepted, waived, or explicitly limited
  -> final report gate -> report
```

Use `__NEBULAMAT_AICC_ROOT__/tools/report` in two modes:

- **Stage synthesis**: an interim review packet for the user/critic after a wave of
  calculations. It may include validated-but-not-accepted evidence, but it must label
  claim status and open `needs-follow-up` items. It does not close the project.
- **Final report/response package**: only after result critics, required follow-up
  tasks, waivers/limitations, and the report gate are recorded. It consumes accepted
  claims by default.

## 7. Turn summary format

End every workflow turn with:

```text
Stage: <id> (<status>)
Did: <what was actually executed/generated>
Evidence: <files, job ids, log paths>
Validation: <parser/checker verdict, command, exit status>
Acceptance: <accepted by user/critic/orchestrator, or pending>
Assumptions: <anything not user-confirmed>
Next: <next stage or the single question blocking it>
```
