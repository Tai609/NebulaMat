# Integrity Audit Report

> This document is reviewable evidence, not a verdict. Findings are graded Level 1–4
> per `references/04-evidence-grading.md`. The auditor records observations and
> requested raw data; institutional or journal review remains the appropriate
> mechanism for any determination of misconduct.

## 1 · Paper under audit

- Title:
- Authors:
- Identifier: DOI / arXiv ID / local paper-writer slug
- Version / date:
- Source artefact path: `<path to PDF in the run dir>`
- Input mode: PDF | DOI | slug

## 2 · Materials consulted

List every file the audit read. For slug audits, include the paper-writer-side raw artefacts.

- `paper.txt` (extracted text)
- `panels/*` (extracted figure panels — count: <N>)
- Supplementary materials: <list or "not available">
- Source data: <list or "not available">
- Slug-linked artefacts:
  - `output/experiment-suite/<slug>/latest/results.json`
  - `output/experiment-suite/<slug>/latest/data_contract.md`
  - `output/experiment-suite/<slug>/latest/figures/manifest.json`
  - `output/paper-writer/<slug>/latest/paper/bibliography.bib`
- External references checked: <list or "none">

## 3 · Methodology summary

For each of the three tracks, state in one line what the auditor did and what was not possible.

- **Image track**: <e.g., panels extracted from PDF via `pdfimages`, within- and cross-figure visual inspection, transformation alignment checks (flip / rotate / crop); no perceptual-hash tooling used>
- **Numerical track**: <e.g., every numeric claim in `paper.txt` greppable; recomputation against `results.json` for local-slug metrics; GRIM applicable to <N> claims; Benford not applicable (bounded metrics)>
- **Logical track**: <e.g., <N> headline claims compressed to A→B→C; controls / rescue / dose / reproducibility checks; cross-checked against `data_contract.md` reuse boundary>

## 4 · Findings

### 4.1 Severity headline

- Severity headline: **Level X** (max across all findings)
- Total findings: image=<N>, numerical=<N>, logical=<N>
- Clean tracks: <list, or "none">

### 4.2 Findings by track

#### Image findings

| File | Level | One-line summary |
|---|---|---|
| `findings/image/<id>.md` | <1–4> | <summary> |

(Or: `findings/image/_clean.md` — first-pass review found no anomalies.)

#### Numerical findings

| File | Level | One-line summary |
|---|---|---|
| `findings/numerical/<id>.md` | <1–4> | <summary> |

#### Logical findings

| File | Level | One-line summary |
|---|---|---|
| `findings/logical/<id>.md` | <1–4> | <summary> |

### 4.3 Cross-skill consistency (slug audits only)

For audits where the input is a local paper-writer slug, summarise the cross-product checks:

- Paper's `provenance.mode` claim vs `results.json["provenance"]["mode"]`: <match | mismatch — finding ID>
- Paper's reported `n_seeds` vs `len(results.json["seeds"])`: <match | mismatch — finding ID>
- Every figure in the paper appears in `figures/manifest.json`: <yes | list of missing>
- Dataset checksum in `data_contract.md` re-verifiable: <yes | no — cached file gone | not attempted>
- Paper's scope language (pilot / benchmark / comprehensive) vs `data_contract.md` Section "Reuse and publication boundary": <match | over-claim — finding ID>

## 5 · Requested raw data

Per `references/04-evidence-grading.md`, every Level ≥ 2 finding names the raw materials the author should produce. Aggregated here for downstream use:

- <Finding ID>: <raw artefact requested>
- <Finding ID>: <raw artefact requested>
- ...

If no Level ≥ 2 findings: state explicitly that no raw data is being requested at this time.

## 6 · Recommended next steps

Tier the recommendations by finding severity:

- For Level 1 findings: clarification request to authors (typo / format / antibody catalogue).
- For Level 2 findings: formal author response expected; record the response in a follow-up audit.
- For Level 3 findings: pending raw data submission; escalate to the journal's integrity contact if data is not forthcoming.
- For Level 4 findings: forward to the journal and the corresponding institutional integrity body.

The auditor does not initiate institutional contact unilaterally. The audit report is the input to a human (or institutional) workflow that decides whether to escalate.

## 7 · Limitations and scope

Be explicit about what this audit did and did **not** cover. Examples:

- Source TIFFs / raw blots not available — image findings rely on extracted-from-PDF panels only; some manipulation classes (subtle pixel-level edits visible only on raw TIFF) cannot be ruled out.
- Source data tables not available — numerical recomputation limited to internal consistency.
- Same-author historical work not cross-checked (out of v1 scope).
- Only one paper audited — career-level patterns (recurring image reuse across multiple papers from the same lab) require separate analysis.

## 8 · Confidence statement

Single paragraph summary: what the auditor is confident about (e.g., "the paper's headline numbers are internally consistent with the linked `results.json`") and what remains uncertain (e.g., "without source TIFFs, Figure 2A / Figure 5C similarity cannot be characterised further than visual inspection").

This is **not** a verdict on the paper. It is a structured pointer to where additional review effort is best spent.

---

*Audit conducted by the `integrity-auditor` skill. Methodology in the `integrity-auditor` skill's references. Human review by a domain expert is strongly recommended before any action is taken on these findings.*
