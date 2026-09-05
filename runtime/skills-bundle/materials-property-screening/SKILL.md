---
name: materials-property-screening
description: Screen normalized material candidates against explicit stability, electronic, composition, and data-quality constraints and produce an auditable report.
---

# Materials property screening

Screen only normalized records from `materials-mcp`. Keep discovery, validation,
and ranking as separate stages so a missing provider field cannot be mistaken
for a negative property.

## Workflow

1. Load `materials/candidates.json` and state the target property, units, and
   cutoffs before filtering.
2. Apply hard filters first: element set/ratio, validation errors, required
   structure, and stability threshold (usually energy above hull in eV/atom).
3. Apply soft preferences second: band gap, density, magnetic moment, cost or
   synthesis-relevant metadata. Preserve the original values and source.
4. Report excluded candidates with an explicit reason. Do not impute a missing
   band gap or treat a provider error as a zero.
5. Produce `materials/screening-report.json` with `schema_version: 1`,
   `criteria`, `included`, `excluded`, `missing_data`, and `provenance`.
   In a multi-agent workflow, advance only to `awaiting_review`; the Reviewer
   owns approval for DFT or completion.

The current interface can display `.phase` convex-hull Viewer output plus CIF,
DOSCAR, and EIGENVAL artifacts. Use those existing views for inspection and
cite their workspace paths in the report. Candidate ranking tables and band/DOS
overlays are planned outputs and must be labeled as such until implemented.
