---
name: materials-design
description: Design evidence-grounded novel material candidates from benchmark advantages and failure modes, with falsifiable mechanisms and experiment-ready iteration records.
---

# Materials design

Use this skill only inside a coordinator-issued `design:*` task. Existing
materials are evidence and benchmarks, not answers to copy. Preserve the exact
literature/database source for every known property and label every proposed
mechanism, predicted benefit, and synthesizability judgment as a hypothesis.

## Design contract

1. Search `search_knowledge_documents` before building the benchmark map. A
   search snippet is discovery evidence only; load the matching complete
   document with `get_knowledge_document` or read its
   `literature/papers/.../document.md` before supporting a claim. When full text
   is missing, return the exact source to the search/ingestion task rather than
   guessing from metadata or an abstract.
2. Write `materials/design/benchmark-map.json` with each benchmark's supported
   advantages, observed or reported failure modes, source identifiers, units,
   evidence quality, knowledge document id, and Markdown anchor. MinerU output
   is transcription, not independent validation. Missing evidence remains
   missing.
3. For `design:brief`, represent the causal design basis as
   `materials/design/mechanism-failure-graph.json`. Use
   `compile_material_evidence_graph`; every claim-bearing node and edge needs a
   complete-document anchor. Include observable mechanism nodes, failure-mode
   nodes, intervention variables, target properties, measurable relations,
   confidence, coverage, failure priority, and falsification conditions. A
   prose-only mechanism map does not satisfy the contract.
4. For `design:candidates:N`, call `get_material_design_operators` and produce
   at least three candidates in
   `materials/design/iteration-N/candidates.json`. Every candidate requires:
   frozen objective and constraints, source-referenced parent materials, an
   explicit base state, one or more registered operator invocations,
   graph-linked expected effects, evidence analogues, expected trade-offs,
   synthesis risks, decisive falsifiers, and uncertainty. Apply the operators
   with `apply_material_design_operators` and validate each candidate with
   `validate_material_design_candidate` before completing the task.
5. Do not search the generated candidates for novelty, make a novelty verdict,
   or rank them during the Designer task. Completion freezes the candidate file
   and its graph lineage. The separate `materials-novelty-auditor` session owns
   exact/near-neighbour collision searches and records only bounded verdicts.
   Do not modify a frozen candidate artifact after handoff.
6. Deterministic formula, charge, structure, unit, and declared-constraint
   checks belong to `materials-validator` after the novelty audit. Invalid
   candidates stay in the record with rejection reasons. Then run
   `design:physics:N` through `materials-physics-screener`. It must preserve
   database facts, embedded reference values, calibrated proxies, assumptions,
   and missing evidence as different classes and return `reject`, `hold`, or
   `promote_to_dft` for every candidate. The physics layer checks HER and OER
   adsorption descriptors when supplied. For alkaline HER, `delta_g_h` is only
   a hydrogen-binding/Sabatier proxy and an optional water-dissociation barrier
   is only a Volmer-step proxy; neither establishes kinetics, stability, or
   measured activity. `hold` is not failure: it means the
   unknown or uncertainty is too important to hand directly to DFT without an
   explicit model or data decision. Ranking belongs to the independent design
   review and uses only novelty-surviving candidates, the user's frozen
   objective, and measured or calculated evidence. No stage may claim that a
   candidate is better than a benchmark until a comparable calculation or
   human experiment measures the target property.

## Iteration

For `experiment:interpret:N`, load the human-authored record and raw-data paths.
Create `materials/design/iteration-N/interpretation.json` that compares each
prediction and falsifier with the measurement. Preserve failed hypotheses.
Recommend exactly one of `stop`, `scale`, or `iterate`, with the evidence needed
for that decision. A new iteration must depend on this immutable record.
