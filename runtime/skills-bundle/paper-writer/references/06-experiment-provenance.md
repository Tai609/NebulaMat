# Experiment Provenance — Honest Numbers, Not Plausible-Looking Ones

## Why this exists

A paper's tables and figures carry empirical claims. By default the `experiment-suite` skill produces a `results.json` whose numbers come from a deterministic simulator (plausible-shaped, fictional); it also generates a `train.py` the user can run on real data later. That's fine when honestly disclosed, catastrophic when treated as evidence. This reference defines the discipline.

> **Rule**: every quantitative claim in the paper must have a known provenance. The agent does not invent numbers; the simulator does not get conflated with real measurement; what wasn't run says so plainly.

## Provenance categories

| Category | What it means | When to use |
|---|---|---|
| **measured** | Number came from running real code on real data, recorded by the user | A reviewer could rerun the experiment and get a comparable number |
| **simulated** | Number came from the experiment-suite simulator (deterministic, seeded; plausible but fictional) | Default mode; no measured data attached |
| **illustrative** | Hand-written by the agent to convey shape (e.g. ablation deltas) | Avoid when possible. If used, must be disclosed inline. |

Every table cell, every figure data point, every reported scalar in prose belongs to one of these three.

## How to get measured numbers

The user runs the `experiment-suite` skill's generated `train.py` (or any compatible code) on real data, dumps the metrics to a JSON file in the same schema the simulator emits, and either:

1. **Points this skill at the file directly** — copy or symlink the file to `$RUN/results.json` and proceed.
2. **Runs experiment-suite first against measured data**, so `output/experiment-suite/<slug>/latest/results.json` is already flagged `"simulated": false` and `"provenance": "loaded from <path>"`; this skill then reads it via the cross-skill path convention.

The agent should proactively suggest path 1 or 2 whenever the user mentions they have (or could compute) real metrics. Otherwise the simulator output is what the paper reports, and the disclosure must reflect that.

## What the disclosure footnote must say

See `04-layout-discipline.md` for the full template. In short:

- **Always:** `Human review by a domain expert is strongly recommended before any scientific publication or production use.`
- **When `results.json` has `"simulated": true`:** add the simulated clause.
- **When `results.json` has `"simulated": false` and `"provenance": "loaded from ..."`:** drop the simulated clause; you may add `"Numerical results were measured by the user; the AI4S Agent only assembled the manuscript."` for full transparency.
- **When `results.json` has `"placeholder": true` (real-mode requested but no metrics provided):** the paper should not be considered complete. Either populate the metrics or fall back to simulated mode.

## Inline provenance markers

For tables and figures, prefer disclosure in the caption rather than only in the global thanks:

- Simulated: caption ends with "Numbers are simulated."
- Measured: caption may name the data source ("Three-seed mean on the released ETT split.").
- Illustrative: caption ends with "Illustrative; not a measurement." Avoid this category whenever possible.

The agent **must not** present simulated numbers under a measured caption. If you can't tell which mode produced a number, treat it as simulated and disclose accordingly.

## What NOT to do

- **Don't write plausible-looking ablation deltas off the top of your head.** If the simulator didn't produce ablation data, the ablation table is illustrative, and that must be in its caption.
- **Don't claim "three-seed mean" without three actual seeds.** Either run them, or pull the language out.
- **Don't drop the `simulated` watermark from a figure when only the surrounding text changes.** The watermark is the cell-level honesty; the prose is the prose-level honesty; both must agree.
- **Don't use bold/`\textbf{Ours}` to win a comparison whose other entries you also made up.** Bolding the best cell is a measured-context convention; in simulated mode it implies an empirical victory that didn't happen.

## Quick checklist

- [ ] Every table cell traceable to {measured, simulated, illustrative}
- [ ] Every figure traceable to {measured, simulated, illustrative}
- [ ] Captions match the cells (no measured-styled caption over simulated data)
- [ ] If `results.json` is simulated, the abstract and the title `\thanks` both say so
- [ ] If `results.json` is measured (loaded via `--real-results-path`), the simulated clause is removed and the human-review clause kept
- [ ] No "illustrative" entries without an inline caption disclosure
