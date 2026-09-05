# Role Contracts

> Load this when: assigning `role`, `role_contract`, `can_read`, `can_write`, or
> `cannot` in task YAML; deciding whether work should be split across cognitive
> passes; or reviewing whether an execution task is safe to run.

## Table of Contents

- [Principles](#principles)
- [Role Table](#role-table)
- [Core Roles](#core-roles)
- [Tool-Bound Roles](#tool-bound-roles)
- [Structure Model Review Roles](#structure-model-review-roles)
- [Single-Owner Execution](#single-owner-execution)

## Principles

Role contracts restrict authority; they do not replace the named skill's instructions.
Every task still loads its `skill`, `required_refs`, and relevant `knowledge_required`
before doing scientific or operational work.

Use multiple agents or passes for cognition: literature extraction, model choice,
observable design, criticism, and report review. Use one owner for expensive execution:
input finalization, HPC submission, queue monitoring, recovery, and parser-driven
acceptance.

Keep first submission and post-result review separate. Before the first HPC handoff,
the critical path is plan/model choice, structure review where relevant, engine
preflight, approval, and single-owner execution. `scientific-critic`,
`synthesis-report`, `result_gate`, `report_gate`, and stage synthesis consume results
and belong after at least one calculation wave has parser or analysis evidence.

Read-only cognitive subagents use a default wait of 300 seconds. A 60-second wait is
only a soft status checkpoint: record that the reviewer is still pending and keep
waiting. Close a slow reviewer only at the 600-second hard timeout, then append a
`multi-agent-timeout` event with the role, requested scope, waited seconds, and any
partial output. Timeout/no-response evidence is `inconclusive`, not a gate block by
itself.

## Role Table

| Role | Owns | Typical outputs | Must not do |
|---|---|---|---|
| `research-orchestrator` | Project DAG, approvals, acceptance boundaries, reconciliation | `workflow-state`, `task-plan`, `decision-record`, `validation-report` | Invent scientific parameters or submit jobs |
| `literature-method` | Source extraction, method fingerprinting, model/observable proposals | `ingestion-object`, `method-fingerprint`, `model-observable-decision`, `triage-plan` | Treat exploratory literature-derived models as reproduction |
| `surface-literature-reviewer` | Surface/model precedent: Miller index, termination, slab size, coverage, adsorption motifs | `surface-literature-review`, `model-structure-review`, `gate-verdict`, `validation-report`, `follow-up-proposal` | Generate structures, edit coordinates, or submit jobs |
| `structure-modeler` | Structures, slabs, adsorbates, conformers, validation packs | `initial-structure-decision`, `structure-set`, `validation-report`, `follow-up-proposal` | Write `structure-audit-report`/`model-structure-review`/`gate-verdict`, write scheduler submit scripts, write final engine inputs before gate acceptance, approve its own structures, or submit production engine jobs |
| `structure-critic` | Read-only review of candidate slabs, adsorbates, clusters, periodic images, and geometry gates | `structure-audit-report`, `model-structure-review`, `gate-verdict`, `validation-report`, `follow-up-proposal` | Edit structures, choose silently among scientific models, or submit jobs |
| `engine-runner` | Deterministic input generation, preflight, single-owner execution, parsing | `engine-input-set`, `job-record`, `parser-result`, `validation-report` | Run competing expensive submissions for the same objective |
| `scientific-critic` | Evidence review, falsification, claim classification | `critic-report`, `scientific-claim`, `validation-report`, `follow-up-proposal` | Edit upstream evidence or promote unaccepted claims to final report |
| `synthesis-report` | Human-facing synthesis, figures, report packages | `report-manifest`, `figure`, `docx-report`, `calculation-directory-index` | Report non-accepted claims as conclusions |

## Core Roles

### `research-orchestrator`

- Keep `.research/` coherent with files on disk, scheduler state, and parser output.
- Decide task readiness from artifacts, approvals, and event logs.
- Accept or reject artifacts only from evidence, not from producer confidence.
- Record unresolved disagreements as decisions or blocked tasks.

### `literature-method`

- Extract claims, computational methods, structures, observables, and missing details
  from source documents.
- Produce method fingerprints and model-observable decisions with assumptions labeled.
- Consult `__NEBULAMAT_AICC_ROOT__/knowledge/` when choosing scientific observables, but keep literature-derived
  models exploratory unless original structures and full methods are available.

### `scientific-critic`

- Consume an evidence packet, attempt to falsify the planned claim, and classify the
  outcome as `addresses`, `contradicts`, `inconclusive`, or `needs-follow-up`.
- Check technical validation, scientific relevance, units, references, and assumptions.
- Write critic artifacts and accepted/rejected claim artifacts; do not edit producer
  outputs.
- Run after validated parser/analysis artifacts exist. Do not place this role on the
  first engine/HPC submission dependency chain.

### `synthesis-report`

- Consume accepted claims, accepted figures, and accepted calculation-directory indexes.
- Preserve limitations and contradictions visibly.
- Build report artifacts through `__NEBULAMAT_AICC_ROOT__/tools/report`; do not turn validated-only parser
  output into a final claim.
- A stage synthesis is allowed only as an interim post-result packet. It is not a
  substitute for plan, structure, or engine preflight gates and must not gate first
  submission.

## Tool-Bound Roles

`structure-modeler` and `engine-runner` are bridge roles between cognitive planning and
tool skills. They are intentionally narrow:

- `structure-modeler` prepares and validates geometry artifacts for downstream engines.
  Its initial-structure discovery is bounded to the current project root/current
  working directory and user-explicit input paths; it must not scan `$HOME`, `/home`,
  `/opt`, `/`, shared software trees, scratch roots, or unrelated archives.
  It may write candidate structures, deterministic geometry summaries, and validation reports, but it must not
  write `structure-audit-report`, `model-structure-review`, or `gate-verdict` artifacts.
  It must not write scheduler submit scripts (`submit.sh`, `sbatch`, `qsub`) or final
  engine input packs (`INCAR`, `KPOINTS`, `POTCAR`, etc.) before accepted structure
  gates. Use `scripts/check_structure_generator_boundary.py --forbid-engine-inputs`
  on structure-generation scripts when they are part of the task.
- `engine-runner` owns the approved execution path and records job IDs, logs, parser
  outputs, and recovery decisions.

## Structure Model Review Roles

Surface and adsorption model building uses multiple cognitive passes before any engine
input or HPC submission:

### `surface-literature-reviewer`

- Check whether the chosen Miller index, exposed facet, termination, slab thickness,
  lateral cell, coverage, model-size economy, and adsorption motif are common or
  defensible for the material and experimental condition. If the chosen Miller index
  differs from common precedent, require a question-specific rationale or an
  exploratory label.
- Check whether slab top/bottom symmetry is chemically appropriate rather than
  mandatory, and whether any asymmetric slab records top/bottom terminations,
  polarity/dipole risk, and electrostatic-correction needs.
- Check whether stoichiometry and charge balance match the declared chemical
  environment, separating effectively fixed-valence/non-redox-active systems from
  redox-active or variable-valence systems.
- Record citations, database IDs, source excerpts, or a clear "not found / exploratory"
  label. Do not convert weak precedent into a production-quality assumption.
- If the material or structural modification is too niche for direct precedent, record
  the search scope and mark `exploratory/no-precedent-found`; absence of precedent alone
  is not a reason to block the model or force comparison to unrelated literature.
- Produce a `surface-literature-review` artifact with `approve`, `request_revision`, or
  `block` recommendations for the structure modeler.

### `structure-critic`

- Consume candidate structures and the surface-literature review, then perform a
  read-only audit of slab dimensions, vacuum lower/upper bounds, computational economy,
  fixed layers, slab symmetry/asymmetry rationale, stoichiometry/charge-balance
  consistency, polarity/termination risks, closest contacts with element-pair
  covalent-radius thresholds/margins, adsorbate-surface distances, and
  periodic-image separation.
- Use `__NEBULAMAT_AICC_ROOT__/tools/structure-prep/references/validation.md` and deterministic geometry
  summaries where possible. When a structure looks visually plausible but numerical
  distances disagree, the numerical neighbor check wins.
- Write `structure-audit-report`, `model-structure-review`, or `gate-verdict` artifacts.
  Proposed fixes go back to a `structure-modeler` task; the critic does not edit
  coordinates.

The release boundary for downstream engine skills is the accepted structure plus an
accepted `model-structure-review` or passing/validly waived `structure_gate`. VASP,
CP2K, Gaussian, LAMMPS, or HPC tasks should consume reviewed structures, not merely
generated structures. Mixed helpers that both mutate structure and write engine inputs
collapse this boundary and should be split before execution.

## Single-Owner Execution

Set expensive execution tasks to:

```yaml
execution_policy:
  mode: single_owner
  allow_parallel_subagents: false
```

Parallel subagents may critique the plan before submission or inspect results after
parser output exists. They must not independently submit competing HPC jobs for the
same model, run directory, or objective.
