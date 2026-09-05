# Publication-Grade Figures Playbook

## Why this exists

Real research papers carry figures that make their claims easier to verify. If
the `experiment-suite` skill has already produced baseline figures for the same
topic, reuse them by symlink or copy; otherwise generate them here. This
reference explains how to produce each family at publication quality.

**Target:** 4–8 justified figures chosen from the families below. An
architecture / pipeline diagram is appropriate only when the paper introduces
or compares a real method whose mechanism needs explanation. Quantitative,
heatmap, multi-panel, radar, Sankey, or parallel-coordinate figures require data
that supports them. Never create a figure only to fill a slot.

**Taste rule:** every figure must answer a question the reader is asking at that point in the paper. Don't add a figure because the slot exists; add it because the prose hits a moment where readers need to *see* something.

### Publication-medium gate

- Use matplotlib/seaborn for quantitative evidence, purpose-built TikZ/SVG/PDF
  for a method schematic, and scientific image panels only with source, crop,
  scale, and processing provenance.
- Do not deliver Mermaid, PlantUML, generic flowchart/mind-map output,
  diagram-editor screenshots, or notebook/UI screenshots as paper figures.
  Graphviz is acceptable only when the graph itself is analysed data, not as a
  shortcut for a generic process diagram.
- Do not use decorative roadmaps, funnels, icon collages, or stock process
  diagrams. If a figure carries neither evidence nor mechanism, remove it.

## Aim at the Nature/Science bar — and design, don't copy

The code blocks below are **worked examples of principles, not templates to reuse.** Replace all of their content (labels, data, palette, structure) with what *your* paper needs; if a reader could tell which sample you started from, you over-templated. The visual target is *Nature / Science*, which is concrete:

- **Compose multi-panel figures** (**a**, **b**, **c**) where panels share a story; bold lowercase panel labels, top-left.
- **Sans-serif** labels (Helvetica/Arial, ~7 pt floor) — never Computer Modern serif. Set matplotlib `font.family:"sans-serif"`; for TikZ load `\usepackage[scaled]{helvet}` and use `\sffamily` in nodes.
- **Wong colour-blind-safe palette** `#000000 #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7`; single-hue sequential maps for ordinal data; no rainbow/`jet`; colour must encode, not decorate.
- **High data-ink:** despine top/right, ticks short+outward, axis lines ~0.6 pt, no/faint grid, direct-label series instead of a legend box. No 3-D, pie, shadows, gradients.
- **Exact sizing:** *Nature* single column = 89 mm (≈3.5 in), double = 183 mm (≈7.2 in); set `figsize` accordingly, include at `width=\linewidth`.
- **Captions state a finding** (bold "Figure N." + one declarative sentence), not a noun phrase.

Build each figure by deciding *what claim the reader must see*, then *what data-shape it is*, then the most reductive form — not by reaching for a stock chart.

## File layout

All figures land in `$RUN/figures/` (i.e., `output/paper-writer/<slug>/latest/paper/figures/`). Use vector PDF for LaTeX (`.pdf`) and keep a PNG sibling only if you also want to preview cheaply. If `output/experiment-suite/<slug>/latest/figures/manifest.json` exists, it's a useful index of upstream artefacts but not authoritative — what LaTeX sees is `\includegraphics{figures/<basename>}`, and the basename must exist locally inside `$RUN/figures/`.

Naming: `fig_<NN>_<short-slug>.pdf`. Numbers correspond to citation order in the paper.

## Family 1 — Architecture / pipeline diagrams (TikZ)

Use TikZ when the figure shows components and their connections (model architecture, data flow, training loop). TikZ is part of the LaTeX toolchain; the result is true vector, font-matched to the paper, no rasterization.

### Setup

In `main.tex`, ensure these are loaded (the existing template already includes the first; add the others as needed):

```latex
\usepackage{tikz}
\usetikzlibrary{positioning, shapes.geometric, arrows.meta, fit, backgrounds, calc}
\usepackage{forest}   % only if you draw a hierarchy/tree — auto-spaces siblings so they never overlap
```

If a figure is a **hierarchy or tree** (taxonomy, ablation tree, call graph), build it with `forest`, **not** a `tikzpicture` with hand-set `sibling distance` + nested `child{}`: fixed distances overlap once a node has more than ~3 children, and `\resizebox` can't separate overlapping nodes (it scales the overlap too). For flow/pipeline diagrams (the common case below) plain TikZ with `node distance` is fine.

### Standalone figure file

Create a semantically named source such as `figures/model_architecture.tex`.
Wrap the figure into a tikzpicture environment, save it as a standalone tex,
and either:

(a) `\input` it directly inside a `figure` float in the section whose prose
first explains the mechanism, immediately after that paragraph, OR
(b) compile it standalone via the `standalone` document class to a separate `.pdf` then `\includegraphics`.

Option (a) is simpler for one-off figures.

### Skeleton template

```latex
\begin{figure}[htbp]
  \centering
  \resizebox{\linewidth}{!}{%
  \begin{tikzpicture}[
    node distance=4mm and 6mm,
    every node/.style={font=\small},
    box/.style={draw, rounded corners=2pt, minimum height=7mm, minimum width=18mm,
                align=center, fill=blue!5},
    accent/.style={draw, rounded corners=2pt, minimum height=7mm, minimum width=18mm,
                   align=center, fill=orange!15},
    arrow/.style={-{Latex[length=2mm]}, semithick},
  ]
    \node[box] (input)  {Input \\ $\mathbf{X}_{1:L}$};
    \node[box, right=of input] (patch) {Patching \\ $P, S$};
    \node[box, right=of patch] (enc)   {Encoder \\ ($K$ blocks)};
    \node[accent, right=of enc] (head) {Decomp.\\head};
    \node[box, right=of head] (out)    {Forecast \\ $\hat{\mathbf{X}}_{L+1:L+H}$};

    \foreach \a/\b in {input/patch, patch/enc, enc/head, head/out}
      \draw[arrow] (\a) -- (\b);
  \end{tikzpicture}%
  }
  \caption{Overall architecture. The patched encoder operates on tokens of length $P$ with stride $S$; a lightweight decomposition head separates trend and seasonal components before the final projection.}
  \label{fig:architecture}
\end{figure}
```

### Taste

- Fill colors: stick to one family (e.g., `blue!5`, `blue!15`, `blue!25`) plus one accent (e.g., `orange!15`). Avoid rainbow.
- Arrows: `-{Latex[length=2mm]}` is clean. Don't mix arrow tips.
- Font: leave at `\small` so it matches caption font; never `\large` inside diagrams.
- Width: **always wrap the `tikzpicture` in `\resizebox{\linewidth}{!}{…}`** (not just "if it overflows"). This makes the diagram fit the column whatever its natural size, so node count / label length can never push it past the margin. If shrinking makes labels unreadable, simplify the diagram rather than relying on scale. Caveat: this template is single-column `article`, so `figure*` gains no width — don't use it for room.
- Whitespace: `node distance` of 4–6mm gives air without sprawl.

## Family 2 — Quantitative plots (matplotlib publication style)

Use matplotlib for line charts, bar charts, scatter plots, error bars. The default style is unsuitable; apply this rcParams baseline.

### Plot script template

Save as `output/paper-writer/<slug>/latest/paper/figures/make_fig_NN_<name>.py` so the figure is reproducible:

```python
"""Generate fig_NN_<name>.pdf — publication-grade matplotlib output."""
import matplotlib.pyplot as plt
import numpy as np

# Nature/Science style — sans-serif, despined, thin axes. Apply at top of every script.
import matplotlib as mpl
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 7,
    "axes.labelsize": 7,
    "axes.titlesize": 7,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 7,
    "axes.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False,
    "xtick.direction": "out", "ytick.direction": "out",
    "xtick.major.size": 2.5, "ytick.major.size": 2.5,
    "xtick.major.width": 0.6, "ytick.major.width": 0.6,
    "axes.grid": False,          # journals use little/no grid; add faint if truly needed
    "lines.linewidth": 1.2,
    "lines.markersize": 3.5,
    "savefig.dpi": 400,
    "savefig.bbox": "tight",
    "pdf.fonttype": 42,           # embed fonts properly
    "ps.fonttype": 42,
})

# Wong colour-blind-safe palette (Nature-recommended). Direct-label series; avoid legend boxes.
WONG = ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"]
# High-contrast order for marks on white; reserve yellow for fills or dark-edged marks.
COLORS = [WONG[5], WONG[6], WONG[3], WONG[7], WONG[2], WONG[1]]
# Nature column widths: single = 89/25.4 in, double = 183/25.4 in — set figsize from these.

# Data ---------------------------------------------------------------
horizons = [96, 192, 336, 720]
methods = {
    "DLinear":     [0.345, 0.380, 0.420, 0.498],
    "PatchTST":    [0.330, 0.358, 0.395, 0.469],
    "iTransformer":[0.328, 0.354, 0.392, 0.466],
    "Ours":        [0.319, 0.346, 0.385, 0.460],
}

# Plot ---------------------------------------------------------------
fig, ax = plt.subplots(figsize=(3.4, 2.4))   # column width on a 2-column page

for (name, vals), color in zip(methods.items(), COLORS):
    ax.plot(horizons, vals, marker="o", color=color, label=name)

ax.set_xlabel("Forecast horizon $H$")
ax.set_ylabel("MSE (lower is better)")
ax.set_xscale("log", base=2)
ax.set_xticks(horizons)
ax.set_xticklabels(horizons)
ax.legend(frameon=False, loc="upper left")
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

plt.tight_layout(pad=0.4)
plt.savefig("fig_02_horizon_sweep.pdf")
plt.close(fig)
```

Run: `cd output/paper-writer/<slug>/latest/paper/figures && python make_fig_02_horizon_sweep.py`.

### Sizing — column vs page width

A two-column manuscript:
- Column width plot: `figsize=(3.4, 2.4)` (inches), include with `\includegraphics[width=\linewidth]{...}` inside `\begin{figure}`.
- Page-wide plot: `figsize=(7.0, 2.6)`, use `\begin{figure*}[!t]` and `\includegraphics[width=\linewidth]{...}`.

A single-column manuscript (current default template):
- Column width plot: `figsize=(5.0, 3.2)`, include with `\includegraphics[width=0.85\linewidth]{...}`.
- Wider plot: `figsize=(6.5, 3.0)`.

### Taste

- Remove top/right spines (`ax.spines["top"].set_visible(False)`).
- Grid below data, low alpha (`grid.alpha=0.25`).
- Markers only when comparing few series; omit when 3+ series clutter.
- Legend without box (`frameon=False`); place where it doesn't overlap data.
- Color: explicit palette, never the matplotlib default (gives orange/blue/green that are perceptually uneven).
- Embed fonts: `pdf.fonttype=42` and `ps.fonttype=42` ensure the PDF doesn't have Type 3 font issues at submission.
- Avoid 3-D bars, drop shadows, gradient fills. None of these belong in a research paper.

### Text collision rules (mandatory)

Overlapping text is the most common defect in generated figures. Rules:

- **Categorical x tick labels:** long multi-word category names rotated 45° *will* collide with their neighbours. Pick one:
  - shorten each label to ≤ 12 characters (`No lattice feedback` → `No lattice`, expand in the caption), keep horizontal;
  - wrap to two lines with `\n` (`textwrap.fill(label, 10)`), keep **horizontal** — never rotate multi-line labels;
  - rotate only short single-line labels: `rotation=30, ha="right", rotation_mode="anchor"`;
  - or flip to a **horizontal bar chart** (`ax.barh`) — the right answer when category names are sentences.
- **In-axes annotations / watermarks** (e.g., a SIMULATED marker): place with `ax.text(..., transform=ax.transAxes)` in a corner that holds no bars, lines, or labels; `alpha≤0.5`; check it against the actual data extent. Prefer stating simulation in the caption/`\thanks` over stamping pixels (see "Reusing an experiment-suite baseline figure").
- **Direct labels on dense data:** if ≥ 6 series/points need labels, label only the extremes or move detail to a table; nudge labels apart manually — matplotlib does not auto-avoid collisions.
- **Self-check (required):** after writing each PDF, also save a PNG sibling (`plt.savefig("....png", dpi=200)`) and **open and look at it** before accepting the figure. Any text touching other text or data = regenerate with the rules above. Delete the PNG afterwards if you don't want it shipped.

## Family 3 — Heatmaps & confusion-style tables (seaborn)

Use seaborn for confusion matrices, attention maps, dataset × method MSE grids, ablation surfaces.

```python
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

# Apply the sans-serif Nature preamble from Family 2 above (do NOT use font.family:"serif").

datasets = ["ETTh1", "ETTh2", "ETTm1", "ETTm2", "ECL", "Traffic", "Weather"]
methods  = ["DLinear", "Informer", "Autoformer", "FEDformer",
            "PatchTST", "iTrans", "Ours"]
# One row per dataset, one column per method — shape must be (len(datasets), len(methods)).
mse = np.array([
    [0.380, 0.495, 0.421, 0.401, 0.366, 0.359, 0.354],  # ETTh1
    [0.394, 0.523, 0.439, 0.411, 0.371, 0.364, 0.358],  # ETTh2
    [0.352, 0.470, 0.402, 0.388, 0.349, 0.342, 0.337],  # ETTm1
    [0.361, 0.481, 0.410, 0.395, 0.356, 0.349, 0.343],  # ETTm2
    [0.310, 0.428, 0.365, 0.351, 0.318, 0.312, 0.305],  # ECL
    [0.402, 0.512, 0.447, 0.430, 0.389, 0.381, 0.372],  # Traffic
    [0.335, 0.452, 0.388, 0.374, 0.339, 0.331, 0.324],  # Weather
])
assert mse.shape == (len(datasets), len(methods)), "row/column count must match the labels"

fig, ax = plt.subplots(figsize=(4.4, 3.2))
sns.heatmap(
    mse, annot=True, fmt=".3f",
    xticklabels=methods, yticklabels=datasets,
    cmap="RdYlGn_r",                # red = worse, green = better; reversed so low MSE=green
    cbar_kws={"label": "MSE", "shrink": 0.8},
    annot_kws={"size": 7},
    linewidths=0.4, linecolor="white",
    ax=ax,
)
ax.set_xticklabels(ax.get_xticklabels(), rotation=30, ha="right")
plt.tight_layout(pad=0.4)
plt.savefig("fig_03_method_x_dataset_heatmap.pdf")
plt.close(fig)
```

### Taste

- Cmap: `RdYlGn_r` for "lower=better" metrics (MSE/MAE/error rate), `viridis` for "higher=better" (accuracy/F1), `coolwarm` for diverging (e.g., relative improvement vs. baseline).
- Annotate cells only when there are ≤ 70 cells; beyond that the text becomes noise.
- Set tick rotation to keep labels readable.
- Cell borders white at 0.4pt — separates cells without dominating.
- **Known trap: `annot=True` can silently annotate only the first row.** This is a real `seaborn==0.12.x` + recent-matplotlib incompatibility, not a script error — it produces a heatmap that saves without any exception, so nothing in the compile/gate pipeline catches it, only looking at the render does. If you see numbers on row 1 only, `pip show seaborn` and upgrade (`pip install -U seaborn`, tested working on `0.13.2`) rather than debugging your own data or annot_kws — the array and call were fine.

## Family 4 — Multi-panel & advanced

When one figure can't carry the message, use multi-panel layouts. Common patterns:

### 2×2 panel (matplotlib)

```python
import numpy as np
import matplotlib.pyplot as plt
# Apply the sans-serif Nature preamble from Family 2 above.

panels = [
    ("Loss curve", np.linspace(1.2, 0.3, 50) + np.random.normal(0, 0.02, 50)),
    ("Ablation: no decomp head", np.linspace(1.3, 0.42, 50) + np.random.normal(0, 0.02, 50)),
    ("Ablation: no patching", np.linspace(1.25, 0.47, 50) + np.random.normal(0, 0.02, 50)),
    ("Full model", np.linspace(1.2, 0.28, 50) + np.random.normal(0, 0.02, 50)),
]

fig, axes = plt.subplots(2, 2, figsize=(6.8, 4.8), sharex=True)
for ax, (title, data) in zip(axes.flat, panels):
    ax.plot(data)
    ax.set_title(title)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

# Subplot labels (a)(b)(c)(d) at top-left of each
for ax, label in zip(axes.flat, "abcd"):
    ax.text(-0.12, 1.02, f"({label})", transform=ax.transAxes,
            fontweight="bold", fontsize=10)

plt.tight_layout(pad=0.4)
```

### Radar (polar projection)

```python
import numpy as np, matplotlib.pyplot as plt
labels = ["MSE", "MAE", "Speed", "Memory", "Robustness"]
angles = np.linspace(0, 2*np.pi, len(labels), endpoint=False).tolist()
angles += angles[:1]

fig, ax = plt.subplots(figsize=(3.4, 3.4), subplot_kw=dict(polar=True))
for name, vals, color in zip(["Ours", "PatchTST"],
                             [[0.85, 0.83, 0.78, 0.81, 0.79],
                              [0.82, 0.80, 0.75, 0.78, 0.76]],
                             ["#1f77b4", "#ff7f0e"]):
    v = vals + vals[:1]
    ax.plot(angles, v, color=color, label=name, linewidth=1.4)
    ax.fill(angles, v, color=color, alpha=0.12)

ax.set_xticks(angles[:-1]); ax.set_xticklabels(labels)
ax.set_ylim(0.6, 0.95)
ax.legend(loc="lower right", bbox_to_anchor=(1.2, -0.05), frameon=False)
plt.tight_layout(pad=0.2)
plt.savefig("fig_05_radar.pdf")
```

Use radar **only** when 4–7 axes are conceptually comparable on the same scale (normalized scores, percentages). Don't radar-plot raw MSE next to throughput in QPS — readers can't compare.

### Sankey (plotly → static PDF)

If you must show flow (e.g., dataset → method → outcome), use plotly's Sankey and export to PDF:

```python
import plotly.graph_objects as go
import plotly.io as pio
if pio.kaleido.scope is not None:   # None when kaleido isn't installed — guard before touching it
    pio.kaleido.scope.mathjax = None   # else kaleido bakes a "Loading [MathJax]…" banner into the PDF

# Nodes are indexed 0..N-1; links reference them by that index.
labels = ["ETTm1", "Weather",        # 0,1  datasets
          "PatchTST", "Ours",        # 2,3  methods
          "Best", "Runner-up"]       # 4,5  outcome
link = dict(                          # every node must be reachable, or it renders empty
    source=[0, 0, 1, 1, 3, 2],        # datasets → methods, then methods → outcome
    target=[2, 3, 2, 3, 4, 5],
    value =[5, 8, 6, 7, 13, 11],
)
fig = go.Figure(go.Sankey(node=dict(label=labels, pad=15, thickness=16), link=link))
fig.update_layout(font_size=11, width=600, height=400)

try:
    fig.write_image("fig_06_flow.pdf")   # static export needs `kaleido`
except Exception as e:                    # kaleido missing / incompatible
    fig.write_html("fig_06_flow.html")
    print(f"static export unavailable ({type(e).__name__}); wrote HTML fallback. "
          "For the PDF: pip install kaleido")
```

Requires `pip install plotly kaleido`. Pin a compatible pair — plotly 5.x needs `kaleido==0.2.1`; plotly ≥ 6 works with newer kaleido (a mismatch makes `write_image` raise, which the fallback above catches). Use sparingly — sankey is fashionable but rarely the right tool.

### Taste for advanced figures

- Multi-panel: align axes when they share scale; sub-label `(a)(b)(c)` top-left bold.
- Radar: normalize all axes to the same range first.
- Sankey: only when flow is the actual story.
- Avoid: pie charts (unreadable), donut charts, word clouds, radial bar charts. None of these are acceptable in research papers.

## Reusing an experiment-suite baseline figure

If `output/experiment-suite/<slug>/latest/figures/fig_01_comparison_<metric>.pdf` exists, it's a starting point but the styling is usually crude (mixed font sizes, cramped layout, "SIMULATED DATA" watermark baked into the figure). Two acceptable options:

- **Regenerate** with the matplotlib publication style above (preferred — keep the simulated marker in the title `\thanks` instead of baked into the figure pixels), OR
- **Reuse** it as `fig_01_baseline.pdf` for transparency, and add 3–6 better-styled figures alongside.

Either way, the final inventory inside `$RUN/figures/` is what compiles into the paper.

## Quick checklist

- [ ] Every figure is justified by a claim or mechanism; no forced architecture or stock figure
- [ ] Quantitative plots use publication style (font, palette, dpi, sizing)
- [ ] Heatmap or multi-panel figures appear only where the data warrants them
- [ ] All figure files vector PDF; fonts embedded (`pdf.fonttype=42`)
- [ ] Each figure referenced in prose with `\ref{fig:...}`
- [ ] Every figure has a caption that stands alone (a reader who only sees the figure should understand it)
- [ ] No Mermaid, PlantUML, generic flowchart/mind-map, 3-D bars, pie charts, rainbow palettes, or screenshots
- [ ] Zero text collisions: PNG sibling of every figure visually inspected; tick labels short/wrapped per the collision rules; watermarks in empty corners
