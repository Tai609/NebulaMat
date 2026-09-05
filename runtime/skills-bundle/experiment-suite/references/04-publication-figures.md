# Publication-Grade Figures

## Why this exists

The simulator emits one default chart (`fig_01_comparison_<metric>.pdf`) with default matplotlib styling — useful for a status check, far too crude for a real experiment package. This reference defines what to bring it up to.

**Hard targets:**
- ≥ 3 figures total (more if the experiment supports them)
- All vector PDF, fonts embedded, publication-grade rcParams
- Each figure has a question it answers; that question becomes the caption

Before plotting, open `references/04a-figure-contract.md` and define the figure contract. The chart serves the claim, not the other way around.

## Publication-medium gate

- Use matplotlib/seaborn for quantitative evidence, purpose-built TikZ/SVG/PDF
  for a method schematic, and scientific image panels only with source, crop,
  scale, and processing provenance.
- Do not deliver Mermaid, PlantUML, generic flowchart/mind-map output,
  diagram-editor screenshots, or notebook/UI screenshots as experiment or paper
  figures. Graphviz is acceptable only when the graph itself is analysed data.
- Do not use decorative roadmaps, funnels, icon collages, or stock process
  diagrams. Every figure must expose evidence, experimental design, or mechanism.

## File layout

All figures live under `output/experiment-suite/<slug>/figures/` with a `make_fig_NN_<slug>.py` script alongside the rendered `.pdf`. The script is the source of truth — re-running the script reproduces the figure. Update `manifest.json` when adding figures.

Naming: `fig_<NN>_<slug>.pdf` and `make_fig_<NN>_<slug>.py`.

## Publication rcParams

Apply at the top of every figure script:

```python
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 8,
    "axes.labelsize": 8,
    "axes.titlesize": 8,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 8,
    "axes.linewidth": 0.6,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": False,
    "lines.linewidth": 1.2,
    "lines.markersize": 3.5,
    "savefig.dpi": 400,
    "savefig.bbox": "tight",
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})
```

`pdf.fonttype = 42` embeds fonts as TrueType — required for journal submission.

If you have many related methods on one page, prefer a restrained family palette instead of maximal hue separation.

## Color palette

```python
WONG = ["#000000", "#E69F00", "#56B4E9", "#009E73",
        "#F0E442", "#0072B2", "#D55E00", "#CC79A7"]
COLORS = [WONG[5], WONG[6], WONG[3], WONG[7], WONG[2], WONG[1]]
```

Use the same Wong colour-blind-safe palette as `paper-writer` and
`literature-survey`. The default line order excludes bright yellow on white;
reserve yellow for fills or marks with a dark edge. Never use the default
matplotlib cycle.

The experiment examples default to 8 pt for comfortable standalone reading.
Seven points is the final-size floor, not a target; use more space and larger
type when the venue and panel density allow it.

## Required figure families

### Family 1 — Method comparison (bar or line)

If one panel is the main paper claim, make it the hero panel. Supporting panels should not get equal visual weight by default.

Bar chart for a single metric across methods:

```python
methods = ["DLinear", "PatchTST", "iTransformer", "Ours"]
mse =     [0.382,    0.366,      0.359,         0.354]
err =     [0.012,    0.009,      0.008,         0.007]

fig, ax = plt.subplots(figsize=(3.6, 2.6))
x = np.arange(len(methods))
ax.bar(x, mse, yerr=err, capsize=3, color=COLORS[:len(methods)],
       edgecolor="black", linewidth=0.5)
ax.set_xticks(x)
ax.set_xticklabels(methods, rotation=15, ha="right")
ax.set_ylabel("MSE on ETTm1 (lower is better)")
ax.set_ylim(0.34, 0.40)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
```

Or a horizon-sweep line plot if the experiment has a horizon axis.

### Family 2 — Ablation breakdown

Either a panel-of-bars per ablation row, or a small-multiples plot per dataset showing full-vs-ablated:

```python
fig, axes = plt.subplots(1, len(DATASETS), figsize=(7.0, 2.4), sharey=True)
for ax, dataset in zip(axes, DATASETS):
    ax.bar([0, 1], [full[dataset], no_patch[dataset]],
           color=[COLORS[0], COLORS[3]], width=0.6)
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["Full", r"$-$patching"], fontsize=8)
    ax.set_title(dataset, fontsize=9)
    if dataset == DATASETS[0]:
        ax.set_ylabel("MSE")
```

### Family 3 — Optional: training curves / heatmap / scaling

Use only when the data supports it:

- **Training curves** (line plot, train+val per method) — useful when the experiment varies optimisation strategy.
- **Heatmap** (method × dataset MSE) — useful when there are 6+ methods and 4+ datasets.
- **Scaling plot** (metric vs model size / data size) — useful for a foundation-model story.

If the data doesn't support a meaningful version of these, skip — empty heatmaps with 4 cells are not figures.

## Panel labels

Add lowercase panel labels for multi-panel figures:

```python
ax.text(-0.12, 1.03, "(a)", transform=ax.transAxes,
        fontsize=10, fontweight="bold", ha="left", va="bottom")
```

Keep the position consistent across panels in the same figure family.

## Text collision rules

- Keep final-size text at or above 7 pt.
- Shorten or wrap long categorical labels. Keep multi-line labels horizontal;
  rotate only short single-line labels (`rotation=30, ha="right",
  rotation_mode="anchor"`), or use a horizontal chart.
- If six or more marks need direct labels, label only the extremes or move
  detail to a table.
- Place annotations, panel letters, and watermarks in verified clear space.
  Automatic layout calls do not prove that text is collision-free.
- Render the final PDF to PNG and inspect it at its intended paper size. Any
  text touching other text or data, clipping, or missing series is a failure.

## Captions

Every caption stands alone (a reader who only sees the figure should understand it). Aim for 1–3 sentences naming axes, what the panels show, and what the takeaway is.

For simulated results, the caption ends with `Numbers are simulated.` For measured results, the caption may name the seed count and hardware briefly.

Prefer direct labels over a detached legend when one or two curves dominate the interpretation and the labels can be placed without ambiguity.

## Watermarks for simulated mode

If `results.json` provenance is `"simulated"`, add a discreet watermark to each figure:

```python
ax.text(0.99, 0.02, "simulated",
        transform=ax.transAxes, ha="right", va="bottom",
        fontsize=7, color="gray", alpha=0.5, style="italic")
```

Move the marker to a verified clear corner for the actual data. If no clear
in-axes location exists, place it in the figure margin or rely on the mandatory
caption disclosure rather than covering evidence.

## Export policy

Primary export remains vector PDF because `paper-writer` reuses it directly. When possible, also export:

- `.svg` for editable text
- `.tiff` at 600 dpi for journal upload

Do not store absolute paths in `manifest.json`; only basenames.

## Anti-patterns

- **3-D bars, drop shadows, gradient fills** — none belong in a research figure.
- **Pie / donut charts** — almost never the right choice; never for experimental data.
- **Default matplotlib colors** — perceptually uneven; use the palette above.
- **Legend overlapping data** — move it or shrink data range.
- **Text below 7 pt, overlapping, or clipped** — redesign the layout; do not
  shrink it into compliance.
- **Mermaid, PlantUML, generic flowchart/mind-map, or editor/UI screenshot** —
  not a paper figure.
- **Captions that say only "Comparison results"** — say what's being compared and what we learn.
- **Watermark missing** in simulated mode — caption without watermark is not enough.
- **Raster (.png) instead of vector (.pdf)** — pixelates in print.

Before final delivery, run the checklist in `references/04b-figure-qa.md`.

## Manifest update

After adding a figure, append an entry to `figures/manifest.json` so downstream `paper-writer` consumers see it:

```json
[
  {
    "id": "fig_02_method_comparison",
    "path_pdf": "fig_02_method_comparison.pdf",
    "path_png": "fig_02_method_comparison.png",
    "caption": "MSE comparison across methods on ETTm1 (three-seed mean ± std).",
    "section": "results"
  }
]
```

## Quick checklist

- [ ] ≥ 3 figures (4–6 ideal)
- [ ] All publication rcParams applied (font, size, dpi, embedded fonts)
- [ ] All figures vector PDF + sibling PNG for preview
- [ ] Each figure has a `make_fig_NN_*.py` script alongside
- [ ] Each figure referenced by the report and / or paper
- [ ] Each caption stands alone
- [ ] Final-size raster inspected; no text/data collisions, clipping, or missing marks
- [ ] No generic diagram-tool output or screenshots
- [ ] Simulated figures carry watermark + caption disclaimer
- [ ] `manifest.json` lists every figure
