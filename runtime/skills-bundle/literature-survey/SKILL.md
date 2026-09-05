---
name: literature-survey
description: Use when the user wants a comprehensive literature survey on a specific research topic. Outputs a complete PDF survey (6–20 pages, 60+ real citations, 100+ recommended) with LaTeX source, topic-specific publication figures, and a classified literature table. Single-stage, no Python runtime.
---

# Literature Survey

## Overview

End-to-end literature survey builder. **Single stage, full quality from the start.** The agent (Claude Code / Cursor / Aider / Codex / …) does the entire build using its own tools (WebFetch, WebSearch, Write, Bash). This SKILL is procedure + reference playbooks + LaTeX template — no Python runtime, no LLM SDK.

The substantive work is decomposed into reference playbooks under `references/`:

| Reference | Topic |
|---|---|
| `references/00-incremental-execution.md` | how to actually do this without losing work: batch sizes, persistence, resume — **read first** |
| `references/01-bibliography-expansion.md` | grow `bibliography.bib` to 60+ real entries (100+ recommended) via WebFetch (no memory) |
| `references/02-survey-figures.md` | taxonomy / timeline / coverage-matrix / area-map figures |
| `references/03-survey-section-playbook.md` | per-section structure for survey-shaped papers |
| `references/04-layout-discipline.md` | tables, figures, floats, cross-refs, author + disclosure footnote |
| `references/05-quality-gate.md` | self-check before delivery |

**Read the relevant reference _before_ writing, not after.** The full pass does not fit in a single turn — `references/00-incremental-execution.md` is the only execution mode that completes.

## When to Use

- User asks for a "survey" / "review" on a specific topic.
- User has a research topic and wants a structured map of the field with citations.
- User needs background reading curated for a thesis chapter or grant section.

## When NOT to Use

- User wants original research with experiments → `paper-writer`.
- User wants only an outline / topic exploration → `research-explorer`.
- User wants experiment code → `experiment-suite`.
- Topic is too broad (e.g., "all of AI") — narrow it before starting.

## Workflow

### Step 1 — Understand the topic and scope

Confirm with the user:

- **Topic** — specific research area (e.g., "federated learning in healthcare"). If too broad, narrow it first.
- **Scope** — broad survey of a field vs. focused review of a sub-area.
- **Citation budget** — minimum 60 unique entries; aim for 100+ (push higher for a broad survey).
- **Language** — default Chinese in conversation; the LaTeX paper is English unless requested otherwise.

Always tell the user that human review by a domain expert is recommended before publication or production use.

### Step 2 — Set up the run directory

```bash
TOPIC="<topic>"
SLUG=$(python3 -c "import re,hashlib,sys; t=sys.argv[1]; n=re.sub(r'[\\s_]+','-',re.sub(r'[^\\w\\s-]','',t.lower().strip())).strip('-')[:40].rstrip('-'); h=hashlib.sha1(t.encode()).hexdigest()[:8]; print(f'{n}-{h}')" "$TOPIC")
TS=$(date +%Y-%m-%d_%H%M%S)
RUN=output/literature-survey/$SLUG/$TS/survey_paper

mkdir -p "$RUN/sections" "$RUN/figures"
cp -r literature-survey/templates/survey/. "$RUN/"
ln -sfn "$TS" "output/literature-survey/$SLUG/latest"
```

In commands below `$RUN` = `output/literature-survey/<slug>/latest/survey_paper`.

### Step 3 — Build the survey (REQUIRED — this is the whole job)

Open `references/00-incremental-execution.md` first. Then carry out the five tracks below across many turns, persisting state to `$RUN/` after every batch.

#### 3.1 Bibliography — 60+ real entries (100+ recommended)

**Open:** `references/01-bibliography-expansion.md`.

**First (§0 of that reference): read the topic's temporal/scope intent and pick
a search posture.** AI4S and similarly fast-moving fields default to at least
60% of references from the current calendar year and previous two years. If
the topic names a year or says "latest/recent", use the stricter recency-led
profile. Historical/theoretical surveys retain a timeline-spanning exception.

Then plan **12–20** query angles, weighted by the posture. For each angle: WebSearch → triage → WebFetch each kept candidate's abstract URL → extract canonical title/authors/year/venue/url → append a BibTeX entry to `$RUN/bibliography.bib`. **Every entry must originate from a URL fetched in this session.** Memory entries forbidden.

**Hard stop:** do not draft prose until the bibliography has ≥ 60 entries
(100+ recommended) and passes `check_bibliography_freshness.py` for the
recorded profile.

#### 3.2 Figures — 6–10 survey-shaped

**Open:** `references/02-survey-figures.md`.

A survey is defined by how well it organises a field. Choose 6–10
topic-specific figures from the families that the evidence supports:

- taxonomy / classification diagram when the field has defensible branches;
- timeline when chronology explains a change in the field;
- area / capability matrix when comparable coverage data exists;
- architecture / mechanism diagram when a shared mechanism needs explanation;
- quantitative trend plots when extracted data supports them;
- citation network or paradigm comparison when the relationship itself matters.

Never force a family to fill a slot. Save each figure into `$RUN/figures/` with
reproducible source alongside.

#### 3.3 Sections — survey-shaped prose

**Open:** `references/03-survey-section-playbook.md`.

Survey sections differ in shape from research-paper sections. Order: introduction → background → methods (themed survey) → discussion → conclusion → related work → **abstract last**.

#### 3.4 Layout discipline

**Open:** `references/04-layout-discipline.md`.

Put each figure or table in the section whose prose first introduces or
interprets it, immediately after that paragraph in the source. Use standard
LaTeX floats with booktabs for tables and choose `[htbp]`, `[tbp]`, or `[p]`
from the artifact's size and narrative role; do not force a common position or
section. Use `~\cite{}` and `~\ref{}`. Let LaTeX assign citation, figure,
table, equation, and section numbers from 1 in first-appearance order; never
type display numbers manually. Set `\author{AI4S Agent}` with a `\thanks`
footnote that **always** recommends human review. Surveys carry no simulated
numerical experiments, so do **not** include a simulated clause.

#### 3.5 Compile + quality gate

```bash
cd "$RUN"
pdflatex -interaction=nonstopmode main.tex
bibtex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex
```

**Open:** `references/05-quality-gate.md`. Survey-specific targets: ≥ 60 bib
entries (100+ recommended), ≥ 6 pages, and only figures justified by the topic's
evidence.

If a gate cannot honestly be met (e.g., the field is genuinely small), say so explicitly. Do not pad.

### Step 4 — Deliver

Report:

1. `output/literature-survey/<slug>/latest/survey_paper/main.pdf`
2. `output/literature-survey/<slug>/latest/survey_paper/` — complete LaTeX project (reproducible)
3. `output/literature-survey/<slug>/latest/literature_table.md` — classified literature table (write this alongside the bib build)
4. Stats per the report format in `references/05-quality-gate.md`.

## Cross-skill data flow (path convention)

A downstream skill (e.g., `paper-writer`) computing the same slug for the same topic will look here:

- `output/literature-survey/<slug>/latest/survey_paper/bibliography.bib` — bib starting point.

## Important rules

- **No LLM SDK in this skill.** No `import anthropic` / `import openai`. The skill is SKILL.md + references + LaTeX template only.
- **No fabricated citations.** Every BibTeX entry must trace back to a URL fetched this session. Real or weaker claim — never fake reference.
- **Honest stop > padding.** If the field is too small for 60 real citations, say so to the user instead of inventing entries.
- **Survey scope** is 6–20 pages with 60–150 references (100+ recommended). For longer or shorter formats, adjust scope explicitly with the user up front.
