# ML / Non-Biology Papers — Arithmetic Re-Derivation as the Numerical Method

## Why this exists

The numerical sweepers in `references/02-numerical-evidence.md` (Checks 1.1–1.4, 3.1, 3.2, GRIM, Benford) are biology-data-table specific. For ML papers they are essentially inert:

- ML papers do not ship source-data XLSXs; numerical content is small fixed tables of benchmark scores.
- Per-cell n is typically < 20; last-digit chi-square is uninformative below that floor.
- Cells are heterogeneous in scale (accuracy 0.5–1.0, F1 0.7–0.9, perplexity 3–6) and cannot be pooled into a single sweeper.
- Source data for ML benchmarks lives on external **leaderboards** (GLUE, SQuAD, SWAG, ImageNet, MLPerf, etc.), not in supplementary files.

So the numerical-track method for ML papers is different in kind: **arithmetic re-derivation of every quoted delta against the table cells**, plus optional cross-check against the named leaderboard. This file documents both.

## When to use

Step 3.0 paper-type triage assigned `PAPER_CLASS=ml`. Typical signals:

- arXiv ID; no XLSX supplement
- benchmark tables (GLUE / SQuAD / SWAG / MMLU / ImageNet / COCO / WMT / etc.)
- schematic architecture diagrams and training-curve line plots in place of microscopy
- "leaderboard" / "test set" / "dev set" appear in body

If the paper is hybrid (ML methodology applied to biology data with source-data XLSX), run both tracks: sweepers per 02-numerical-evidence.md AND arithmetic re-derivation per this file.

## The method — arithmetic re-derivation

The audit pass is mechanical. For every numeric claim in the abstract / introduction / results body, do three things:

### Step 1 — Index every quoted improvement / average / delta

```bash
# Quoted scores
grep -nE "[0-9]+\.[0-9]+" $RUN/paper.txt | head -200

# Quoted improvements (deltas)
grep -nE "(\+|-)[0-9]+\.[0-9]+ (point|absolute|F1|accuracy|pp|%)" $RUN/paper.txt
grep -nE "[0-9]+\.[0-9]+%? (absolute|point|F1) (improvement|gain|increase|drop)" $RUN/paper.txt
grep -nE "outperforms .* by [+]?[0-9]+\.[0-9]+" $RUN/paper.txt
```

Build a flat list: `(claim_location, claimed_value, claimed_comparator)`.

### Step 2 — Re-derive each claim from the table cells

For each indexed claim, locate the table cells the claim is computed from and recompute the arithmetic.

```python
# Pattern: claim says "X improvement of Y over Z"
# Re-derive: X_table_cell − Z_table_cell == Y ?
import math
def check_delta(table_cell, baseline_cell, claimed_delta, tol=0.05):
    actual = round(table_cell - baseline_cell, 2)
    ok = abs(actual - claimed_delta) <= tol
    return ok, actual

# Pattern: claim says "average of X across N tasks"
def check_average(cells, claimed_avg, tol=0.05):
    actual = sum(cells) / len(cells)
    ok = abs(actual - claimed_avg) <= tol
    return ok, actual
```

Tolerance: 0.05 covers single-decimal rounding ambiguity (0.5 pp claimed vs 0.45 or 0.55 actual rounds equivalently). Tighten to 0.005 if the paper reports two decimal places.

### Step 3 — Record each mismatch as a finding, each clean as a row in `_clean.md`

- Every mismatch above tolerance → one `findings/numerical/<short-id>.md` per the format in `references/04-evidence-grading.md`.
- The full clean re-derivation table → `findings/numerical/_clean.md` showing each claim and its re-derived value side by side. This is the audit's evidence that arithmetic re-derivation actually happened.

The biology sweepers (Checks 1.1–1.4, 3.1, 3.2, 4) → `findings/numerical/_inapplicable.md` listing each sweeper, why it does not apply (small n, heterogeneous cells, no source data), and what arithmetic re-derivation was done instead.

## Concrete recipe — the BERT audit pattern

Empirical baseline: arXiv:1810.04805v2 audit (2026-05-25), `output/bert-pre-training-of-deep-bidirectional-d575da2c/latest/`.

For each of these claims, the re-derivation worked out exactly:

| Claim | Cells | Computation | Match |
|---|---|---|---|
| Abstract "GLUE 80.5%, +7.7 over OpenAI GPT" | 80.5 (BERT-LARGE leaderboard) − 72.8 (OpenAI GPT leaderboard, quoted in §4.1) | `80.5 − 72.8 = 7.7` | ✓ |
| Abstract "MultiNLI 86.7%, +4.6 absolute" | 86.7 (Table 1 BERT-LARGE MNLI-m) − 82.1 (Table 1 OpenAI GPT MNLI-m) | `86.7 − 82.1 = 4.6` | ✓ |
| Abstract "SQuAD 1.1 F1 93.2, +1.5" | 93.2 (Table 2 BERT-LARGE Ens+TriviaQA) − 91.7 (Table 2 #1 ensemble nlnet) | `93.2 − 91.7 = 1.5` | ✓ |
| Abstract "SQuAD 2.0 F1 83.1, +5.1" | 83.1 (Table 3 BERT-LARGE) − 78.0 (Table 3 #1 single MIR-MRC) | `83.1 − 78.0 = 5.1` | ✓ |
| Table 1 "Average" column, 5 systems | each row's 9 per-task cells | recomputed all 5; max |Δ| = 0.06 | ✓ |
| §4.1 "+4.5%/+7.0% GLUE improvement" | 79.6 − 75.1 = 4.5; 82.1 − 75.1 = 7.0 | ✓ | ✓ |
| §4.4 "+27.1% / +8.3% on SWAG" | 86.3 − 59.2 = 27.1; 86.3 − 78.0 = 8.3 | ✓ | ✓ |

When all re-derivations match, the paper passes the arithmetic gate. When any mismatches, it is a finding, graded by magnitude (Level 1 for ≤ 0.5 pp rounding-ish drift; Level 2 for clear cell-vs-body inconsistency; Level 3+ only with corroborating evidence of intent).

## Cross-leaderboard verification (optional second pass)

A more thorough audit checks the paper's quoted **competitor** scores against the live (or archived) leaderboard at the paper's claimed snapshot date.

### Known leaderboard archive routes

| Benchmark | Live URL | Archive route |
|---|---|---|
| GLUE | `https://gluebenchmark.com/leaderboard` | Wayback Machine snapshots; the public leaderboard JSON at `https://gluebenchmark.com/leaderboard.json` (when accessible) |
| SQuAD 1.1 | `https://rajpurkar.github.io/SQuAD-explorer/` | static GitHub Pages — git log on the SQuAD-explorer repo recovers historical rankings |
| SQuAD 2.0 | same explorer page | same |
| SWAG | `https://leaderboard.allenai.org/swag/submissions/public` | AllenAI hosts JSON of submissions at a versioned URL |
| MMLU | `https://github.com/hendrycks/test` | the official repo's README updates over time; `git log -- README.md` reconstructs history |
| ImageNet | various (no single canonical leaderboard since 2017) | paper citations |
| MLPerf | `https://mlcommons.org/benchmarks/training/` | per-round results JSON |

The general rule: when the paper says "as of date D, the top leaderboard system was X", a clean audit cross-references that against the live or Wayback-archived leaderboard at D. The auditor records the lookup but does not need to flag minor discrepancies (live leaderboards update continuously).

This is **optional**: the substantive ML audit is the within-paper arithmetic re-derivation. Cross-leaderboard verification is a defense-in-depth check, not a primary signal.

## ML detection / segmentation models that produce headline integer counts

When an ML paper applies a trained detection or segmentation model to a large unannotated corpus (satellite imagery, microscopy stacks, scientific document archives, etc.) and reports a **headline integer count** of detected entities — "we identified N facilities", "we counted N events" — apply this specific disclosure check.

Required (or expected) for the count to be auditable:

1. **Precision and recall at the production-time operating point**, not just mAP / mIoU. mAP averages performance across confidence-score thresholds; the production inference uses one specific threshold (NMS, confidence cutoff), and that operating point's P + R numbers determine how to interpret the headline count. Without them, the auditor cannot tell whether N is a lower bound (missed positives → true count higher), upper bound (false positives → true count lower), or centered estimate.

2. **Test set distinct from validation set used for early stopping / checkpoint selection**. A paper that says "training/testing 8:2 split" and then reports "validation mAP at epoch 48" should specify which of these the 0.956 number came from. Same set used for both early-stopping and final evaluation contaminates the test.

3. **Per-stratum performance breakdown**. If the corpus has known structural heterogeneity (terrain type, image vintage, urban vs rural, day vs night, magnification level, ...), per-stratum precision + recall should be reported. A single national mAP that combines flat-plains-wind-turbines with mountain-wind-turbines hides geometry-dependent biases.

4. **Sensitivity of any downstream system-level number** (in the Hu et al. 2026 case: the 99.88 TWh complementarity gain) against ±5% / −10% recall scenarios. This tests whether the system-level scientific claim is robust to plausible inventory errors.

### Empirical baseline (Hu et al. 2026 Nature, PKU+DAMO, 10.1038/s41586-026-10570-z)

| Disclosure item | Status |
|---|---|
| Validation mAP / mIoU | ✓ Reported (0.956 wind, 0.85 PV) |
| Production-time precision + recall | ✗ Not reported |
| Test set ≠ validation set | ✗ Unclear — described as one 8:2 split, possibly contaminated |
| Per-terrain / per-installation-type breakdown | ✗ Not reported |
| Recall sensitivity on the 99.88 TWh downstream result | ✗ Not reported |

The audit recorded this as Level 1 (`ai-detection-recall-confidence-not-disclosed.md`) — methodological transparency gap, not fabrication.

### When to escalate beyond Level 1

A missing disclosure of items (1)–(4) is Level 1 by default — it's bad practice but doesn't indicate misconduct. Escalate to Level 2+ only when:

- The headline count is presented as **exact** ("319,972 facilities") without any uncertainty hedging, AND
- The downstream scientific claim *materially depends* on this count being accurate, AND
- An external comparator (e.g., official administrative statistics) shows the count is significantly off, AND
- The supplement contains language implying calibration to the external comparator (which would conflict with an independent-detection claim).

If only the first two of these are true, stay at Level 1 — overclaim of precision, not misconduct.

## Variance-reporting consistency (Check 5 from 02-numerical-evidence.md)

This check is **as applicable to ML papers as to biology papers** and is the primary mechanism for catching ML-paper overclaims. See `references/02-numerical-evidence.md` Check 5 for the full recipe and the BERT NSP-overclaim empirical baseline.

In ML papers the pattern is especially common: ablation tables (one number per cell, single seed) sit alongside main-result tables (5-restart-averaged) within the same paper. Body claims about sub-1-pp ablation effects, where the ablation table did not bother to restart-average, are the strongest finding class for ML papers.

## What is NOT an arithmetic-track finding

Things that look like findings but are not:

- **Selective reporting of the higher of two scores.** E.g., abstract reports MNLI matched (86.7) but not mismatched (85.9). This is convention in ML and not auditable from the paper alone.
- **Implicit comparators.** E.g., BERT §4.2 says "+1.3 F1 as a single system" without naming the comparator. The +1.3 matches QANet's published single F1 (90.5) — implicit but arithmetically clean. Note it as a sub-finding; do not promote to Level 1.
- **Quoted competitor numbers that the auditor cannot cross-check.** Out of scope; record as a limitation in `audit_report.md` §7 rather than as a finding.
- **The paper not running the optimal experiment.** That is a logical-track finding (see `references/03-logical-evidence.md`), not an arithmetic-track one.

## Recording format

Per-finding format is identical to `references/02-numerical-evidence.md` (Paper / Locations / Source artefact references / What was observed / Recomputation arithmetic / Why this should not happen / Requested raw data / Level).

The arithmetic-track `_clean.md` should be a flat table of all claims re-derived. The BERT audit's `findings/numerical/_clean.md` is a working template.

The biology-sweepers `_inapplicable.md` should list which sweepers were considered and why none apply.

## Anti-patterns

- ✗ Running biology sweepers on ML data and reporting "Mode A fired 0 sheets" as a `_clean.md` line. Mode A had nothing to sweep; that is not "clean", it is "did not apply".
- ✗ Treating implicit comparators ("the top leaderboard system") as a finding when the arithmetic in fact resolves cleanly against published competitor numbers.
- ✗ Cross-leaderboard verification as a primary numerical track. Use it as defense-in-depth; the primary track is within-paper arithmetic re-derivation.
- ✗ Skipping Check 5 (variance-reporting) for ML papers. This is where the largest-effect findings live.
