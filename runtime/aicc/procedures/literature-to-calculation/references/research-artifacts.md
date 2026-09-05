# Research Artifact Seeds

> Load this when: a document-derived calculation should be recorded in `.research/` rather than only summarized in chat.

## Purpose

The literature extraction step should produce durable seed evidence for downstream planning. These artifacts do not prove the calculation is correct; they preserve what the source documents support, what was assumed, and what computation would answer the claim.

Keep source excerpts short. Prefer page/figure/table provenance plus paraphrase over copying long passages. Do not place copyrighted article text, private reviewer files, secrets, or licensed data into `.research/`.

## Recommended Files

Use project-root-relative paths such as:

```text
work/literature/source-evidence-map.md
work/literature/method-fingerprint.md
work/literature/model-observable-decision.md
work/literature/triage-plan.md
```

Register each file in `.research/artifacts.jsonl` after it exists.

## Artifact Contents

### `source-evidence-map`

Record the evidence location for each extracted fact. Required sections:

```markdown
# Source Evidence Map

- source_id: paper-1
- document: <title / DOI / filename>
- extraction_scope: <whole paper / SI tables / figure X / reviewer comment Y>

## Evidence Items
| id | source location | extracted fact | status | downstream use |
|---|---|---|---|---|
| E001 | p. 4 Fig. 2 caption | catalyst model is ... | verified | model choice |
| E002 | SI Table S3 | cutoff = ... | verified | method fingerprint |
| E003 | Methods p. 9 | U value not reported | missing | assumption/approval |
```

Use `status` values such as `verified`, `missing`, `ambiguous`, `assumed-from-related-work`, or `not-applicable`.

### `method-fingerprint`

Record comparable computational settings. Required sections:

```markdown
# Method Fingerprint

- origin: manuscript-derived | source-paper-derived | related-literature-derived | designed | mixed
- reproduction_mode: reproduction | exploration

## Verified Settings
| setting | value | source evidence | notes |
|---|---|---|---|

## Assumed Settings
| setting | chosen value | rationale | needs approval |
|---|---|---|---|

## Comparison Contract
- quantities compared must share: <functional, cutoff/basis, k-density, U, dispersion, force field, corrections>
- energy/free-energy convention: <E, E+ZPE, G, CHE, etc.>
- limitations: <visible downstream limitations>
```

### `model-observable-decision`

Record why the proposed calculation answers the source claim. Required sections:

```markdown
# Model Observable Decision

- source_claim: <short paraphrase>
- model_origin: original | reconstructed | designed | exploratory
- model_system: <composition, phase, surface, adsorbates, environment>
- observable: <energy, free energy, barrier, charge/bonding, spectrum, MD property, etc.>
- success_criterion: <falsifiable criterion with units where possible>
- comparison_target: <paper value/trend/experiment/reviewer threshold>

## Rationale
<Why this observable discriminates the claim. For charge/bonding, prefer multiple observables; for electrocatalysis, prefer CHE/free-energy step diagrams over bare adsorption energy when relevant.>

## Known Limitations
- <missing source input, assumed method, surrogate model, finite-size caveat>
```

### `triage-plan`

Record the computation route and dependencies. Required sections:

```markdown
# Triage Plan

- downstream_route: comp-chem-workflow -> structure-prep -> vasp -> hpc-submit -> parser/result gate
- reproduction_or_exploration: reproduction | exploration
- priority: high | medium | low
- estimated_cost: <rough CPU/GPU walltime or qualitative estimate>

## Tasks
| task | skill | input artifacts | expected output | approval needed |
|---|---|---|---|---|

## Missing Inputs / Decisions
| item | consequence | proposed resolution |
|---|---|---|

## Reuse Candidates
| artifact or run | fingerprint requirement | reuse condition |
|---|---|---|
```

## JSONL Registry Examples

Use stable IDs. `created_at` should be the current ISO 8601 time for the project.

```jsonl
{"artifact_id":"source-evidence-map","type":"source-evidence-map","path":"work/literature/source-evidence-map.md","produced_by":"T_LIT","status":"accepted","created_at":"2026-06-28T00:00:00+08:00","provenance":["paper.pdf","si.pdf"],"summary":"Document locations and extracted facts for the target calculation."}
{"artifact_id":"method-fingerprint","type":"method-fingerprint","path":"work/literature/method-fingerprint.md","produced_by":"T_LIT","status":"accepted","created_at":"2026-06-28T00:00:00+08:00","provenance":["source-evidence-map"],"summary":"Verified and assumed computational settings for comparable downstream calculations."}
{"artifact_id":"model-observable-decision","type":"model-observable-decision","path":"work/literature/model-observable-decision.md","produced_by":"T_LIT","status":"accepted","created_at":"2026-06-28T00:00:00+08:00","provenance":["source-evidence-map","method-fingerprint"],"summary":"Chosen model and observable with success criterion for the source claim."}
{"artifact_id":"triage-plan","type":"triage-plan","path":"work/literature/triage-plan.md","produced_by":"T_LIT","status":"accepted","created_at":"2026-06-28T00:00:00+08:00","provenance":["source-evidence-map","method-fingerprint","model-observable-decision"],"summary":"Downstream task route, missing inputs, approvals, and reuse candidates."}
```

If the extraction is not yet reliable, register artifacts as `draft` or `validated` rather than `accepted`; downstream execution tasks should not consume them as accepted evidence until reviewed or approved.

## Task Seed Pattern

A document-extraction task can be represented as:

```yaml
schema_version: 1
id: T_LIT
title: Extract source paper into calculation seeds
role: literature-method
role_contract: __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/references/roles.md#literature-method
skill: literature-to-calculation
status: approved
depends_on: []
approval: none
inputs:
  - path: inputs/paper.pdf
outputs_expected:
  - artifact_id: source-evidence-map
    type: source-evidence-map
    path: work/literature/source-evidence-map.md
  - artifact_id: method-fingerprint
    type: method-fingerprint
    path: work/literature/method-fingerprint.md
  - artifact_id: model-observable-decision
    type: model-observable-decision
    path: work/literature/model-observable-decision.md
  - artifact_id: triage-plan
    type: triage-plan
    path: work/literature/triage-plan.md
success_criteria:
  - source locations are recorded for all method/model claims
  - verified and assumed settings are separated
  - reproduction vs exploration label is explicit
assumptions: []
provenance:
  - inputs/paper.pdf
```

Downstream `comp-chem-workflow` tasks should consume these artifacts by ID instead of relying on chat memory.
