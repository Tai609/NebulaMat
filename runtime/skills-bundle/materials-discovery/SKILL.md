---
name: materials-discovery
description: Discover and normalize inorganic material candidates from Materials Project, OQMD, AFLOW, and NOMAD through the local materials-mcp service.
---

# Materials discovery

Use the `materials-mcp` MCP tools as the only database boundary. Do not call
provider APIs directly from an agent and do not expose provider-specific fields
as the candidate contract.

## Workflow

1. Convert the research question into explicit constraints: elements/formula,
   composition range, structure family, band-gap or stability targets, and the
   acceptable uncertainty.
2. Call `get_material_provider_status`, then prefer `discover_materials` for an
   element set. If formulas are already known and a provider lacks element
   search, call `search_material_formulas` once for the batch. Do not write a
   per-formula network loop in an agent.
3. Let the connector enforce bounded concurrency, request/provider time budgets,
   retry, circuit breaking, idempotency, and checkpoint recovery. Use
   `resume_material_queries` only for retryable observations.
4. Normalize every hit to a `CandidateRecord` with `provider`, `material_id`,
   `formula`, `elements`, `properties`, `source_url`, and `provenance`.
5. Deduplicate by normalized formula plus structure identifier when available.
   Never merge records solely because two databases use the same formula.
6. In the multi-agent workflow, discovery stops after normalization and hands
   the records to `materials-validator`; the validator calls `validate_material`
   before a candidate is recommended. A missing structure, missing unit, or
   unverified property is a review flag, not a passing value.

## Artifact contract

Write `materials/candidates.json` as a JSON object with `schema_version: 1`,
`query_plan`, `records`, `source_observations`, `provider_errors`, and
`validation_summary`. `not_found` means the provider returned no result;
`timeout`, `pending`, `schema_error`, `circuit_open`, and `budget_exhausted`
mean confirmation remains pending. Each record
must retain the raw provider id and the normalized property units. Include
retrieval time and endpoint/provider provenance, but never write API keys.

The current UI already previews CIF, DOSCAR, EIGENVAL, and `.phase` artifacts.
Use those files when present and link them from the candidate record. POSCAR,
OUTCAR, `vasprun.xml`, overlaid plots, and ranking tables are later extensions;
do not claim they were parsed until a dedicated viewer/parser exists.
