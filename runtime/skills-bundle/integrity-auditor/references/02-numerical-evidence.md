# Numerical Evidence — What to Check and How to Record It

## What this track audits

Numbers in a paper carry the load of every quantitative claim: means, SDs, SEMs, n, P values, effect sizes, model metrics. Numerical findings are stronger than image findings because they are recomputable from raw data and consistent with one another by simple arithmetic. The auditor's job is to find inconsistencies between what is reported and what the raw data or internal references support.

The auditor records observations and the arithmetic that produced them. The auditor does **not** declare fabrication; it records "the reported SD of 0.34 is inconsistent with mean 5.7 and n=4 given the visible spread in the source data".

## The four checks

### Check 1 — Within-paper consistency

For every numeric claim, find every other place it appears (body text, figure caption, table cell, supplement, methods section). Mismatches between locations are flags.

**Sub-check 1.7: cross-XLSX same-quantity aggregate consistency.** When a paper ships multiple XLSX source-data tables, the same aggregate quantity (provincial / national / cohort total) often appears in two or more of them, sometimes computed at different stages of the analysis pipeline. If they disagree by a small systematic margin with all per-entity deltas the same sign, the discrepancy is informative — it implies a scoping or filtering difference between pipelines that the supplement should document.

Use `forensics_tools/xlsx_aggregate_consistency.py`:

```bash
python forensics_tools/xlsx_aggregate_consistency.py \
    $RUN/supplementary/*.xlsx \
    --tol-low 0.001 --tol-high 0.05 --entity-overlap 0.5 \
    > $RUN/findings/numerical/_xlsx_aggregate_consistency_sweep.txt
```

For each candidate column-pair (different files / sheets), the script requires:
- Same unit family AND same unit factor (e.g., both columns in TWh, not TWh vs GWh — that's Check 1.6's job)
- Entity-value sets overlap ≥ 50% (default; configurable)
- Relative sum diff strictly between `--tol-low` (0.1%) and `--tol-high` (5%) — outside this range the columns are either exact-match (no finding) or different metrics (no comparison)
- Header semantic-token overlap ≥ 1 non-unit non-stopword (relaxed when either header is "generic", e.g. `total_TWh` or `annual_load_TWh`)

Flagged pairs are sorted with `[SYSTEMATIC — all same sign]` first (highest-confidence: indicates scoping difference, not random noise).

Empirical baseline: Hu et al. 2026 Nature paper (10.1038/s41586-026-10570-z) — MOESM3 Fig1c `total_TWh` sum = 1110.78 vs MOESM6 Fig4a `annual_solar_wind_generation_TWh` sum = 1103.89, 0.62% diff, all 31 matched provinces same positive sign. The sweeper catches this as a single SYSTEMATIC flag.

**Sub-check 1.6: supplement-text vs source-data XLSX magnitude / unit consistency.** When a paper has both prose-tabulated values in a supplementary PDF AND a source-data XLSX, the prose may carry unit-labeling errors (TWh where GWh is meant, etc.) that the XLSX does not. Cross-reference the two.

Use `forensics_tools/magnitude_consistency.py`:

```bash
# Basic invocation
python forensics_tools/magnitude_consistency.py \
    --text $RUN/supplementary/MOESM*.txt \
    --xlsx $RUN/supplementary/MOESM*.xlsx \
    --min-value 100 --top-k 1 \
    --bilingual-map forensics_tools/bilingual_cn_geography.json \
    > $RUN/findings/numerical/_magnitude_consistency_sweep.txt
```

The sweeper outputs two flag types:
- **UNIT-CONFUSION FLAG** — text and XLSX header units differ (same family, different power of 10), but the literal numeric values match within 1%. Strongest signal — flags a likely 10× / 100× / 1000× labeling error.
- **SCALE-MISMATCH FLAG** — text value and XLSX value differ by a clean factor of 10 / 100 / 1000 and an entity (county / province / named entity) appears in both contexts. Weaker; flags a transcription factor-of-10 drift.

Hits tagged `(entity-overlap)` carry the highest confidence; the bilingual map enables cross-language matching for Chinese / English papers (Chinese row labels vs English transliterations in supplementary text).

Empirical baseline: Hu et al. 2026 Nature paper (10.1038/s41586-026-10570-z) `MOESM1` Supplementary Note 5 + Table 7 + `MOESM2` reviewer-response Table all reported per-county wind generation as "TWh" while the source data MOESM3 `wind_generation_GWh` column was in GWh. Tongyu County is the canonical example: text "exceeding 2,900 TWh yr⁻¹", XLSX value 2916.07 GWh, implied 1000× unit error. The skill's v1.5 sweepers did not catch this class; v1.6 `magnitude_consistency.py` catches it directly (top hit with entity-overlap tag).

Anti-pattern: do not pass the script all numbers (`--min-value 1`) — it will produce voluminous noise from coincidental 10× pairs. Use `--min-value 100` and `--top-k 1` for clean reports.

**Sub-check 1.5: cross-cell last-N-decimal matching.** Independent biological measurements have last-N-decimals approximately uniform on `{00..99}` (for N=2). A signature class that contains many cells holding **distinct** values is fabrication evidence — it implies the values were generated from a small seed set + arithmetic, or hand-typed from a memorized template, rather than independently measured.

Use `forensics_tools/decimal_match.py`:

```bash
# Strict default: each value's natural precision must equal display precision (2dp).
# Filters out integer-equivalents and float-noise tails (e.g., 0.666...).
# Also filters out literal value duplication (handled by Check 1.2 row-dup, not this check).
python forensics_tools/decimal_match.py \
    $RUN/supplementary/*.xlsx \
    --digits 2 --min-class 8 --min-distinct 6 --ratio 3.0 \
    | tee $RUN/findings/numerical/_decimal_match_sweep.txt

# Cross-sheet variant for the "ED Fig 6B + ED Fig 6C" pattern where one fabrication
# spans multiple sub-figures of one Extended Data figure:
python forensics_tools/decimal_match.py \
    $RUN/supplementary/MOESM13_ESM.xlsx \
    --digits 2 --min-class 8 --min-distinct 6 --ratio 3.0 --cross-sheet
```

Empirical baseline: the Kang Tiebang RAB22A osteosarcoma paper (10.1038/s41556-020-0522-z) whistleblower report identified "64 data points in ED Fig 6B and 6C have identical last two decimals". The skill's v1.4 numerical sweepers did not catch this class; the v1.5 `decimal_match.py` is designed to catch it. Threshold tuning is paper-dependent — for confirmation, try both `--digits 2` (last 2 decimals match) and `--digits 3` (last 3 decimals match, narrower), and both strict (default) and `--lax` (1dp values displayed at 2dp).

The check is structurally orthogonal to:
- Check 1.1 (deterministic column-pair): catches within-row additive `A − B = const` relationships
- Check 1.2 (row-duplicate): catches multi-numeric row copy-paste
- Check 1.3 (perfect correlation): catches multiplicative / affine column relationships
- Check 3.1/3.2 (last-digit distribution): catches *per-digit* distribution skew on the rightmost digit; 1.5 catches *cross-cell pattern repetition* across N digits

Run all five; they catch disjoint fabrication classes.

**Sub-check 1.4: column precision-inconsistency.** Real measurement instruments produce values at one fixed precision. A column where most values are 1 dp and a minority are 2 dp (or vice versa) usually means the data was assembled from heterogeneous sources or was re-typed at different times. Recipe:

```python
import openpyxl
def precision_distribution(ws, col):
    """Return Counter of decimal-place counts across numeric values in this column."""
    from collections import Counter
    dp_counts = Counter()
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, col).value
        if isinstance(v, (int, float)):
            # Detect natural displayed precision via repr (avoid float-noise tail)
            s = repr(v)
            if '.' in s:
                # Cap at 4 dp; anything beyond is float-representation noise
                dp = min(len(s.split('.')[1].rstrip('0')), 4)
            else:
                dp = 0
            dp_counts[dp] += 1
    return dp_counts

# Flag any column with n >= 30 where two different precisions each have share ≥ 10%.
```

This catches the Wang Ping tumor-weight pattern from a different angle than Mode B above: instead of "many zeros at forced 2dp", it directly counts how many values are stored to 1 dp vs 2 dp vs more.

**Sub-check 1.3: perfect column correlation.** Independent biological measurements should not have correlation 1.000 across paired rows. A pair of columns with Pearson r = 1.0 (to floating-point precision) over n ≥ 5 rows is fabrication evidence even when the difference is not constant.

```python
import math
def pearson(xs, ys):
    n = len(xs)
    if n < 2: return None
    mx, my = sum(xs)/n, sum(ys)/n
    sx2 = sum((x-mx)**2 for x in xs)
    sy2 = sum((y-my)**2 for y in ys)
    sxy = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    denom = math.sqrt(sx2 * sy2)
    return sxy / denom if denom else None
# For every column pair with >= 5 paired numerics, compute r.
# Flag if abs(r) > 0.99999 (10-decimal precision).
```

(The deterministic-difference sweep in 1.1 catches additive relationships; the perfect-correlation sweep here catches multiplicative / affine relationships that 1.1 misses.)

**Sub-check 1.2: row-duplicate sweep over source-data sheets.** Independent biological samples should not have rows that are byte-identical to other rows. Replicate fabrication by copy-paste is detectable as duplicate rows.

```python
import openpyxl
def duplicate_rows(ws, min_row_len=4):
    """Return list of (row_a, row_b, content) for byte-identical numeric rows."""
    seen = {}
    dups = []
    for r in range(1, ws.max_row + 1):
        row = tuple(ws.cell(r, c).value for c in range(1, ws.max_column + 1))
        # Only care about rows with at least min_row_len numeric values
        numeric = [v for v in row if isinstance(v, (int, float))]
        if len(numeric) < min_row_len:
            continue
        key = tuple(numeric)
        if key in seen:
            dups.append((seen[key], r, key))
        else:
            seen[key] = r
    return dups
# Flag any sheet with ≥ 1 dup of rows containing ≥ 4 numerics.
```

A small number of duplicate rows can be legitimate (technical-replicate averaging). A repeated multi-value row across "different" biological samples is a flag — request the lab notebook entries that produced each row.

**Sub-check 1.1: deterministic column-pair sweep over source-data sheets.** Independent biological measurements never produce a *constant difference* between two columns across all rows. Sweep every `Source Data Fig.*` and `Source Data ED Fig.*` sheet for column pairs where `max(|diff − median(diff)|) < 1e-9` across paired numeric rows:

```python
# Single-recipe sweeper — apply to every xlsx in supplementary/
import openpyxl, itertools, collections
def deterministic_pairs(ws, min_n=10):
    col_vals = collections.defaultdict(dict)
    for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        for c_idx, v in enumerate(row, start=1):
            if isinstance(v, (int, float)):
                col_vals[c_idx][r_idx] = v
    hits = []
    for i, j in itertools.combinations(sorted(col_vals), 2):
        common = set(col_vals[i]) & set(col_vals[j])
        if len(common) < min_n: continue
        diffs = [col_vals[i][r] - col_vals[j][r] for r in common]
        med = sum(diffs) / len(diffs)
        if abs(med) < 1e-9: continue  # identical column, skip
        if max(abs(d - med) for d in diffs) < 1e-9:
            hits.append((i, j, med, len(common)))
    return hits
```

Every hit must then be **manually verified** for sub-table layout — the same sheet often hosts multiple sub-panels stacked vertically with different column blocks, and the automatic sweeper cannot tell whether a paired-row hit reflects paired biological measurements within one sub-panel or coincident numerics across unrelated sub-panels. Confirmed paired hits (matching column headers under the same group label, contiguous data rows) are **Level 4** findings.

Empirical baseline: the Wang Ping 2025 Nature paper, MOESM7 `Source Data Fig.4`, has `col D − col E = 0.300` across all 35 rows under the `shHDAC6` group header `VR (0 h)` / `VR (24 h)`. This is the same anomaly publicly named by Geng (April 2026); the sweeper recipe above re-derives it from the open-access source-data file without any prior knowledge of the answer. Common patterns:

- body says `n=6`, figure caption says `n=3`
- methods says "three independent biological replicates", figure shows two
- abstract gives `P < 0.001`, results section gives `P = 0.04`
- table says mean ± SD, figure caption says mean ± SEM but the bar heights are identical

Use `grep` against `paper.txt`:

```bash
grep -nE "n ?= ?[0-9]+" paper.txt
grep -nE "P ?[<=>] ?0\.[0-9]+" paper.txt
grep -nE "mean ± (SD|SEM|s\.?e\.?m\.?)" paper.txt
```

Each mismatch becomes one `findings/numerical/<id>.md`.

### Check 2 — Recompute from source data

When source data (tables, .csv supplements, raw `results.json` for a local paper-writer slug) is available, recompute every headline statistic and compare:

- mean: `sum(values) / n`
- SD: `sqrt(sum((x - mean)^2) / (n - 1))`
- SEM: `SD / sqrt(n)`
- 95% CI: `mean ± t_{0.975, n-1} * SEM`
- effect size: by the specific formula (Cohen's d, Hedges' g, η²)
- P value: rerun the stated test (t-test / Mann-Whitney / ANOVA / χ²) — at minimum sanity-check the magnitude

For a local paper-writer slug audit, every metric reported in the paper must trace back to `output/experiment-suite/<slug>/latest/results.json`. Specifically check that:

- the paper's headline numbers appear in `summary.<method>.<metric>.{mean,std}` or in `runs[*]`
- the paper's claimed `n_seeds` matches `len(seeds)` in the results file
- the paper's `mode` claim (measured / simulated) matches `provenance.mode`

A paper that says "we measured X" but the linked `results.json` has `provenance.mode == "simulated"` is a Level 4 finding.

### Check 3 — GRIM and decimal-trail checks

GRIM (Granularity-Related Inconsistency of Means): the reported mean of integer measurements must be of the form `k/n` for some integer k and the reported n. If the paper reports `mean = 3.43, n = 7`, then `k = 24.01`, which is not an integer — flag it.

```python
# GRIM check
mean = 3.43
n = 7
k = mean * n
ok = abs(k - round(k)) < 1e-9
```

Decimal trail: when many measurements are recorded to two decimal places, the last digit should be roughly uniform on {0..9}. A heavy bias toward 0 and 5 suggests rounding to one decimal then padding. A heavy bias toward small digits (0-4) suggests truncation. Record the distribution, not just the suspicion.

**Sub-check 3.1: last-digit chi-square sweep over source-data sheets — TWO complementary modes.**

Two failure modes need different parsing rules. Always run BOTH passes; they detect different fabrication artefacts.

**Mode A — last-non-zero-digit (`rstrip` mode).** Detects when a single non-zero digit dominates the trailing position. Catches the Wang Ping Fig.4 / ED Fig.6 last-digit-5 pattern.

```python
import openpyxl, collections, glob
for f in sorted(glob.glob("supplementary/MOESM*.xlsx")):
    wb = openpyxl.load_workbook(f, data_only=True)
    for sn in wb.sheetnames:
        ws = wb[sn]
        ld = collections.Counter()
        for row in ws.iter_rows(values_only=True):
            for v in row:
                if isinstance(v, (int, float)):
                    s = f"{v:.10f}".rstrip('0').rstrip('.')
                    if '.' in s:
                        ld[int(s.split('.')[1][-1])] += 1
        n = sum(ld.values())
        if n >= 50:
            # Sample space is {1..9} (trailing 0 stripped); expected per digit = n/9
            exp = n / 9
            chi2 = sum((ld.get(d, 0) - exp) ** 2 / exp for d in range(1, 10))
            dom = max(ld, key=ld.get) if ld else None
            dom_frac = ld[dom] / n if dom is not None else 0
            print(f, sn, "mode-A", n, dict(ld), "chi2", round(chi2, 1), "dom", dom, f"{dom_frac:.1%}")
```

**Mode B — last-digit-at-displayed-precision (no rstrip).** Detects when many values are recorded at a coarser precision than the column's apparent precision — i.e., mixed-precision recording. Catches the Wang Ping Fig.5 / ED Fig.10 tumor-weight "last digit = 0" pattern.

```python
# Run per column, not per whole sheet, because precision is a column property
import openpyxl, collections
def column_dp_distribution(ws, col, force_dp=2):
    ld = collections.Counter()
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, col).value
        if isinstance(v, (int, float)):
            s = f"{v:.{force_dp}f}"
            ld[int(s[-1])] += 1
    return ld
# For each weight/intensity/count column, force_dp=2 (typical biology display).
# Flag if last-digit "0" share is ≥ 50% on a column with n ≥ 30.
# Flag if any single digit's share is ≥ 35% on n ≥ 30 at 2dp.
```

**Flag thresholds** (apply BOTH; raw χ² alone misleads at large n):

| Mode | Pattern | Threshold |
|---|---|---|
| A | dominant non-zero digit fraction | ≥ 0.20 (uniform expectation: 0.111) AND χ²(df=8) above α=0.001 critical (≈ 26.1) AND n ≥ 100 |
| B | digit "0" share at displayed precision | ≥ 0.50 on a column with n ≥ 30 (= column has mixed precision; > half values are at 1dp while column is displayed at 2dp) |
| B | any single digit's share | ≥ 0.35 at 2dp on n ≥ 30 (= column has a precision artefact other than 0-padding) |

When Mode A and Mode B both fire on the same paper across multiple sheets / columns, the deviation is too large for measurement noise / bounded-range artefact to explain.

Empirical baseline (Wang Ping 2025 Nature paper):

- Mode A flagged 5 sheets: Fig.4 / ED Fig.2 / ED Fig.6 / ED Fig.8 / ED Fig.10, dominant-non-zero fractions 22–35%.
- Mode B flagged 3 tumor-weight columns: `Fig.5 col 3` (88% zero at 2dp), `ED Fig.10 col 4` (69%), `ED Fig.10 col 8` (86%).

The Mode B finding (tumor-weight mixed precision) corresponds to the official institutional finding *"1 figure involved a mouse weight with the last digit being '0' and recording methods that were non-standard."* The v1 skill missed this because Mode B was not implemented; Mode A alone could not detect it (the rstrip step removes precisely the artefact Mode B is looking for).

### Check 3.2 — GRIM and decimal-trail integer-mean check

GRIM (Granularity-Related Inconsistency of Means): the reported mean of integer measurements must be of the form `k/n` for some integer k and the reported n. If a paper reports `mean = 3.43, n = 7`, then `k = 24.01` is not an integer — flag it.

Recipe:

```python
def grim_check(reported_mean, n, tol=1e-9):
    """Return True if reported_mean is consistent with mean of n integers."""
    k = reported_mean * n
    return abs(k - round(k)) < tol

# Apply only to columns whose values are obviously sums-of-integers
# (cell counts, foci counts, replicate counts). Do NOT apply to continuous
# measurements (weights, intensities, fluorescence) — GRIM is meaningless
# for those.
```

Use this on Western blot densitometry counts, γH2AX-positive cell percentages converted back to integer counts, animal counts in survival curves, etc. Pair with the figure caption's stated `n` to detect inconsistency.

### Check 5 — Variance-reporting consistency within the same paper

Real papers commonly mix two reporting styles: some tables show mean over N random restarts (or N biological replicates) with error bars; other tables show a single number per cell. The mix itself is not a problem. The problem is when a paper:

1. Reports restart-averaged numbers on Table X (caption says "averaged over 5 random restarts" or similar), AND
2. Reports single-cell numbers on Table Y (caption is silent on restarts), AND
3. Makes a body-text claim that hinges on a **sub-1-pp** delta within Table Y, AND
4. Uses strength-words like "significantly", "substantial", "consistent" to describe that delta.

This is over-claiming relative to the paper's own variance budget — the paper itself acknowledges (by averaging in Table X) that single-seed differences below the typical restart-spread are not robust.

**Recipe:**

```bash
# Step 1 — index every table caption with its variance-reporting language
grep -nE "^Table [0-9]+:" paper.txt | while read line; do
  # Extract the caption (table-caption ends at next blank line or next 'Table N:')
  # For each, check whether the caption mentions restarts / seeds / std
  echo "$line"
done

# Step 2 — for each table caption, regex-test for any of:
#   "average(d)?( Dev| over)? (\d+|five) (random )?restart"
#   "\d+ random restart"
#   "mean ± SD" / "mean ± SEM" / "± std"
#   "\d+ seeds"
#   "error bars"
# If MATCH: this table is "variance-reported".
# If NO MATCH: this table is "single-seed".

# Step 3 — for each body claim of form "X hurts Y significantly" or "X is significantly better than Y":
#   - locate which table it cites
#   - compute the delta from the cited table cells
#   - if (table is single-seed) AND (|delta| < 1.0 pp) AND ("significantly" used): FLAG
```

**Why this catches a real failure mode.** ML and biology papers both regularly run more controls than they report variance for; the gap between "tables we restart-averaged" and "tables we didn't" is itself a methodological signal. A paper that goes to the trouble of restart-averaging Table X clearly knows variance matters — silence about Table Y's variance, on a sub-noise-floor effect, becomes evidence about how much weight the body's "significantly" should carry.

**Empirical baseline (BERT, arXiv:1810.04805v2, 2026-05-25 audit):**

- Table 5 (NSP/MLM ablation): captions silent on restarts; cells are single-seed.
- Table 6 (model-size ablation): caption explicitly says "the average Dev Set accuracy from 5 random restarts of fine-tuning".
- Table 7 (NER): caption says "averaged over 5 random restarts using those hyperparameters".
- Body §5.1 claims removing NSP "hurts performance significantly on QNLI, MNLI, and SQuAD 1.1". From Table 5: QNLI drops 3.5 pp (real), MNLI drops 0.5 pp, SQuAD drops 0.6 pp.
- Trigger: single-seed table + sub-1-pp delta + "significantly" → flag. Result: `findings/numerical/section5-1-nsp-significance-overclaim.md` (Level 2). Externally corroborated post-publication by RoBERTa.

This check has no false-positive cost: a paper that reports its variance honestly does not trigger it. It only fires when reporting is internally asymmetric in a way that protects a particular claim.

### Check 4 — Benford's law (with caveats)

Benford's first-digit law (`P(d) = log10(1 + 1/d)`) applies to data spanning multiple orders of magnitude. It does **not** apply to:

- bounded measurements (e.g., percentages between 0 and 100)
- standardised scores
- single-experiment numerical outputs from a controlled system

Use Benford only on:

- multi-experiment effect sizes spanning multiple orders of magnitude
- large tables of raw measurements (counts, gene expressions, financial-style numbers)

When you do use it, report the χ² statistic and the sample size. A χ² of 30 on 1000 numbers means much more than the same statistic on 30 numbers. Do not declare a Benford violation as a finding on small samples.

## Recording format — one mismatch per file

`$RUN/findings/numerical/<short-id>.md`:

```markdown
# Finding: <one-line summary>

- Paper: <DOI or slug>
- Locations: §Results paragraph 2 (p. 5), Figure 3 caption (p. 7), Supplementary Table S2 (p. 14)
- Source artefact references:
  - paper.txt lines 412–414 (body)
  - paper.txt line 837 (caption)
  - supplement table S2 (PDF page 14)
  - For slug audits: results.json["summary"]["mlp"]["MSE"]

## What was observed

Body reports MSE = 89.34, n = 3 seeds. Figure 3 caption reports MSE = 89.35. results.json reports `summary.mlp.MSE.mean = 89.34869`. The figure-caption rounding is internally inconsistent.

## Arithmetic / recomputation

mean(reported runs) = (91.97 + 88.65 + 87.42) / 3 = 89.347, SD = 1.92, SEM = 1.11.
GRIM: k = 89.347 * 3 = 268.04 — not integer, but values are floats so GRIM doesn't apply.

## Why this should not happen

A two-decimal rounding mismatch between body and caption is a small flag; combined with the supplement, the three reported values should agree to two decimals.

## Requested raw data

- per-seed metric table (CSV / JSON) that produced the 89.34 figure
- random seeds used and their training logs (if available)

## Level (per 04-evidence-grading.md)

Level 1 (rounding inconsistency), unless the supplement diverges by > 1%, in which case Level 2.
```

## Recording absence of findings

If a full pass over all numbers turns up no inconsistencies, write `$RUN/findings/numerical/_clean.md`:

```markdown
# Numerical track — no anomalies after first-pass inspection

- Numeric claims indexed: <count>
- Recomputations performed: <count> (against source data / results.json)
- GRIM-applicable claims: <count> — all pass
- Benford-applicable tables: <count> — <result>
- Caveat: source data for <list> not available; recomputation limited to internal consistency.
```

## Heuristics worth knowing

- A paper that reports effect sizes to three decimal places with `n = 5` is suspicious not because the math is wrong but because three-decimal precision from five samples is overstated. Flag overstated precision as Level 1.
- "P < 0.05" is allowed; "P = 0.0000" is not (P is never exactly zero in floating-point output). If a paper reports `P = 0.0000`, ask for the exact value.
- A perfectly monotone trend across 6 conditions with all error bars not overlapping is suspicious in real biology / messy ML. Real experiments have noise. Flag, do not conclude.
- Bar charts with no underlying scatter or per-replicate dots hide variation. If the paper uses bars-only on `n ≤ 10` data, request the dot-plot version as Level 1.

## Anti-patterns

- ✗ Treating Benford as a universal test. It applies narrowly.
- ✗ Calling rounding mismatches "fabrication". Rounding bugs are Level 1.
- ✗ Recomputing without writing down the formula and the inputs.
- ✗ Ignoring the source data when it exists. If `experiment-suite/.../results.json` is in front of you, use it.
