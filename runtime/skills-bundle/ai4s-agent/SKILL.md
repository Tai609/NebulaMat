---
name: ai4s-agent
description: Use when the user wants an end-to-end AI4S research pipeline — broad direction or specific topic in, full research package out (exploration + literature survey + experiment + paper). Meta-skill that chains the four downstream skills in order. Pure markdown, no Python runtime.
---

# AI4S Agent (meta-skill)

## Overview

Top-level entry point for the AI4S research stack. This skill contains **no work of its own** — its only job is to call four downstream skills in the right order, with the right slug, and reuse intermediate artifacts by path convention.

```
direction → research-explorer → topic
topic     → literature-survey  (60+ real bib, 100+ recommended)
topic     → experiment-suite   (design + code + results + figures)
topic     → paper-writer       (assembles into 200+ cite PDF)
```

Each downstream skill is **already single-stage and self-sufficient**: its agent loads that skill's `SKILL.md` and produces the full final-quality artifact directly. There is no skeleton/enrichment split. This meta-skill only handles ordering, the path convention, and disclosure consistency.

## When to use

- User asks for "a paper on X" or "research package on X" and wants the whole stack run end to end.
- User wants to compare what each skill produces — useful for developing or debugging the pipeline itself.

## When NOT to use

- User wants to run only one stage (e.g. only the literature survey) → invoke that skill directly.
- User wants only topic exploration → invoke `research-explorer` directly.

## The slug contract

Every skill computes the same slug from the same topic string:

```python
import re, hashlib
def slug(t):
    n = re.sub(r'[\s_]+', '-', re.sub(r'[^\w\s-]', '', t.lower().strip())).strip('-')[:40].rstrip('-')
    h = hashlib.sha1(t.encode()).hexdigest()[:8]
    return f"{n}-{h}"
```

Use the **same string** across all four skills. If the user provides a direction (not a topic), `research-explorer` runs against the direction; once a topic is chosen, the topic becomes the slug input for the remaining three.

## Workflow

### Step 1 — Understand the user's starting point

- **Direction** ("transformer time series forecasting") — start at `research-explorer`, pick a topic from its `research_exploration.md`, then proceed.
- **Topic** ("Transformer-based long-horizon forecasting with patch tokenisation") — skip `research-explorer`; go straight to the parallel branch (literature-survey, experiment-suite, paper-writer).
- **Real measured experiment data?** If yes, the user supplies a `results.json` path; experiment-suite loads it instead of writing a simulated one, and the paper's `\thanks` drops the simulated clause.

### Step 2 — Explore (only if input was a direction)

Load the `research-explorer` skill. Follow its 5 steps to produce:

```
output/research-explorer/<dir_slug>/latest/{research_exploration.md, topic_matrix.md, literature_pre_survey.md}
```

Discuss the candidate topics with the user. They pick one specific topic; that string becomes `$TOPIC` for the rest.

### Step 3 — Literature survey

Load the `literature-survey` skill with `$TOPIC`. It produces:

```
output/literature-survey/<topic_slug>/latest/survey_paper/
├── main.pdf                    # the 6–20 page survey
├── main.tex
├── bibliography.bib            # 60+ real entries, 100+ recommended (URL-anchored)
├── sections/, figures/
output/literature-survey/<topic_slug>/latest/literature_table.md
```

The survey bibliography must pass the temporal profile selected by
`literature-survey`; AI4S defaults to at least 60% from the current calendar
year and previous two years.

### Step 4 — Experiment package

Load the `experiment-suite` skill with `$TOPIC`. It produces:

```
output/experiment-suite/<topic_slug>/latest/
├── experiment_design.md
├── experiment/                  # runnable model.py / data.py / train.py / evaluate.py
├── results.json                 # with "simulated" + "provenance"
├── figures/                     # publication-grade + manifest.json (basenames only)
└── experiment_report.md
```

If a real results path was provided in Step 1, the agent loads it here and `results.json` is flagged `"simulated": false`.

### Step 5 — Paper

Load the `paper-writer` skill with `$TOPIC`. Its cross-skill conventions automatically pick up Steps 3 and 4:

- Seeds `bibliography.bib` from `output/literature-survey/<topic_slug>/latest/survey_paper/bibliography.bib`, then expands it to 200+ inside paper-writer if needed.
- Re-runs the paper-writer freshness gate after expansion; adding older
  foundational references must not silently make a fast-moving bibliography
  stale.
- Reads numbers and provenance from `output/experiment-suite/<topic_slug>/latest/results.json`.
- Copies/symlinks the publication-grade figures from `output/experiment-suite/<topic_slug>/latest/figures/`.

It produces:

```
output/paper-writer/<topic_slug>/latest/paper/
├── main.pdf                    # 8–14 pages, 200+ cites
├── main.tex
├── bibliography.bib
├── sections/, figures/
```

### Step 6 — Deliver

Report the four output roots to the user:

1. `output/research-explorer/<dir_slug>/latest/` (if exploration ran)
2. `output/literature-survey/<topic_slug>/latest/`
3. `output/experiment-suite/<topic_slug>/latest/`
4. `output/paper-writer/<topic_slug>/latest/`

Plus the paper-writer stats per its `references/05-quality-gate.md` report format.

## Disclosure consistency

The same `simulated` flag must drive disclosure across all four artifacts:

- `experiment-suite/.../results.json` → `"simulated": true|false` is the source of truth.
- `experiment-suite/.../experiment_report.md` top-of-page disclosure must match.
- `paper-writer/.../main.tex` `\author{AI4S Agent\thanks{…}}` must include the simulated clause iff `results.json` has `"simulated": true`.
- The always-on **human-review clause** is mandatory in every case.

## Rules

- **No LLM SDK in any skill, including this one.** Pure markdown — `SKILL.md` only.
- **One slug per topic, computed identically across skills.** The contract above is non-negotiable.
- **Never collapse the four skills into one agent run.** Each skill's `SKILL.md` is the single source of truth for what counts as "done" for its artifact.
- A non-interactive runner (e.g. `claude --print` headless) lives **outside** the skills. The skills stay pure.
