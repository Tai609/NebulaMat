# Survey Figures Playbook

## Why this exists

A research paper's figures tend to be experimental: tables of numbers, training curves, confusion matrices. A survey's figures are *organisational*: how is the field structured, when did things happen, who works on what. They are how a reader navigates the survey. Without good figures a survey is a long list of references; with them it becomes a map.

**Target:** **6–10 justified figures** selected from these families:

- taxonomy / classification diagram when the literature has defensible branches;
- chronological timeline when chronology explains a transition;
- area / capability matrix when comparable coverage data exists;
- architecture / mechanism diagram when a shared mechanism needs explanation;
- quantitative trend plot when extracted data supports it;
- paradigm comparison, citation network, or geographic / institutional map when
  that relationship is itself part of the analysis.

Never create a figure only to reach the target count.

### Publication-medium gate

- Use matplotlib/seaborn for extracted quantitative evidence, purpose-built
  TikZ/SVG/PDF for a taxonomy or mechanism, and scientific image panels only
  with source and processing provenance.
- Do not deliver Mermaid, PlantUML, generic flowchart/mind-map output,
  diagram-editor screenshots, or notebook/UI screenshots as survey figures.
  Graphviz is acceptable only when the graph itself is analysed data, such as a
  citation network.
- Do not use decorative roadmaps, funnels, icon collages, or stock process
  diagrams. A figure must expose evidence, structure, or mechanism.

## Design figures for THIS research — aim at the Nature/Science bar

Two real failures this playbook used to cause. Read both before you draw anything.

**1. Template leakage (the worst over-fitting).** The worked examples below were written about *time-series Transformers*. A real "open-source LLM" survey produced from this playbook shipped a taxonomy whose leaves were `Informer`, `Autoformer`, `PatchTST`, `iTransformer`, `Moirai` — time-series forecasting models, completely off-topic — because the agent copied the *sample's content*, not just its shape. **Every code block here is a worked example of a principle, never content to reuse.** Replace 100% of the labels, branches, palette, and composition with what *your* topic and *your* gathered papers actually require. If a reader could guess which sample you started from, you over-templated. The figure should look like it was designed for this survey and no other.

**2. Generic look.** Default LaTeX/matplotlib output (Computer Modern *serif*, boxed axes, rainbow colours, one chart per figure) reads as a class assignment, not a journal. The target is **Nature / Science**: figures that are *designed*, not decorated.

### What "Nature/Science" concretely means (not vibes)

- **A figure is a composition, not a lone chart.** Top journals compose multi-panel figures (**a**, **b**, **c** …), each panel one sub-claim, together telling one story. Use `subfigure` / matplotlib `subplots`, with **bold lowercase panel labels in the top-left corner** of each panel.
- **Sans-serif type.** Helvetica/Arial (both installed here), ~7 pt floor — never Computer Modern serif. matplotlib: `font.family:"sans-serif"`. TikZ/LaTeX diagrams: `\usepackage[scaled]{helvet}\renewcommand{\familydefault}{\sfdefault}` (or set the figure's nodes to `\sffamily`).
- **Restrained, colour-blind-safe colour that *encodes something*.** Use the Wong palette (the one *Nature* recommends): `#000000 #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7`. For ordinal data use a single-hue sequential map (`Blues`), never rainbow/`jet`. ≤ ~5 hues per figure; colour must mean something, not decorate.
- **Maximise data-ink.** Despine top + right; ticks short and outward; axis lines ~0.6 pt; no gridlines (or very faint); **direct-label lines** instead of a legend box where possible. Banned: 3-D, pie charts, drop shadows, gradients, raster screenshots.
- **Exact sizing.** *Nature* column width = **89 mm** single (≈ 3.5 in), **183 mm** double (≈ 7.2 in). Set matplotlib `figsize` to these in inches; in this single-column A4 template include at `width=\linewidth`.
- **The caption states a finding.** Bold "Figure N." + one declarative sentence giving the takeaway, then detail. Not "Taxonomy of methods." but "Open-source LLM research splits into four lineages that diverge after the 2024 MoE shift."

### Nature-style matplotlib preamble — use this everywhere instead of the old serif block

```python
import matplotlib as mpl
WONG = ["#000000","#E69F00","#56B4E9","#009E73","#F0E442","#0072B2","#D55E00","#CC79A7"]
LINE_COLORS = [WONG[5],WONG[6],WONG[3],WONG[7],WONG[2],WONG[1]]
mpl.rcParams.update({
    "font.family":"sans-serif", "font.sans-serif":["Helvetica","Arial","DejaVu Sans"],
    "font.size":7, "axes.labelsize":7, "axes.titlesize":7,
    "xtick.labelsize":7, "ytick.labelsize":7, "legend.fontsize":7,
    "axes.linewidth":0.6, "axes.spines.top":False, "axes.spines.right":False,
    "xtick.direction":"out", "ytick.direction":"out",
    "xtick.major.size":2.5, "ytick.major.size":2.5,
    "xtick.major.width":0.6, "ytick.major.width":0.6,
    "axes.grid":False, "lines.linewidth":1.2, "lines.markersize":3.5,
    "savefig.dpi":400, "savefig.bbox":"tight", "pdf.fonttype":42, "ps.fonttype":42,
    "axes.prop_cycle": mpl.cycler(color=LINE_COLORS),
})
# figsize: single column = (89/25.4, h); double column / 2-panel = (183/25.4, h)
```

### The design process — this is where flexibility lives

Templates are rigid because they answer "what figure exists?" Design answers "what does *this* survey need to show?" For each figure, decide from scratch:

1. **What claim in this section must the reader *see* to believe it?** No claim → no figure (cut it; decoration fails the Nature bar).
2. **What is the shape of that evidence?** hierarchy → tree (`forest`); change over time → timeline / line; coverage or comparison → matrix / small-multiples; mechanism → schematic; distribution → strip/box. Let the data shape pick the form — don't force every survey into taxonomy+timeline+matrix.
3. **What is the most reductive form that still makes the point?** One well-composed panel beats a busy one; merge weak figures, split overloaded ones.
4. **Compose** with the Nature language above, then apply the mechanical floor below (vector, `forest`/`\resizebox`, zero overflow/overlap).

Steps 1–3 change with every topic — that is the flexible craft. The mechanical floor (next section) never changes.

## Fitting & overflow — the mechanical floor (read BEFORE drawing any figure)

Most "ugly survey PDF" problems are not bad taste, they are **figures that overrun the column or overlap themselves** because the source used hand-tuned absolute sizes (`sibling distance=42mm`, `figsize=(7,…)`) that happen not to fit. The fix is to never hand-tune for fit — let the figure *adapt* to the available width.

**Know your column width first.** This template is **single-column** `article` on A4 with 1-inch margins → text width ≈ **159 mm (≈ 6.2 in)**. (`\documentclass{article}` is single-column; `figure*` does **not** widen anything here — it only spans columns in a genuinely two-column class such as IEEEtran. Don't reach for `figure*` to "get more room"; you don't have a second column.)

**There are two different failure modes, and they need two different fixes. Confusing them is why the old taxonomy sample both ran off the page _and_ overlapped.**

### Failure A — figure wider than the column (runs off the right margin)

Fix: wrap the picture so its *rendered width* is clamped.

- **TikZ:** wrap in `\resizebox{\linewidth}{!}{ … }`.
- **Includes:** always `\includegraphics[width=\linewidth]{…}` (or `0.85–0.95\linewidth`), never a bare `\includegraphics{file}`. matplotlib `figsize` then only sets aspect ratio; keep its width ≤ 6.2 in so in-figure fonts aren't double-shrunk.

```latex
\begin{figure}[htbp]
  \centering
  \resizebox{\linewidth}{!}{%
    \begin{tikzpicture}[ ... ] ... \end{tikzpicture}%
  }
  \caption{...}\label{fig:...}
\end{figure}
```

### Failure B — nodes overlapping each other (the real "ugly" problem)

**`\resizebox` does NOT fix overlap.** It scales the *whole* picture uniformly, so two boxes that overlap at natural size still overlap after shrinking — you just get a smaller tangle. Overlap comes from hand-picked spacing (`sibling distance=42mm`) where adjacent sub-trees are wider than the gap between them. The fixes, in order of preference:

1. **Use a layout engine that auto-spaces — `\usepackage{forest}`.** Forest computes sibling positions so children never collide, for any branch/leaf count. This is the default for taxonomies now (see Family 1). It removes the whole class of "magic mm that happens to overlap".
2. **Pick orientation by size.** Few leaves (≲ 12) → top-down reads well. Many leaves → grow the tree **horizontally** (`grow'=east`) so leaves stack down the page (vertical space is plentiful, horizontal isn't).
3. **Fold.** If one figure still can't hold it legibly, split a branch into its own sub-figure.

Then apply Failure-A's `\resizebox` on top as a width backstop. Order matters: forest (or real spacing) removes overlap; resizebox only then trims width.

The quality gate (`05-quality-gate.md` G1 + S5) treats residual `Overfull \hbox` as a remediation loop, and reminds you that a figure shrunk to illegibility is *not* a pass — fold it instead.

### Failure C — timeline labels colliding (matplotlib, not TikZ)

This is the *other* recurring overlap complaint, and `forest`/`resizebox` don't touch it because it's not a TikZ figure. matplotlib text placed with a **fixed offset** (`xytext=(0, 12)`) has no idea where its neighbours are: two events close in year, or sharing a lane, land their label boxes on top of each other. Treat it like Failure B — the fix is spacing that *adapts*, not a bigger canvas or a bigger font.

1. **Merge co-located events into one label.** If two+ events share a year (and ideally a lane), don't emit two annotations — combine into one multi-line label (the worked example below already does this: `"MOMENT, Moirai\nTimeGPT, Chronos"`). Do this whenever step 3 below fires, not only when you happen to think of it up front.
2. **Reach for a label-repulsion library when deterministic staggering isn't enough.** This exact problem — text labels that must stay near their point but not touch their neighbours — already has a well-tested solution: R users solve it with `ggrepel`; the Python equivalent is `adjustText` (`pip install adjustText`, then `from adjustText import adjust_text`). It iteratively pushes overlapping labels apart and can draw a thin leader line back to the true point when it had to move one. The Family 2 code below tries the cheap deterministic stagger first (cycle through 2–3 offset heights for events close in x within a lane) and only calls `adjust_text` if a collision survives that — an already-clean layout is better left alone than perturbed further, and this keeps the script working even where `adjustText` isn't installed.
3. **Verify, don't eyeball — check actual rendered bounding boxes regardless of which placement method you used.** After drawing, call `fig.canvas.draw()`, get each label's `get_window_extent()`, and test pairwise overlap. Neither `adjustText` nor manual staggering *guarantees* zero overlap for an arbitrary event list — they reduce the odds, they don't prove the outcome — so the *script itself* still measures the actual render, the same way forest proves tree non-overlap by construction. The Family 2 code below does this and reports a concrete next step (merge or widen) when it finds a collision.
4. **Widen last.** Only if 2–3 pairs still collide after the above, widen `figsize` slightly.

### Failure D — tick labels and watermarks colliding (matplotlib/seaborn)

- **Categorical x tick labels:** long multi-word names rotated 45° *will* collide with their neighbours. Either shorten to ≤ 12 chars (expand in caption), wrap to two lines with `\n` and keep **horizontal** (never rotate multi-line labels), rotate only short single-line labels (`rotation=30, ha="right", rotation_mode="anchor"`), or flip to a horizontal bar chart (`ax.barh`) when names are sentences.
- **In-axes annotations / watermarks** (e.g., a SIMULATED marker): place via `transform=ax.transAxes` in a corner free of bars/lines/labels, `alpha≤0.5` — or state it in the caption instead of stamping pixels.
- **Self-check (required):** after writing each PDF, save a PNG sibling and **open and look at it**. Any text touching other text or data = regenerate.

## File layout

All figures land under `output/literature-survey/<slug>/survey_paper/figures/`. Use vector PDF for LaTeX (`.pdf`); keep a PNG sibling only for previewing. TikZ figures live inline inside the relevant `sections/*.tex` (no separate file needed). matplotlib / seaborn figures get a `make_fig_NN_<slug>.py` script alongside the PDF.

Naming: `fig_<NN>_<short-slug>.pdf`. Numbers correspond to citation order.

## Family 1 — Taxonomy / classification diagrams (TikZ)

Use this family when a defensible hierarchy is the survey's organising lens. A
taxonomy figure says: *here is how I cut the field*. Do not create one when the
literature is better organised by themes, evidence tiers, chronology, or another
structure.

### Setup

In `survey_paper/main.tex`:

```latex
\usepackage{tikz}
\usetikzlibrary{positioning, shapes.geometric, arrows.meta, fit, backgrounds, calc, trees}
\usepackage{forest}   % auto-spaced trees — taxonomies use this, NOT hand-built child{} trees
```

### Tree-style taxonomy — use `forest`, not hand-tuned `child{}` distances

> **Do not** build the taxonomy from a `tikzpicture` with `level/.style={sibling distance=42mm}` and nested `child{}` (the old sample here did exactly that). With more than ~3 leaves per branch, adjacent sub-trees are wider than the fixed gap and **the leaves overlap** — and because `\resizebox` scales the overlap too, you can't shrink your way out of it. `forest` computes sibling spacing automatically, so children never collide regardless of count.

**Flat, sans-serif, journal-style top-down (default; good up to ~12 leaves).** Define two colours once in `main.tex` (`\definecolor{nblue}{HTML}{0072B2}` and `\definecolor{nfill}{HTML}{EAF2FB}`, `\definecolor{ngrey}{HTML}{4D4D4D}`); thin uniform grey strokes + one accent + sans labels is the Nature diagram look — not the heavy blue/orange boxes the old sample used. **Replace every label with your own taxonomy.**

```latex
\begin{figure}[htbp]
  \centering
  \resizebox{\linewidth}{!}{%
  \begin{forest}
    for tree={font=\sffamily\small, draw=ngrey, line width=0.4pt, rounded corners=1pt,
              inner sep=3pt, align=center, edge={draw=ngrey, line width=0.4pt},
              l sep=7mm, s sep=3mm, parent anchor=south, child anchor=north}
    [Open-source LLMs, draw=nblue, line width=0.7pt, text=nblue
      [Architecture, fill=nfill, draw=nblue [Llama 3][Mistral][Qwen2]]
      [Sparse / MoE, fill=nfill, draw=nblue [DeepSeek][Mixtral][OLMoE]]
      [Alignment,    fill=nfill, draw=nblue [DPO][ORPO][KTO]]
      [Efficiency,   fill=nfill, draw=nblue [GPTQ][AWQ][QLoRA]]
    ]
  \end{forest}%
  }
  \caption{Open-source LLM research organises into four lineages. Each leaf cites its primary source; full coverage in Section~\ref{sec:methods}.}
  \label{fig:taxonomy}
\end{figure}
```

(`\sffamily` gives Helvetica when `main.tex` loads `\usepackage[scaled]{helvet}` — which the template now does — while body text stays serif, the standard journal split.)

**Horizontal / folder (use when there are many leaves — leaves stack down the page where there is room):** add `grow'=east, parent anchor=east, child anchor=west, anchor=west` to the `for tree={…}` options and switch `align=center`→`align=left`. This keeps labels full-size instead of shrinking them to fit one row. (Verified: a 5-branch / 20-leaf tree renders with zero overlap and zero overfull in both orientations; the same content as a hand-built `child{}` tree overflowed the page by 270 pt and merged half its leaves.)

### Layered / hierarchy diagram (when tree doesn't fit)

When the field has a layered structure (e.g., infrastructure → models → applications), use horizontal layers with `\node[fit=...]` to draw boundary boxes.

### Taste

- Color: one family per branch; orange for the row that contains your contribution if you have one.
- Leaves: 8–15 reads best top-down. With `forest` there is no hard cap (it won't overlap), but past ~15 switch to the horizontal orientation so labels stay full-size rather than shrinking; past ~24 fold into sub-figures.
- Always cite each leaf in the prose; the leaf names alone are not the survey, the citations are.
- Keep leaf text to a short model/method name (≤ ~3 words), not a paper title. `forest` guarantees siblings won't *overlap* regardless of text length, but a leaf holding a full title still reads as cramped and defeats the point of a taxonomy (fast scanning). If a name must wrap, let `align=center` wrap it at a `\\` you insert — don't fight forest's spacing by hand.

## Family 2 — Timeline of major works (matplotlib)

A survey timeline shows how the field evolved. Place key papers on a horizontal time axis with publication-year ticks.

```python
"""Generate fig_02_timeline.pdf — chronology of major works.
Pre-staggers labels deterministically, measures the actual rendered boxes,
and only escalates to adjustText (ggrepel's Python counterpart) if a
collision survives the pre-stagger. See Failure C for why the measurement
step runs either way."""
import os
import matplotlib.pyplot as plt
try:
    from adjustText import adjust_text
except ImportError:
    adjust_text = None

# Apply the Nature-style preamble from the top of this reference (sans-serif,
# Wong palette, despined, thin axes). Do NOT use font.family:"serif".

events = [
    # (year, lane, label, color) — co-located events are already MERGED
    # into one multi-line label (Failure C step 1), not stacked separately.
    (2017, 0, "Transformer\n(Vaswani)", "#1f77b4"),
    (2019, 0, "LogSparse",              "#1f77b4"),
    (2020, 0, "Reformer",                "#1f77b4"),
    (2021, 1, "Informer\nAutoformer",   "#ff7f0e"),
    (2022, 1, "FEDformer\nPyraformer",  "#ff7f0e"),
    (2022, 2, "RevIN",                   "#2ca02c"),
    (2023, 1, "PatchTST\nDLinear",       "#ff7f0e"),
    (2023, 3, "TimesNet\nTSMixer",       "#9467bd"),
    (2024, 1, "iTransformer\nTimeMixer", "#ff7f0e"),
    (2024, 4, "MOMENT, Moirai\nTimeGPT, Chronos", "#d62728"),
]

LANE_LABELS = {
    0: "Foundations",
    1: "Time-domain Trans.",
    2: "Normalisation",
    3: "MLP / 2D",
    4: "Foundation models",
}

LANE_Y = 2.2  # data-unit spacing between lanes — enough room that a
              # staggered 2-line label can't reach into the next lane
fig, ax = plt.subplots(figsize=(6.0, 5.4))   # width ≤ column (6.2in); include with width=\linewidth
years = [e[0] for e in events]
ax.set_xlim(min(years) - 0.5, max(years) + 0.5)
ax.set_ylim(-0.7 * LANE_Y, (max(LANE_LABELS) + 0.7) * LANE_Y)

# Pre-stagger events close together within the same lane.
OFFSETS, offset_by_index, by_lane = [8, 34, 60], {}, {}
for i, (year, lane, *_) in enumerate(events):
    by_lane.setdefault(lane, []).append((year, i))
for lane, items in by_lane.items():
    items.sort()
    last_year, cycle = None, 0
    for year, i in items:
        cycle = (cycle + 1) % len(OFFSETS) if (last_year is not None and year - last_year < 1.5) else 0
        offset_by_index[i] = OFFSETS[cycle]
        last_year = year

texts = []
for i, (year, lane, label, color) in enumerate(events):
    ax.scatter([year], [lane * LANE_Y], s=120, color=color, edgecolor="black", linewidth=0.5, zorder=3)
    t = ax.annotate(label, (year, lane * LANE_Y), xytext=(0, offset_by_index[i]), textcoords="offset points",
                     ha="center", fontsize=7.5, color="black")
    texts.append(t)

def find_collisions():
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    return [
        (texts[i].get_text(), texts[j].get_text())
        for i in range(len(texts)) for j in range(i + 1, len(texts))
        if texts[i].get_window_extent(renderer).overlaps(texts[j].get_window_extent(renderer))
    ]

# Escalate to adjustText only if the pre-stagger left a collision — an
# already-clean layout is better left alone than perturbed further. Either
# way this is a measurement, not a guess: neither pre-staggering nor
# adjustText proves zero overlap by construction the way forest does for
# trees, so the script checks the actual render instead of trusting either.
collisions = find_collisions()
if collisions and adjust_text is not None:
    # adjustText repels remaining overlaps; a thin grey leader line appears
    # automatically wherever it had to move a label off its point.
    adjust_text(texts, ax=ax, only_move={"text": "y", "static": "y"}, expand=(1.05, 1.2),
                arrowprops=dict(arrowstyle="-", color="grey", lw=0.4))
    collisions = find_collisions()

if collisions:
    raise SystemExit(
        f"{len(collisions)} label pair(s) still overlap: {collisions}\n"
        "Merge the colliding events into one label (Failure C step 1) or widen "
        "figsize slightly (step 4), then re-run."
    )

ax.set_yticks([k * LANE_Y for k in sorted(LANE_LABELS)])
ax.set_yticklabels([LANE_LABELS[k] for k in sorted(LANE_LABELS)])
ax.set_xlabel("Year")
ax.grid(True, axis="x", alpha=0.25)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

plt.tight_layout(pad=0.4)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fig_02_timeline.pdf")
plt.savefig(out)
plt.close(fig)
print(f"Wrote {out}")
```

### Taste

- Lanes carve the timeline into sub-areas (rows of the figure) — the same sub-areas as the taxonomy (Fig~\ref{fig:taxonomy}). Consistency helps readers connect the two.
- Annotate ~10–15 key works; more is clutter. Pick the works that defined the year, not every paper.
- Color matches taxonomy color so the reader can cross-reference.
- Adapt the collision-check block along with everything else — it's what lets you trust a new topic's event spacing without re-eyeballing the render yourself; the script tells you if it's safe to look away.

## Family 3 — Coverage matrix / capability heatmap (seaborn)

A survey often makes claims like "method X covers capabilities A, B but not C". A binary or three-level matrix makes that scannable.

```python
import os
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

methods = ["DLinear", "Informer", "Autoformer", "FEDformer",
           "PatchTST", "iTransformer", "TimeMixer",
           "MOMENT", "Moirai", "Chronos"]
caps = ["Long horizon", "Multivariate", "Probabilistic",
        "Zero-shot", "Efficient", "Interpretable"]

# 0 = no, 1 = partial, 2 = yes (illustrative — derive from your survey reading)
cov = np.array([
    [2, 1, 0, 0, 2, 1],   # DLinear
    [2, 1, 1, 0, 1, 0],   # Informer
    [2, 2, 1, 0, 1, 1],   # Autoformer
    [2, 2, 1, 0, 1, 1],   # FEDformer
    [2, 2, 0, 0, 2, 1],   # PatchTST
    [2, 2, 0, 0, 2, 0],   # iTransformer
    [2, 2, 0, 0, 2, 0],   # TimeMixer
    [2, 2, 1, 2, 1, 0],   # MOMENT
    [2, 2, 2, 2, 1, 0],   # Moirai
    [2, 2, 2, 2, 1, 0],   # Chronos
])

# Apply the Nature-style preamble from the top of this reference (sans-serif, despined).

fig, ax = plt.subplots(figsize=(5.6, 3.6))
sns.heatmap(cov, annot=False, cmap="Blues", vmin=0, vmax=2,
            xticklabels=caps, yticklabels=methods,
            linewidths=0.4, linecolor="white",
            cbar_kws={"label": "Coverage", "ticks": [0, 1, 2], "shrink": 0.6},
            ax=ax)
ax.set_xticklabels(ax.get_xticklabels(), rotation=30, ha="right")
ax.set_yticklabels(ax.get_yticklabels(), rotation=0)
plt.tight_layout(pad=0.4)
plt.savefig("fig_03_capability_matrix.pdf")
plt.close(fig)
```

### Taste

- 0/1/2 (no/partial/yes) is more readable than continuous numbers when the underlying judgement is qualitative.
- Annotate cells only if there are ≤ 60.
- Cmap: greens for "more is better" (coverage); avoid traffic-light reds in surveys.

## Family 4 — Architecture / mechanism diagrams (TikZ)

When a sub-area shares a common architectural pattern (e.g., "all decomposition Transformers do X then Y"), a single TikZ figure illustrating the canonical pipeline saves several pages of prose. See the `paper-writer` skill's `references/02-figures-publication-grade.md` § Family 1 for the full template.

For a survey, prefer **abstracted** architectural diagrams that show the pattern shared by a family of methods, not one specific method.

## Family 5 — Quantitative trends (matplotlib)

Examples that work in a survey:
- Number of papers per year (publication trend)
- Reported MSE on a single benchmark over time (the SOTA curve)
- Compute requirements over time (size/cost trend)

These earn their place when they reveal something the prose can't. A "papers per year" plot that just goes up linearly is decoration; if it reveals a plateau, an inflection, or a divergence between sub-areas, it's content.

## Family 6 — Optional advanced

- **Citation co-occurrence network**: dot/network plot showing which papers cite each other (use NetworkX → matplotlib). Powerful when the field has clear clusters.
- **Geographic / institutional map**: world map with author affiliations marked. Niche but illuminating for cross-cultural fields.
- **Paradigm comparison**: side-by-side architectural sketches (multi-panel TikZ).

## No default figures

This skill has no default figure (unlike experiment-suite). All figures are agent-generated.

## Quick checklist

- [ ] **Designed for THIS topic** — zero labels/leaves/data carried over from the worked examples (no `Informer`/`PatchTST`/time-series content in a non-time-series survey)
- [ ] Each figure earns its place by making a specific claim visible (design process step 1)
- [ ] Nature/Science look: sans-serif labels, Wong palette / single-hue sequential, despined axes, direct labels, multi-panel with **a**/**b** where it tells one story
- [ ] matplotlib uses the sans-serif Nature preamble (not `font.family:"serif"`); `figsize` at 89 mm / 183 mm
- [ ] Caption leads with a one-sentence finding, not a noun phrase
- [ ] Taxonomy built with `forest` (auto-spaced), NOT hand-tuned `sibling distance` + `child{}` — no overlapping leaves
- [ ] Timeline script includes the Failure C collision check (`get_window_extent` overlap test on the actual rendered labels) — not just fixed-offset `annotate()`
- [ ] Every TikZ/forest figure wrapped in `\resizebox{\linewidth}{!}{…}` as a width backstop (after spacing is correct, not instead of it)
- [ ] Every `\includegraphics` has `width=…\linewidth`; matplotlib `figsize` width ≤ 6.2 in
- [ ] No `figure*` used to "gain width" (single-column template); many-leaf trees go horizontal / fold, not squashed
- [ ] Every selected figure family is justified by the topic; no mandatory trio or filler
- [ ] No Mermaid, PlantUML, generic flowchart/mind-map, or editor/UI screenshot
- [ ] 6–10 figures total
- [ ] All figure files are vector PDF; fonts embedded (`pdf.fonttype=42`)
- [ ] Each figure referenced in prose with `\ref{fig:...}`
- [ ] Each caption stands alone (a reader who only sees the figure understands it)
- [ ] No 3-D bars, no pie charts, no rainbow palettes, no raster screenshots
