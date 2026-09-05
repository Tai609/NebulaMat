# Logical Evidence — What to Check and How to Record It

## What this track audits

Even if every image is real and every number is accurate, a paper can still be wrong because the experiments do not actually support the conclusion. This is the reviewer's last line. The auditor reads each headline claim, compresses it to a causal chain, and asks whether the experiments exercise every link.

The auditor does not say "the conclusion is wrong". The auditor records "to support claim C, the paper needs experiment E, which is missing / underpowered / lacks control X".

## The compression rule

Compress every headline claim into one sentence of the form:

> A through B causes C (in setting S).

Examples:

- "Protein X expression through pathway Y causes tumour suppression (in mouse xenografts of cell line Z)."
- "Hierarchy-aware adapters through reduced parameter count cause better held-out replicate transfer (on scPerturb DatlingerBock2021 single-cell perturbation regression)."
- "Forecasting transformer architecture through cross-horizon attention causes lower MASE than baselines (on M5 retail demand horizon-7)."

Write the compressed sentences into `$RUN/findings/logical/_claims.md` first. Then check each one.

## The five checks

### Check 1 — Is A actually measured?

The claim names a manipulated or measured variable A. Does the paper directly observe A change? A study claiming "Protein X drives Y" without a panel showing X levels going up under the intervention is missing the most basic step.

### Check 2 — Is B actually the mechanism shown?

B is the proposed mechanism. The paper needs a positive result implicating B, not just correlation. Mechanism evidence looks like:

- rescue experiment (knock down B, then restore B, see C come back)
- pharmacological blockade of B (use a drug against B, see C disappear)
- genetic ablation of B (KO mouse, KD line)
- dose response (more B → more C, less B → less C, in a quantitative way)

If the paper has only correlation between A and C, downgrade the claim — the paper supports "A correlates with C", not "A through B causes C".

### Check 3 — Are the controls present?

For each experimental panel, list controls expected by the experiment class:

- Western blot: loading control, secondary-only negative control
- knockdown: scrambled siRNA control, untreated control, off-target check
- in vivo treatment: vehicle control, dose-matched comparator
- model comparison (ML): at least one strong baseline, ideally one prior-art baseline from the cited literature

A missing control is a finding. Severity depends on the centrality of the panel to the conclusion.

### Check 4 — Is the sample size honest about the conclusion?

A claim of "general mechanism" is not supported by `n = 3` mice / `n = 3` cell lines / `n = 1` patient sample. Record:

- the conclusion's stated generality (gene → disease, model → benchmark, drug → patient)
- the actual n at every relevant level (biological replicate, technical replicate, independent experiment)
- whether the paper's discussion language matches that n

A paper that says "we demonstrate" or "we establish" from `n = 3` is over-claiming. Flag it.

### Check 4.5 — Correction-vs-concern-scope mismatch

When a paper has issued an Author Correction and public / institutional concerns are also on the record, compare the **scope** of the two documents. A correction that addresses one or two figure-preparation errors while public peer discussion or institutional review has identified a broader pattern is itself a logical-track finding — the disclosure does not match the concern.

This check is auditable from **public records alone** and does not require access to the article PDF:

- Crossref metadata for the parent DOI lists every `updated-by` entry (corrections, expressions of concern, retractions). Pull each.
- Download the correction PDF (often open access on the publisher's CDN — see `references/02a-supplement-acquisition.md`).
- Extract its text and enumerate every figure / panel the correction names.
- Compare against the institutional finding or the public concern documentation (PubPeer thread, news reporting, journal Expression of Concern).
- A correction that names ≤ 30% of the figures publicly identified as problematic is at minimum **Level 2** — clear disclosure-completeness deviation, internal evidence sufficient.

Empirical baseline: Wang Ping 2025 Nature paper. Author Correction (DOI `10.1038/s41586-025-09409-w`) names Fig. 2f / Ext Fig. 7k / Ext Fig. 10e — three image-preparation errors. Institutional finding (Tongji 2026-05) identified 14 of 15 figures with problems including the +0.3 column anomaly in Fig.4c. Scope ratio: 3 / 14 ≈ 21%. This is a Level 2 finding from public records alone.

A correction that issues *after* institutional misconduct review and matches its full scope is fine. A correction that issues *before* and is narrower than the review's eventual finding is a flag. The timing relative to public PubPeer activity matters: corrections that pre-date public concern can be benign; corrections issued during active public scrutiny that fail to address widely-discussed concerns are not.

### Check 5 — Is the protocol reproducible?

For each experimental method, check that the paper supplies:

- antibody catalogue number / clone (for biology)
- exact model weights / random seeds / hyperparameters (for ML)
- dataset version + access path (for data analysis) — for a local paper-writer slug, cross-check against `output/experiment-suite/<slug>/latest/data_contract.md`
- statistical test, software, and version used for P values
- exclusion criteria (which samples were removed and why)

A paper whose method cannot be reproduced by another lab is a Level 2 finding — the auditor is not asserting falsehood, only that the evidence is incomplete.

## Recording format — one gap per file

`$RUN/findings/logical/<short-id>.md`:

```markdown
# Finding: <one-line summary>

- Paper: <DOI or slug>
- Headline claim: "<compressed A → B → C sentence>"
- Location of claim: Abstract sentence 3; §Discussion para 1 (p. 9)
- Relevant experiments: Figure 3 (rescue), Figure 5 (KO), Methods §2.3

## Gap observed

The paper claims B is the mechanism but the rescue experiment in Figure 3 uses only `n = 4` mice and the rescue effect is not statistically distinguishable from baseline (overlapping 95% CIs in the source data). Without the rescue, the chain is A correlates with C, not A through B causes C.

## What additional evidence would close the gap

- Larger-n rescue (n ≥ 8 per arm) or independent replication
- Pharmacological blockade of B with appropriate vehicle control
- Dose-response panel for B

## Severity considerations

If the headline claim is central to the abstract and discussion (it is, here), the gap is a Level 3 finding (cannot be resolved without additional evidence). If the claim were a secondary observation, Level 1–2.

## Level (per 04-evidence-grading.md)

Level 3 — needs additional experiments or raw data to disambiguate causation from correlation.
```

## Recording absence of findings

```markdown
# Logical track — no major gaps after first-pass inspection

- Headline claims compressed: <count>
- For each, A measured: yes/yes/yes
- For each, B mechanism shown: yes (rescue), yes (KO+dose), yes (ablation)
- Controls present in central panels: yes
- Sample sizes match claim language: yes
- Method reproducibility: <yes / partial / lists what is missing>
```

## Local paper-writer slug audits get extra leverage

When `output/experiment-suite/<slug>/latest/` is available:

- `results.json` has per-seed entries — verify the paper's claimed `n_seeds` matches.
- `data_contract.md` has split protocol — verify the paper's claimed split matches.
- `data_contract.md` has reproducibility boundary ("this run is a pilot, not a full benchmark") — verify the paper does not over-claim.

A paper that calls a pilot a "comprehensive benchmark" is a Level 2 finding, regardless of figure / number correctness.

## Anti-patterns

- ✗ Reading the paper top-to-bottom without compressing claims. The compression is the work.
- ✗ Calling a missing control "wrong" — call it "incomplete evidence for the claim as stated".
- ✗ Demanding controls the field never uses. Match expectations to discipline norms.
- ✗ Reading any single missing detail (e.g., antibody catalogue number) as a fatal flaw — these are common journal-format issues; cluster them into one Level 1 "reproducibility cluster" finding instead of N separate findings.
