---
name: review-response
description: Turn manuscript reviewer requests for computational chemistry or materials calculations into an approved, executed, validated, and provenance-backed response package.
---

# Computational Review Response

Use this workflow when a manuscript, supporting information, and reviewer
comments request new calculations or computational clarification.

## Workflow

1. Read only the supplied manuscript, SI, reviews, and original calculation
   archive. Build a method fingerprint containing the model, code, functional
   or force field, potentials/basis, dispersion/U, charge/spin, k-points,
   convergence thresholds, thermodynamic corrections, and reference states.
2. Triage every reviewer comment as `no-calculation`, `clarification`,
   `calculation-required`, or `scientific-choice-required`. Record the exact
   reviewer question, proposed observable, smallest credible calculation,
   success criterion, estimated cost, and missing evidence.
3. Present one calculation plan for human approval before generating expensive
   work. Multiple scientifically plausible models or methods remain explicit
   choices; do not silently select one.
4. For each approved calculation, use `comp-chem-workflow`, the relevant AICC
   engine/structure skill, and NebulaMat's `hpc-submit` adapter. Keep one
   immutable input/output/validation evidence packet per reviewer comment.
5. An independent reviewer classifies each result as `addresses`,
   `contradicts`, `inconclusive`, or `needs-follow-up`. Technical convergence
   alone cannot answer the comment. Contradictory results stop claim promotion
   and are shown to the authors without spin.
6. Draft response-letter paragraphs, SI methods/tables/figures, limitations,
   and a manifest linking every numeric claim to its input, output, parser JSON,
   run record, and units. Use the deployed AICC `report` skill when a `.docx`
   package is requested.
7. Present the complete draft for human approval. Never submit, email, or alter
   the manuscript outside the workspace without an explicit separate request.

For materials projects, attach the plan and evidence packets to the existing
`materials-workflow` tasks and reviewer votes. Otherwise, keep them as versioned
workspace artifacts so NebulaMat provenance and Runs remain the source of truth;
do not create a shadow scheduler database.

