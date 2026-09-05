---
name: integrity-auditor
description: Use when the user wants a paper audited for integrity issues — image misuse, numerical anomalies, logical gaps — and needs a reviewable evidence report. Works on external papers (PDF / DOI / arXiv) and on outputs from a local paper-writer run. Single-stage skill.
---

# Integrity Auditor

## Overview

Paper-integrity audit package. **Single stage, full quality from the start.** The agent reads each reference, then carries out three evidence tracks (image / numerical / logical) and produces a structured `audit_report.md` with Level 1–4 graded findings.

This skill ships no LLM SDK — it is the skill instructions, references, templates, and single-purpose `forensics_tools/` only.

The substantive work is decomposed into reference playbooks under `references/`:

| Reference | Topic |
|---|---|
| `references/00-incremental-execution.md` | how to do this without losing work: batches, persistence, resume — **read first** |
| `references/01-image-evidence.md` | image evidence: panel split, dup detection, rotate/flip alignment, Western-blot continuity |
| `references/02-numerical-evidence.md` | numerical evidence: n-consistency, mean/SD/SEM recompute, P-value sanity, decimal trail, Benford with caveats, deterministic-column-pair and last-digit chi-square sweepers, variance-reporting consistency |
| `references/02a-supplement-acquisition.md` | publisher CDN routes: how to get hi-res figures and source-data XLSXs even when the article PDF is paywalled |
| `references/02b-ml-paper-arithmetic.md` | ML / non-biology papers: arithmetic re-derivation of every quoted improvement against tabulated benchmark cells; leaderboard archive routes |
| `references/03-logical-evidence.md` | logical evidence: conclusion-chain compression, missing controls, replication gap |
| `references/04-evidence-grading.md` | 4-level finding grading + reviewable-evidence format (DOI / figure-id / pointer / transformation / requested raw data) |
| `references/05-quality-gate.md` | self-check before delivery |

Also:

- `templates/audit_report.md` — report skeleton the agent fills.
- `forensics_tools/image_dup.py` — perceptual-hash (dHash + aHash) duplicate detector for figure / panel PNGs. Single-purpose pure-Python utility (Pillow only). Catches untransformed dups.
- `forensics_tools/image_dup_orb.py` — ORB feature-matching duplicate detector with horizontal-flip augmentation. Catches **transformed** dups (rotation / flip / crop / brightness change) that perceptual hashing misses. Pair with `image_dup.py`: use phash first, escalate to ORB when phash distance is suspicious-but-inconclusive (16–60 range). Deps: OpenCV + NumPy.
- `forensics_tools/panel_split.py` — whitespace-gutter panel splitter. Pair with `image_dup.py` / `image_dup_orb.py` for cross-panel duplicate detection; whole-figure phash without panel splitting almost never finds anything.
- `forensics_tools/channel_check.py` — RGB channel-content classifier (DAPI / Flag / Merge / other) for fluorescence sub-images. Catches within-panel label swaps (e.g., a "DAPI" sub-image that is actually a Merge); cross-panel phash cannot catch this class.
- `forensics_tools/decimal_match.py` — cross-cell last-N-decimal matching sweeper for source-data XLSX. Detects fabrication where many distinct values share trailing decimal patterns (Kang Tiebang whistleblower class). Single-purpose pure-Python utility (openpyxl only). See `references/02-numerical-evidence.md` Check 1.5.
- `forensics_tools/magnitude_consistency.py` — supplement-text vs source-data XLSX unit/scale consistency. Catches unit-confusion (TWh vs GWh, mM vs µM, MHz vs Hz, etc.) and order-of-magnitude transcription errors via entity-overlap + literal-value matching across a generic SI-prefix-aware unit taxonomy covering energy / power / mass / length / area / volume / time / voltage / current / frequency / pressure / concentration / amount / force / dose / genomics-bp / CO2 / currency. Cross-family pairs (e.g., kV vs TWh) are automatically rejected. Pair with `bilingual_cn_geography.json` (or your own JSON map) for cross-language entity matching. Empirical baseline: Hu et al. 2026 Nature Tongyu county 1000× unit error. See `references/02-numerical-evidence.md` Check 1.6.
- `forensics_tools/xlsx_aggregate_consistency.py` — cross-XLSX same-quantity sum/row consistency. Detects when two source-data tables in the same paper purport to carry the same aggregate quantity but disagree by a small systematic margin (e.g., Hu et al. 2026 Nature MOESM3 vs MOESM6 1110.78 vs 1103.89 TWh, 0.62 percent diff, all 31 provinces same sign). Reuses the unit taxonomy from `magnitude_consistency.py`. Empirical baseline same paper Level 1 finding. See `references/02-numerical-evidence.md` Check 1.7.
- `tests/smoketest.sh` — < 30-second pre-commit gate. Compiles every script, runs every `--help` (catches argparse `%` bugs), and runs positive + negative controls for `decimal_match`, `magnitude_consistency`, and `xlsx_aggregate_consistency`. Run before every change.
- See `forensics_tools/README.md` for the design rule that distinguishes utility scripts from forbidden "skeleton → enrich" orchestration, and for the recommended pipeline.

**Read the relevant reference _before_ writing, not after.** The full audit does not fit in a single turn — `references/00-incremental-execution.md` is the only execution mode that completes.

## When to Use

- User hands you a paper (PDF / DOI / arXiv ID) and asks whether the figures / data / logic are trustworthy.
- User wants a quality gate on outputs from a local paper-writer run (slug-based).
- Reviewer / investigator wants a reviewable-evidence document to forward to authors or an integrity body.

## When NOT to Use

- User wants to write a paper → `paper-writer`.
- User wants to build / run an experiment → `experiment-suite`.
- User wants a literature survey → `literature-survey`.
- User wants a verdict ("is this fraud?") — this skill produces evidence and grading, never verdicts.

## Workflow

### Step 1 — Identify the input and set up the run

Detect input mode:

| Mode | Trigger | Acquisition |
|---|---|---|
| **PDF path** | local `*.pdf` argument | use directly |
| **DOI / arXiv ID** | `10.xxxx/...`, `arXiv:NNNN.NNNNN` | `WebFetch` landing page; record DOI / arXiv URL and abstract; download PDF if open-access |
| **Local paper-writer slug** | matches `output/paper-writer/<slug>/latest/` | use slug directly; also read `output/experiment-suite/<slug>/latest/` if present |

Compute slug:

```bash
TITLE_OR_ID="<input identifier>"
SLUG=$(python3 -c "import re,hashlib,sys; t=sys.argv[1]; n=re.sub(r'[\\s_]+','-',re.sub(r'[^\\w\\s-]','',t.lower().strip())).strip('-')[:40].rstrip('-'); h=hashlib.sha1(t.encode()).hexdigest()[:8]; print(f'{n}-{h}')" "$TITLE_OR_ID")
# For local-slug mode, set SLUG to the existing paper-writer slug directly.
TS=$(date +%Y-%m-%d_%H%M%S)
RUN=output/integrity-auditor/$SLUG/$TS

mkdir -p "$RUN/findings/image" "$RUN/findings/numerical" "$RUN/findings/logical"
ln -sfn "$TS" "output/integrity-auditor/$SLUG/latest"
```

In commands below `$RUN` = `output/integrity-auditor/<slug>/latest`.

### Step 2 — Gather materials into the run

**Open `references/02a-supplement-acquisition.md` first if the input is a DOI / arXiv ID / external PDF reference.** Many publishers (Nature / Springer being the canonical example) gate the article body behind a paywall while serving the supplementary tables, source data, and hi-res figures on **open CDN endpoints**. Never conclude "paywalled, audit blocked" before trying the supplement / figure CDN routes.

Acquisition order (try every step; do not stop early):

1. **Article HTML landing page** — usually open even when PDF is gated. `curl -sL -A "Mozilla/5.0" "<article URL>" -o $RUN/paper.html`. This page typically embeds the abstract, all main-figure captions, and direct CDN URLs for every supplementary file and high-resolution figure.
2. **Harvest CDN URLs from the HTML**: `grep -oE 'https?://[^"]*(MOESM|Fig[0-9]_HTML|mmc|MEDIA)\.(?:pdf|xlsx|docx|png)' $RUN/paper.html | sort -u`. Download every distinct URL into `$RUN/supplementary/` and `$RUN/figures_hires/`.
3. **Author Correction PDF** — `curl -sL -A "Mozilla/5.0" "<correction URL>.pdf" -o $RUN/correction.pdf` then `file $RUN/correction.pdf` to confirm it is a real PDF (not HTML auth wall).
3a. **CRITICAL — the correction's own supplementary** — fetch the correction's landing HTML, grep for its `MOESM` supplementary URLs (separate DOI namespace from the parent article), download every one. These often contain the **pre-correction** originals of replaced figures. See `references/02a-supplement-acquisition.md` for the exact recipe. Empirical baseline: the Wang Ping 2025 Nature audit only surfaced its image-track Level 4 finding because the correction's `MOESM1_ESM.pdf` carried the original (pre-correction) Fig 2 and Extended Data Figs 7, 10.
4. **Article PDF** — `curl -sL -A "Mozilla/5.0" "<article URL>.pdf" -o $RUN/paper.pdf` then `file $RUN/paper.pdf`. If gated, record that fact in the manifest and continue with whatever the earlier steps acquired.
5. **For a local paper-writer slug only**: read the matching `results.json`, `data_contract.md`, `figures/manifest.json`, `bibliography.bib`.

Write `$RUN/input_manifest.md` listing every artefact actually acquired. At minimum it must enumerate what was downloaded and what was attempted-but-blocked.

Extract structured material:

```bash
# Text (every numeric claim, caption, figure reference will be greppable later)
pdftotext -layout "$PDF" "$RUN/paper.txt"

# Panels (one .png / .ppm per embedded raster image)
mkdir -p "$RUN/panels"
pdfimages -all "$PDF" "$RUN/panels/page"
N_RASTER=$(ls "$RUN/panels" 2>/dev/null | wc -l)

# Fallback for vector-figure papers (e.g., paper-writer outputs):
# pdfimages only extracts embedded raster images; a paper built from matplotlib
# vector PDFs through \includegraphics will yield zero panels here. In that case,
# render each page to a PNG so visual inspection is still possible.
if [ "$N_RASTER" -eq 0 ]; then
  pdftoppm -r 150 "$PDF" "$RUN/panels/page" -png
fi

# For a local paper-writer slug audit, also pull the production-side figure PDFs directly
# (these are the originals, before LaTeX embedding):
if [ "$INPUT_MODE" = "slug" ]; then
  mkdir -p "$RUN/figures_from_suite"
  cp output/experiment-suite/$SLUG/latest/figures/*.pdf "$RUN/figures_from_suite/" 2>/dev/null
  cp output/experiment-suite/$SLUG/latest/figures/manifest.json "$RUN/figures_from_suite/" 2>/dev/null
fi

ls "$RUN/panels" | wc -l   # record in input_manifest.md
```

If `pdfimages` / `pdftotext` / `pdftoppm` from poppler-utils is not installed, install via system package manager and retry. Do not proceed without either raster panels or page renderings — image evidence track depends on them.

If the article PDF is paywalled **and** the article HTML page yields no supplementary or figure CDN URLs **and** the Author Correction PDF is also gated, then and only then write `_paywall_blocked.md` per track. The Wang Ping 2025 Nature audit (`output/integrity-auditor/wang-ping-hdac6-valine-10-1038-s41586-024-08248-5/latest/`) demonstrates that the article body being gated says nothing about whether the supplementary source data is gated; the latter is almost always open and is where the substantive audit lives.

### Step 3 — Run the three audit tracks (REQUIRED — this is the whole job)

Open `references/00-incremental-execution.md` first. Then carry out the three tracks below across many turns, persisting state to `$RUN/` after every batch.

#### 3.0 Paper-type triage (do this first; it picks which sweepers run)

Before invoking any sweeper or forensics tool, classify the paper. The substantive audit method differs by class — running biology sweepers on an ML paper wastes the run and pollutes the report with "swept clean" lines that are misleading (nothing was actually swept).

| Class | Signals | Image-track method | Numerical-track method |
|---|---|---|---|
| **bio** | microscopy / Western blot / fluorescence / source-data XLSX / supplementary MOESM*.xlsx | `forensics_tools/image_dup.py`, `panel_split.py`, `channel_check.py` per `references/01-image-evidence.md` | sweepers from `references/02-numerical-evidence.md` Checks 1–4 |
| **ml** | schematic architecture diagrams, training-curve line plots, benchmark-score tables, no source-data XLSX, leaderboard URLs in body | figure-vs-text consistency only (forensics tools inapplicable — schematic figures lack pixel-level forensic signal) | **arithmetic re-derivation** per `references/02b-ml-paper-arithmetic.md`; sweepers do not apply (per-cell n too small for chi-square; cells heterogeneous in scale) |
| **other** (theory / review / clinical) | no source data, no original figures | document scope-limit; usually only logical-track is informative | logical-track only; record "numerical track inapplicable" |

Quick triage heuristic (works in one line):

```bash
# If ≥ 1 XLSX in supplementary/, treat as bio; if arXiv ID + no XLSX + ≤ 5 figures, treat as ml.
N_XLSX=$(ls $RUN/supplementary/*.xlsx 2>/dev/null | wc -l)
[ "$N_XLSX" -ge 1 ] && PAPER_CLASS=bio || PAPER_CLASS=ml
echo "$PAPER_CLASS" > $RUN/paper_class.txt
```

Record the chosen class in `$RUN/input_manifest.md` so reviewers can see the methodological branch.

When a sweeper or forensics tool is **inapplicable** for the paper class, write `findings/<track>/_inapplicable.md` (NOT `_clean.md`) — see "Important rules" below for the semantic distinction. A `_clean.md` claims "I swept and found nothing"; an `_inapplicable.md` claims "the tool does not apply to this paper class; here is what was checked instead". Conflating the two understates audit honesty.

#### 3.1 Image evidence

**Open:** `references/01-image-evidence.md` (for bio class). For each figure panel, check within-figure duplicates, cross-figure duplicates, transformations (rotate / flip / crop / brightness), and Western-blot background continuity. Each anomaly becomes one `$RUN/findings/image/<short-id>.md` written in the per-finding format described in `references/04-evidence-grading.md`. A "no issue" outcome is recorded as `_clean.md`.

For **ml** class: forensics tools do not apply (schematic figures lack pixel-level signal). Substitute check is figure-vs-text consistency. Record as `findings/image/_inapplicable.md` listing which tools were considered and what consistency check was substituted.

#### 3.2 Numerical evidence

**Open:** `references/02-numerical-evidence.md` (for bio class) or `references/02b-ml-paper-arithmetic.md` (for ml class). Bio class: extract every numeric claim from `paper.txt` with its location (section / figure / table); recompute means / SDs / SEMs against source data when available; otherwise check internal consistency (does `n=6` in the body match the figure caption?); run the four sweepers (Checks 1–4). ML class: arithmetic re-derive every quoted delta / average / improvement against the table cells (Checks 1–4 are inapplicable; record as `_inapplicable.md` and the arithmetic re-derivation as `_clean.md` or as one finding per mismatch).

Each mismatch (either class) becomes `$RUN/findings/numerical/<short-id>.md`. For a local paper-writer slug, also reconcile every number in the paper against `output/experiment-suite/<slug>/latest/results.json` — every reported metric must trace back to a `summary` or `runs` entry.

In addition (both classes), run **Check 5 — variance-reporting consistency** from `references/02-numerical-evidence.md`: scan every table caption for restart / seed / std / error-bar mentions; flag the case where some tables in the same paper report restart-averaged numbers and others do not, when the un-averaged tables carry sub-1-pp claims. This was the BERT NSP-overclaim finding mechanism.

#### 3.3 Logical evidence

**Open:** `references/03-logical-evidence.md`. Compress each headline claim into "A through B causes C" form. Check whether the experiments actually exercise A, B, and the A→B→C link with controls (positive / negative / rescue / dose / time). Each gap becomes `$RUN/findings/logical/<short-id>.md`.

#### 3.4 Grading and report assembly

**Open:** `references/04-evidence-grading.md` and `templates/audit_report.md`. For each finding, assign Level 1 (suspicious / could be benign), Level 2 (obvious anomaly), Level 3 (cannot resolve without raw data), Level 4 (high suspicion of misconduct). Copy the template to `$RUN/audit_report.md` and fill it section by section, citing each finding file by relative path. The report must include a "Requested raw data" section listing exactly what the author needs to supply for any Level 3 finding to be resolved.

#### 3.5 Quality gate

**Open:** `references/05-quality-gate.md`. Verify: no editorial verdicts in the report, every finding has a reviewable artefact pointer, every Level ≥ 2 finding names the raw data needed to resolve it, the manifest matches what was actually examined.

### Step 4 — Deliver

Report:

1. `output/integrity-auditor/<slug>/latest/input_manifest.md`
2. `output/integrity-auditor/<slug>/latest/findings/{image,numerical,logical}/*.md`
3. `output/integrity-auditor/<slug>/latest/audit_report.md`
4. Stats per the report format in `references/05-quality-gate.md`.

## Cross-skill data flow (path convention)

When the input is a local paper-writer slug, the auditor is **read-only** against:

- `output/paper-writer/<slug>/latest/paper/main.pdf` — the paper under audit
- `output/paper-writer/<slug>/latest/paper/bibliography.bib` — citation provenance
- `output/experiment-suite/<slug>/latest/results.json` — numerical ground truth + `provenance.mode` (every "measured" claim in the paper must be backed here)
- `output/experiment-suite/<slug>/latest/data_contract.md` — dataset binding (does the data actually exist; checksum recoverable)
- `output/experiment-suite/<slug>/latest/figures/manifest.json` — figures the paper is allowed to reference (basenames only)

Never modify another skill's outputs. The audit is a third-party read.

## Important rules

- **No LLM SDK in this skill.** No `import anthropic` / `import openai`. The skill is its instructions + references + template only.
- **Findings are evidence, not verdicts.** Use Level 1–4 grading. Never write "this is fraudulent" — write "this requires raw data to resolve" or "this is inconsistent with §3.2 caption".
- **Every Level ≥ 2 finding must be reviewable.** That means: figure id + panel coordinates / page-line pointer + transformation description + the raw data the author should supply.
- **Absence of findings is also a result, BUT distinguish two cases:**
  - `_clean.md` — the track's tools/sweepers **were applicable and were run**, and produced no anomaly. List what was checked and what passed. Empirical baseline: Wang Ping numerical track Mode A swept all 14 XLSX sheets and found 5 hits — the other 9 would be `_clean.md` content if reported per-sheet.
  - `_inapplicable.md` — the track's tools **do not apply to this paper class** (e.g., biology image-dup on a pure ML schematic-figure paper). List which tools were considered and rejected, and what substitute check was used instead. Empirical baseline: BERT (arXiv:1810.04805) image track wrote `_inapplicable.md`; the substitute was figure-vs-text consistency.
  - These two states are **not interchangeable**. Calling an `_inapplicable.md` situation "clean" overstates audit coverage; calling a genuine `_clean.md` "inapplicable" understates it.
- A pure-Python utility script (image hashing, P recompute, etc.) **is allowed** in this skill under a `forensics_tools/` directory if a concrete pain point demands it — the anti-pattern rule is against "skeleton → enrich" pipeline orchestrators and LLM SDK imports, not against single-purpose tools. v1 ships without `forensics_tools/`; revisit when needed.
