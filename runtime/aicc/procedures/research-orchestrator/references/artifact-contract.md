# Artifact Contract

> Load this when: registering project artifacts, deciding whether a task may consume an
> artifact, or checking if a result can enter a report.

`artifacts.jsonl` is one JSON object per line. It is a registry, not a data store. Large
files stay where they are; the registry records identity, provenance, and status.

## Minimal Artifact

```json
{"artifact_id":"method-fingerprint","type":"method-fingerprint","path":"work/method-fingerprint.md","produced_by":"T001","status":"accepted","created_at":"2026-06-25T00:00:00+08:00","provenance":["inputs/manuscript.pdf","inputs/si.pdf"]}
```

## Fields

Required:

| Field | Meaning |
|---|---|
| `artifact_id` | Stable ID referenced by tasks. |
| `type` | Artifact type, e.g. `structure-set`, `parser-result`, `scientific-claim`. |
| `path` | Project-root-relative path to the artifact. The project root is the parent of `.research`; if `.research` is `work/.research`, use `reviews/...`, not `work/reviews/...`. |
| `produced_by` | Task ID that produced it, or `external` for pre-existing input. |
| `status` | Artifact status. |
| `created_at` | ISO 8601 timestamp. |
| `provenance` | Source files, commands, job IDs, parser outputs, or task IDs. |

Recommended:

- `logical_name`: stable human concept, useful when versions supersede each other.
- `version`: small integer or string.
- `supersedes`: prior artifact ID.
- `content_hash`: hash for immutable files or bundles when available.
- `summary`: human-readable summary.
- `units`: required for numeric results.
- `knowledge_used`: `__NEBULAMAT_AICC_ROOT__/knowledge/` files consulted for the artifact.
- `validated_by`: checker/parser artifact or command.
- `accepted_by`: decision ID, critic task ID, or user approval.
- `lease_id`: execution lease that owned generation, for expensive or stateful runs.
- `job_id`: scheduler or local job identifier when applicable.
- `resolves_follow_up`: `follow-up-proposal` artifact ID(s) resolved by this accepted
  artifact.
- `blocks_report`: for `follow-up-proposal`; defaults to blocking final report when
  the proposal status is `validated` or `accepted`.
- `resolution_status`: for `follow-up-proposal`; values such as `resolved`, `waived`,
  `limited`, or `closed` mark the proposal no longer report-blocking when backed by
  provenance.
- `recommended_tasks`: structured next-wave task specs for
  `scaffold_follow_up_tasks.py`.

## Status Values

```text
draft
validated
accepted
rejected
superseded
```

Default downstream rule: task inputs require `accepted` artifacts unless the input
explicitly states `min_status: validated`.

## Common Artifact Types

```text
ingestion-object
source-evidence-map
method-fingerprint
model-observable-decision
surface-literature-review
model-structure-review
gate-verdict
triage-plan
structure-set
structure-audit-report
engine-input-set
cluster-guide-read
job-record
parser-result
validation-report
subagent-finding
literature-method-review
structure-review-note
critic-report
result-review-note
synthesis-note
handoff-note
follow-up-proposal
scientific-claim
figure
report-manifest
docx-report
```

## Release Gates

Some artifact types should not be accepted without named release gates:

- `source-evidence-map` — document-derived extraction provenance: source IDs,
  page/figure/table/section locations, extracted facts, missing facts, and downstream
  uses. Keep excerpts short; use paraphrase and source locations instead of copying
  long text.
- `method-fingerprint` / `model-observable-decision` / `triage-plan` — initial
  literature-derived planning evidence. Separate verified settings from assumptions,
  label reproduction vs exploration, and make the observable/success criterion
  falsifiable before downstream execution consumes them.
- `surface-literature-review` — facet/termination/coverage precedent, citation or
  exploratory label, search scope when no direct precedent exists, and explicit
  recommendation. Lack of direct precedent for niche systems is not a failure by itself
  if the model is labeled exploratory.
- `structure-set` — `structure-prep` validation, provenance, and when surface or
  adsorption modeling matters, `model-structure-review`.
- `structure-audit-report` / `model-structure-review` — read-only critic review of
  Miller index/termination precedent, lateral dimensions, vacuum lower/upper bounds,
  computational economy, fixed layers, closest contacts with covalent-radius
  thresholds/margins, adsorbate-surface distances, and periodic-image separation.
  Vacuum economy is explicit: large cells or models with vacuum in multiple directions
  should not carry 15-25 Å vacuum automatically when about 10 Å is enough for the
  observable and electrostatics. When a reduced-vacuum threshold is used, record the
  audit command/threshold override and rationale so the gate evidence explains why the
  default lower-bound check was changed.
  The registered human-facing report should be compact and cite the full audit JSON or
  detailed file by path; do not duplicate full closest-pair dumps or per-atom listings
  in `artifacts.jsonl`, gate evidence, chat, or stage synthesis.
- `gate-verdict` — machine-readable YAML verdict for `plan_gate`, `structure_gate`,
  `result_gate`, or `report_gate`; downstream hooks require a passing or validly waived
  verdict before execution, claim acceptance, or report generation.
- `engine-input-set` — engine setup references used, method/input fingerprint, exact
  generated input paths, k-policy, cutoff/precision/smearing/spin policy, executable,
  performance layout such as VASP CPU default `NPAR=4`, optional `KPAR`, or an
  explicit GPU/site-default rationale with no default `NPAR/NCORE`, engine preflight
  command/status, and smoke-test policy where applicable.
- `cluster-guide-read` — short pre-submit evidence that the executing agent read
  the target `~/.cluster-agents.md` before preparing or submitting a batch job.
  Record the target host/context, guide path, read timestamp, `guide_size_bytes`,
  and site settings used for the task, but do not copy private cluster guide contents
  into the artifact. This artifact is produced by the execution owner that will prepare
  or submit the job, by a dedicated pre-submit/bootstrap task, or by `external` evidence
  when the read was performed before `.research/` state existed; in every case the
  engine/HPC task must list the accepted artifact in `inputs`. When the guide path is
  local to the executing agent, the pre-submit hook checks that the recorded size
  matches the current guide file. Remote guide reads may use `target_context: remote ...`
  or `guide_path: remote:~/.cluster-agents.md` and should record the remote `stat` size
  or hash output; the hook treats that as process evidence and cannot independently
  re-stat the remote file unless it is running in that remote context.
- `subagent-finding` / `literature-method-review` / `structure-review-note` /
  `critic-report` / `result-review-note` / `synthesis-note` / `handoff-note` /
  `follow-up-proposal` — durable records of cognitive subagent findings under
  `work/agents/`. They preserve conclusions, evidence, uncertainties, and recommended
  next tasks. Narrative notes may support gates, but machine-readable `gate-verdict`
  artifacts are still required for hook-enforced release points. See
  `references/subagent-artifacts.md`.
- `follow-up-proposal` artifacts with `status: validated` or `accepted` block final
  report generation by default. They are resolved by accepted artifacts or tasks that
  declare `resolves_follow_up`, by a recorded waiver/limitation decision, by an inline
  `resolution_status`, or by superseding/rejecting the proposal. Merely creating a
  follow-up task does not resolve the proposal; the follow-up evidence must be accepted
  or explicitly waived/limited.
- `parser-result` — engine parser command and exit status.
- `scientific-claim` — critic or user acceptance against the pre-registered criterion.
- `figure` — visualization evidence gate for source, view, projection, parameters, and
  nonblank/visual inspection. Final-report VASP volumetric figures must record the
  routing refs and provenance, not only the rendered image path. If the figure uses
  `CHGCAR`, `CHGDIFF`, `PARCHG`, `ELFCAR`, spin density, Delta rho / charge-density
  difference, wavefunction/WAVECAR-derived grids, or another CHGCAR-like VASP source,
  the figure artifact, consumed report manifest, or sidecar must name
  `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/volumetric-visualization.md`. Charge-density-difference
  figures must also name
  `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/electronic-analysis.md`.
- `docx-report` — report readiness checklist.

Gate verdict artifacts should usually be `status: accepted` before a downstream task
consumes them. A `validated` gate file can be read by a critic or orchestrator while it
is being decided, but it should not unlock engine submission, claim acceptance, or
report generation.

For structure handoff, `structure-modeler` may register structure sets and deterministic
validation or geometry-summary output, but it cannot register `structure-audit-report`,
`model-structure-review`, or `gate-verdict` artifacts. The generic pre-submit hook
requires an accepted machine-readable `structure_gate` verdict; engine/HPC tasks should
also consume the accepted structure artifacts they actually use. Separate
`surface-literature-review` and `structure-audit-report` artifacts are useful when the
work is complex, but they are not universal pre-submit requirements.

## Safety

- Do not register secrets, tokens, passwords, full POTCAR contents, or licensed
  force-field/potential contents.
- Do not copy bulky binaries into JSONL. Record path, identity, size/hash when useful,
  and provenance.
- Do not report a numeric artifact without units and file provenance.
