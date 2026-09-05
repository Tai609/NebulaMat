---
name: paper-writer
description: Use when the user wants a complete, publication-grade research paper on a specific topic — produces 200+ real citations, 4–8 publication-grade figures, and 7 sections of substantive prose compiled to PDF in one pass. No skeleton stage.
---

# Paper Writer

## Overview

End-to-end research paper builder. **Single stage, full quality from the start** — there is no skeleton phase to enrich later. The agent (Claude Code / Cursor / Aider / Codex / …) does the writing using its own tools (WebFetch, WebSearch, Write, Bash). This skill has no Python runtime; it is purely a procedure + reference playbooks + a LaTeX template.

The substantive work is decomposed into reference playbooks under `references/`:

| Reference | Topic |
|---|---|
| `references/00-incremental-execution.md` | how to actually do this without losing work: batch sizes, persistence, resume — **read first** |
| `references/01-bibliography-expansion.md` | grow `bibliography.bib` to 200+ real entries via WebFetch/WebSearch |
| `references/02-figures-publication-grade.md` | TikZ / matplotlib / seaborn / multi-panel figure recipes |
| `references/03-section-playbook.md` | per-section structure, length, citation density |
| `references/04-layout-discipline.md` | tables, figures, floats, cross-refs, author + disclosure footnote |
| `references/05-quality-gate.md` | self-check before delivery (G1–G8 hard, S1–S4 soft) |
| `references/06-experiment-provenance.md` | honest provenance for every number (measured / simulated / illustrative) |

**Read the relevant reference _before_ writing, not after.**

The full pass does not fit in a single turn. The bibliography is built across ~20+ small WebFetch/WebSearch batches; sections are drafted one per turn; figures are generated one at a time. **Read `references/00-incremental-execution.md` before starting** — it is the only execution mode that actually completes without losing work.

## When to Use

- User asks to "write a paper" on a specific topic.
- User wants Abstract + Introduction + Related Work + Method + Experiment + Results + Conclusion.
- User has experiment results (a `results.json`) and wants them formatted into a paper.

## When NOT to Use

- User wants only a literature survey → the `literature-survey` skill.
- User wants only the experiment package → the `experiment-suite` skill.
- User wants only direction/topic exploration → the `research-explorer` skill.
- User wants the full multi-skill pipeline → the `ai4s-agent` skill (which invokes this skill as one stage).

## Workflow

### Step 1 — Understand requirements

Confirm with the user:

- **Topic** — specific enough to motivate a title; if too broad, narrow it before proceeding.
- **Experiment provenance** — measured (user supplied a `results.json` produced by the `experiment-suite` skill or compatible) or simulated. Default is simulated; in that case the disclosure footnote must flag it (see `references/06-experiment-provenance.md`).
- **Language** — default Chinese in conversation; the paper itself is English unless the user requests otherwise.

Always tell the user that human review by a domain expert is recommended before any scientific publication or production use.

### Step 2 — Set up the run directory

Create a timestamped working directory and copy the template. Runs never overwrite each other.

```bash
TOPIC="<topic>"
SLUG=$(python3 -c "import re,hashlib,sys; t=sys.argv[1]; n=re.sub(r'[\\s_]+','-',re.sub(r'[^\\w\\s-]','',t.lower().strip())).strip('-')[:40].rstrip('-'); h=hashlib.sha1(t.encode()).hexdigest()[:8]; print(f'{n}-{h}')" "$TOPIC")
TS=$(date +%Y-%m-%d_%H%M%S)
RUN=output/paper-writer/$SLUG/$TS/paper

mkdir -p "$RUN/sections" "$RUN/figures"
cp -r templates/paper/. "$RUN/"
ln -sfn "$TS" "output/paper-writer/$SLUG/latest"
```

In commands below `$RUN` = `output/paper-writer/<slug>/latest/paper`.

The template provides only `main.tex` (title placeholder), an empty `sections/` skeleton, an empty `figures/`, and `compile.sh`. Everything substantive is produced in Step 3 below.

### Step 3 — Build the paper (REQUIRED — this is the whole job)

Open `references/00-incremental-execution.md` first. Then carry out the five tracks below across many turns, persisting state to `$RUN/` after every batch.

#### 3.1 Bibliography — 200+ real entries

**Open:** `references/01-bibliography-expansion.md`.

First choose and record the temporal profile from that reference. AI4S and
similarly fast-moving fields default to at least 60% of references from the
current calendar year and previous two years; an explicitly recent window uses
the stricter recency-led profile. Then plan 15–25 query angles. For each angle:
WebSearch → pick candidates → WebFetch each candidate's abstract / arXiv API
URL → extract canonical title/authors/year/venue/url → append a BibTeX entry to
`$RUN/bibliography.bib`. **Every entry must originate from a URL fetched in
this session.** Memory entries are forbidden.

**Hard stop:** do not draft prose until the bibliography has ≥ 200 entries,
contains no `unknown` keys, and passes
`check_bibliography_freshness.py` for the recorded profile.

#### 3.2 Figures — 4–8 publication-grade

**Open:** `references/02-figures-publication-grade.md`.

Decide what the paper needs based on its claims and evidence:

- Architecture / pipeline diagram only when the paper introduces or compares a
  real method whose mechanism needs explanation.
- Quantitative comparison plots when measured or explicitly simulated results
  support them.
- Heatmap / multi-panel ablation only when the data justifies it.

Generate each figure into `$RUN/figures/`. Save the matplotlib / TikZ source alongside the PDF so each figure is reproducible. If the experiment-suite produced a `figures/manifest.json`, **reuse those figures by symlink or copy** — don't redraw what's already produced.

#### 3.3 Sections — 7 substantive .tex files

**Open:** `references/03-section-playbook.md`.

Draft each section per its playbook (length, structure, citation density, equation requirements, anti-patterns). Cite real entries from the bib built in 3.1.

**Order:** introduction → related_work → method → experiment → results → conclusion → **abstract last** (you only know the paper's shape after writing the rest).

#### 3.4 Layout discipline

**Open:** `references/04-layout-discipline.md`.

- Put each figure or table in the section whose prose first introduces or
  interprets it, immediately after that paragraph in the source. Do not collect
  artifacts in a fixed section or force one float placement across the paper.
- Wrap tables and figures in standard LaTeX floats with standalone captions;
  choose `[htbp]`, `[tbp]`, or `[p]` from the artifact's size and narrative role.
- Use `~\cite{}` and `~\ref{}` (non-breaking space).
- Let LaTeX assign citation, figure, table, equation, section, and algorithm
  numbers from 1 in first-appearance order. Never type display numbers manually.
- Set `\author{AI4S Agent}` and attach a `\thanks` footnote that **always** recommends human review, and **additionally** flags simulated numerics when applicable.

#### 3.5 Compile + quality gate

```bash
cd "$RUN"
pdflatex -interaction=nonstopmode main.tex
bibtex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex
```

**Open:** `references/05-quality-gate.md`.

Run all G1–G8 hard gates and S1–S4 soft gates. If a hard gate fails, fix and re-run; do not ship a paper that fails G1–G4. If you cannot honestly clear a gate (e.g., bibliography stalled at 156 entries because the topic is niche), say so explicitly instead of padding.

### Step 4 — Deliver

Report to the user:

1. `output/paper-writer/<slug>/latest/paper/main.pdf` — final PDF.
2. `output/paper-writer/<slug>/latest/paper/` — complete LaTeX project (reproducible).
3. Stats per the report format in `references/05-quality-gate.md` (pages, bib size, total `\cite{}`, figure count, table count, provenance, compile warnings).

## Cross-skill data flow (path convention)

If a sibling skill has already run for the same topic, **reuse its outputs by path**:

- `output/literature-survey/<slug>/latest/bibliography.bib` → seed `$RUN/bibliography.bib` (still bring it up to 200+ in 3.1 with WebFetch).
- `output/experiment-suite/<slug>/latest/results.json` → the source of the numbers cited in 3.3 / 3.5; its `simulated` flag controls the disclosure clause in 3.4.
- `output/experiment-suite/<slug>/latest/figures/*.pdf` (+ `manifest.json`) → reuse in 3.2 rather than redrawing.

The slug formula in Step 2 is the contract; all four skills compute the same slug for the same topic.

## Important rules

- **No LLM SDK in this skill.** No `import anthropic` / `import openai`. The agent runs the procedure; the skill is just SKILL.md + references + template.
- **No fabricated citations.** Every BibTeX entry must trace back to a URL fetched this session. Real or weaker claim — never fake reference.
- **Simulated numbers stay visibly labelled.** Title `\thanks` + abstract disclosure paragraph + per-caption disclosure. Do not let the simulated label disappear during drafting.
- **Honest stop > padding.** If the topic is too niche for 200+ real citations, say so to the user instead of inventing entries.
- **Real-paper scope** is 8–14 pages with 200+ references. For workshop / blog format, adjust scope explicitly with the user up front.
