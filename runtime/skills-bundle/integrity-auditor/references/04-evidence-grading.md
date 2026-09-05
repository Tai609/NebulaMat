# Evidence Grading — Levels and Reviewable Format

## Why grading matters

A paper audit that brands every issue "suspected fraud" is useless. Most findings are at the lower end: rounding bugs, missing antibody catalogue numbers, ambiguous figure captions. A small fraction are at the top: pixel-aligned panels claimed to be from independent experiments. Grading communicates severity and required next steps without slipping into editorial judgement.

The grading scheme has four levels. Use the lowest level that the evidence honestly supports.

## The four levels

### Level 1 — Suspicious (could be benign)

A small anomaly that could plausibly be a typo, format inconsistency, or rounding artefact. Does not by itself indicate misconduct or major error. Examples:

- body and caption disagree on `n` by an off-by-one error
- a single missing antibody catalogue number
- two-decimal rounding inconsistency between table and figure
- compression artefacts in a published figure (JPEG block boundaries that resemble splices)
- two panels look similar but the resemblance is plausibly biological (loading control reuse from the same blot)

What the auditor records: location, what was observed, why it might be benign, what additional information would resolve it.

What the auditor recommends: note it, ask the author for the missing piece, but do not escalate.

### Level 2 — Obvious anomaly

A clear deviation from expectations that requires explanation. The evidence is on disk and reproducible. Examples:

- the paper claims `measured` results, the linked `results.json` has `provenance.mode == "simulated"`
- figure caption says `n = 6`, every other location in the paper says `n = 3`
- a figure in the paper is not present in the corresponding `figures/manifest.json` (no production trail)
- bar charts with no underlying scatter on small samples (`n ≤ 10`), where the variation would change the conclusion
- a control panel is identical across two figures with different stated conditions, but no disclosure of reuse

What the auditor records: precise location, what was observed, what is inconsistent, and what the author should clarify.

What the auditor recommends: contact authors, request raw data and clarification, expect a formal reply.

### Level 3 — Cannot resolve without raw data

The anomaly is strong enough that internal evidence alone cannot determine whether the paper is correct, but the necessary raw materials would resolve it. Examples:

- two panels share pixel-level features after transformation; need source TIFFs to confirm or refute
- a key statistic cannot be reproduced from the supplementary table; need per-replicate values
- a claimed causal chain has a single weak experiment; need additional rescue data
- a `data_contract.md` references a checksum that cannot be re-verified (cached file gone); need the file or a re-download attempt

What the auditor records: location, observed anomaly, the specific raw data / file / experiment needed.

What the auditor recommends: escalate to the journal or institutional integrity body if authors decline to provide raw data; otherwise pause pending raw data.

### Level 4 — High suspicion of misconduct

Strong evidence of manipulation that would be very difficult to explain benignly. Reserved for findings where the auditor is confident enough that a reasonable reviewer would expect formal investigation. Examples:

- a panel is pixel-identical to one in the same authors' earlier paper describing a different experiment
- splice marks visible at lane edges, background discontinuity, with no disclosure of cropping
- a `provenance.mode == "simulated"` results file is presented in the paper as "measured experiments" without disclosure
- claimed source data is fabricated (recomputed values diverge from reported by more than rounding can explain)

What the auditor records: location, the smoking-gun evidence, transformation parameters, the closest benign explanation and why it does not fit.

What the auditor recommends: forward to the appropriate integrity body (journal, institution, ORI). The auditor still does not write "this is fraud" — that determination requires institutional process. The auditor writes "this is consistent with misconduct and cannot be explained by typical errors".

## Severity is not vote count

Do not add up findings to escalate severity. A paper with twelve Level 1 findings is a sloppy paper. A paper with one Level 4 finding is a different problem entirely. The report's headline severity is the **maximum** level present, not the average and not the sum.

## The reviewable-evidence format

Every finding, at every level, must include:

1. **Paper identifier** — DOI / arXiv ID / local paper-writer slug.
2. **Location** — section + paragraph + page (for body); figure id + panel + sub-region (for images); table id + cell (for tables).
3. **Source artefact pointer** — path in `$RUN/` to the extracted material (panel PNG, line in `paper.txt`, JSON path in `results.json`).
4. **What was observed** — concrete description of the anomaly. Pixel coordinates, line numbers, exact numbers.
5. **Why this would not happen under normal conditions** — the implicit hypothesis test the auditor is running. "Two independent biological replicates do not share random gel-background grain."
6. **For image findings, the transformation** — rotation / flip / crop / brightness, parameters where possible.
7. **For numerical findings, the recomputation** — the formula, the inputs, the result, the reported value.
8. **Requested raw data** — what the author should produce to resolve the finding (for Level ≥ 2). This is the single most important field for downstream use.
9. **Level + brief justification** — why this is Level X and not Level X-1 or X+1.

A finding without source-artefact pointer + requested-raw-data field is not reviewable. Reject it from the report.

## Severity language for the report

When the report uses graded language, prefer:

- Level 1: "inconsistent", "ambiguous", "warrants clarification"
- Level 2: "anomalous", "requires explanation", "unsupported by adjacent evidence"
- Level 3: "cannot be resolved with the available materials", "requires the following raw data"
- Level 4: "consistent with manipulation", "requires formal review"

Never:

- "fraudulent", "fabricated", "intentional" — these are determinations for institutional process, not for the auditor.

## Quick reference

| Level | Trigger | Action |
|---|---|---|
| 1 | Minor inconsistency, plausibly benign | Note; request clarification |
| 2 | Clear deviation, internal evidence sufficient | Contact authors; expect response |
| 3 | Strong anomaly, raw data required | Escalate if authors decline raw data |
| 4 | Smoking-gun manipulation evidence | Forward to integrity body |
