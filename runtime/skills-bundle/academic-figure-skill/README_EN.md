<div align="center">
  <h1>Academic Figure Skill</h1>
  <p><strong>A submission-grade scientific figure generation skill — automates the full pipeline from data interpretation to journal-formatted output.</strong></p>
  <p>
    Question-driven · 8-step workflow · 29 figure types · 4-pass QA · Vector PDF delivery · Statistics report
  </p>
  <p>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-2ea44f"></a>
    <a href="#installation"><img alt="Install" src="https://img.shields.io/badge/install-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20Copilot-111827"></a>
    <a href="#figure-type-gallery"><img alt="Figure Types" src="https://img.shields.io/badge/figures-29-0ea5e9"></a>
    <a href="#quality-assessment"><img alt="QA" src="https://img.shields.io/badge/QA-4%20pass%2030%2B%20checks-success"></a>
    <a href="README.md"><img alt="Language" src="https://img.shields.io/badge/语言-中文%20%7C%20English-1f6feb"></a>
  </p>
  <p>
    <a href="#about">About</a>
    · <a href="#installation">Installation</a>
    · <a href="#figure-type-gallery">Figure Types</a>
    · <a href="#workflow">Workflow</a>
    · <a href="#directory-layout">Structure</a>
    · <a href="#quality-assessment">QA</a>
    · <a href="#contributing">Contributing</a>
    · <a href="README.md">中文</a>
  </p>
</div>

---

**Academic Figure Skill** takes "question-driven, not template-driven" as its core principle. Every figure starts from a scientific question and goes through an 8-step closed-loop workflow (intent parsing → archetype classification → figure-type justification → environment detection → style baseline injection → asset scan → render → QA verification), delivering submission-ready vector PDF masters + 300dpi PNG previews + statistical reports. For updates, follow our WeChat official account: **科研绘图酱**.

---

## Preview

<p align="center">
  <img src="assets/figure-atlas/preview.png" width="100%" alt="Academic Figure Skill multi-panel preview">
</p>

<details>
<summary>Click to expand more examples</summary>
<p align="center">
  <img src="assets/figure-atlas/data-figure.png" width="100%" alt="Example figure 2">
</p>
</details>

---

## About

Academic Figure Skill is a skill package for AI coding assistants (Claude Code, Codex, and others). It encodes the figure preparation conventions of Nature, Cell, and Science family journals — Arial/Helvetica typography, 89 mm / 183 mm column widths, PDF vector export, and 300 dpi raster previews — along with the visual parameters of 29 common figure types into `SKILL.md` and 16 supporting reference documents. When a user provides data and a scientific question, the skill guides the LLM through a standardized 8-step workflow: clarifying the research question → classifying the figure archetype → proposing and justifying a panel plan for user confirmation → detecting Python/R runtimes → injecting a unified typography and color baseline → scanning `assets/figures/` for production scripts (native execution when matched, cross-type parameter inheritance otherwise) → pre-render data validation → 4-pass QA self-check → delivering a vector PDF master and a statistical report.

The skill does not replace the plotting capabilities of Python or R. It provides a set of structured constraints and priors so that LLM-generated plotting code adheres to CNS journal visual standards, reducing the manual effort of adjusting typography, color schemes, and export parameters. For multi-panel compositions, the skill supports mixed Python and R orchestration: R panels are rendered to bitmaps via the Cairo graphics device, and the Python `compose.py` layout engine tiles them at exact physical dimensions.

### Design Principles

| Principle | Description |
|-----------|-------------|
| **One figure, one message** | A reviewer should grasp the core conclusion in 3 seconds; remove gridlines, borders, and redundant legends |
| **Restrained color > abundant color** | 2–4 semantic main colors + 1 accent; never use matplotlib/ggplot defaults |
| **Design for print** | Journal column widths are fixed (single 89 mm / double 183 mm); set dimensions at creation, never scale down |
| **Vector first** | Lines, scatter, bars → PDF/SVG; only true raster content (heatmap blocks, micrographs) uses ≥300 dpi TIFF/PNG |

---

## Core Capabilities

| Capability | Description |
|------------|-------------|
| **Archetype Classification** | Four paradigms: `quantitative_grid`, `schematic-led`, `image plate + quant`, `asymmetric_mixed` — automatically drive layout and hero-panel strategy |
| **29 Figure Types** | Heatmap / Volcano / Bar / Scatter / Box / PCA / RDA / Radar / Sankey / AUROC / Ridge / Violin / Marginal Density / KDE / Mantel Correlation / UpSet / Forest / Confusion Matrix / Manifold / Stacked Bar Scatter / Paired Box / Marker Gene Dot Plot / Trend Line / 3D Heatmap / Frequency Heatmap / Density Heatmap / Correlation Matrix / Grouped Correlation Matrix / Grouped Violin — each with production scripts (`.py` + `.R`) and preview PNG |
| **Copy-First Rule** | Scan `assets/figures/<type>/` before generating code; if a production script matches, **run it natively** — Python runs `.py`, R runs `.R` — no translation, no quality degradation |
| **Cross-Type Parameter Inheritance** | When no production script exists, borrow Class A (hard params: colors/alpha/linewidth), Class B (scaling params: font sizes/dimensions), and Class C (logic params: legend on/off, grid on/off) from the nearest figure type |
| **Multi-Language Composition** | R panels run natively → output spec-correct PNGs; Python composition engine tiles them by exact physical dimensions |
| **Auto Hero-Panel Detection** | The panel carrying the core conclusion automatically gets larger visual weight; supporting panels are arranged as subordinates |
| **4-Pass QA Protocol** | Pass 0: Anti-pattern scan (AP-0–7) → Pass 1: Code-level compliance (CL-1–7) → Pass 2: Visual logic & data integrity (VI-1–6) → Pass 3: Rendered output verification (VV-1–5) — 30+ checks total |
| **Data Validation Gate** | Pre-render per-panel checks — volcano needs ≥10 significant DE genes, AUROC curve separation ≥0.15, heatmap must have cross-row variance — refuse rendering if checks fail |
| **Statistics & Reproducibility Report** | Mandatory per-figure: n definition, center statistic (mean/median), spread metric (SD/SEM/95% CI), test name, multiple-comparison correction, source-data traceability |
| **Journal Color System** | Nature cool-blue, Cell warm, Science conservative grey; colorblind-friendly; avoids red-green-only differentiation |
| **Reviewer Simulation Mode** | Inspect output through five lenses — scientific clarity, visual hierarchy, color accessibility, typography legibility, overall polish — with must-fix vs. suggestion grading |

---

## Figure Type Gallery

> The example figures shown are generated from the project's private data assets and serve as style references only. When users request the same figure type, scripts preserve the established visual language (color scheme, font specification, layout logic, graphical hierarchy) while adapting to the user's actual data. Private assets are continuously updated. Follow WeChat official account: 科研绘图酱

| Figure Type | Preview | Key Features | Typical Use Cases |
|------------|---------|-------------|-------------------|
| 3D Heatmap | <img src="assets/figure-atlas/3Dheatmap.png" width="100"> | 3D columns encode matrix values with height + color dual encoding | Multi-factor interaction effects, genotype × environment matrix, 3D intensity distribution |
| AUROC Curve | <img src="assets/figure-atlas/auroc.png" width="100"> | TPR–FPR curve with diagonal reference line and AUC annotation | Classifier evaluation, multi-model ROC comparison, threshold sensitivity analysis |
| Bar Chart | <img src="assets/figure-atlas/bar.png" width="100"> | Single-variable bar height encoding with error bars | Between-group mean comparison, single-metric ranking, count statistics |
| Correlation Density | <img src="assets/figure-atlas/CorrelationDensity.png" width="100"> | Scatter with 2-D kernel density contours overlaid | Two-variable relationship strength, density cluster identification, outlier detection |
| Correlation Matrix | <img src="assets/figure-atlas/Correlationmatrix.png" width="100"> | Square grid with color + value dual encoding of pairwise correlations | Multi-variable correlation overview, collinearity check before feature selection |
| Density Heatmap | <img src="assets/figure-atlas/density_heatmap.png" width="100"> | Continuous 2-D kernel density as color gradient across the full grid | Large-sample point cloud density visualization, replaces overplotted scatter |
| Frequency 3D Heatmap | <img src="assets/figure-atlas/Frequency_3DHeatmap.png" width="100"> | 3-D columns showing binned frequencies across two categorical dimensions | Allele frequency distribution, two-factor count cross-display |
| Grouped Correlation Matrix | <img src="assets/figure-atlas/GroupCorrelationmatrix.png" width="100"> | Multiple correlation matrices split by group, displayed side by side | Comparing correlation structure across treatments/environments |
| Grouped Bar Chart | <img src="assets/figure-atlas/GroupedBarChart.png" width="100"> | Multiple sub-group bars juxtaposed within each category | Multi-treatment × multi-metric comparison, replicate group differences |
| Mantel Correlation | <img src="assets/figure-atlas/MantelCorrelation.png" width="100"> | Correlation heatmap with connection curves annotated with Mantel r and significance | Environmental factor vs. community/genotype matrix association, distance matrix correlation |
| PCA Biplot | <img src="assets/figure-atlas/PCA.png" width="100"> | Samples projected onto PC plane with confidence ellipses | Population structure analysis, sample clustering trends, dimensionality reduction |
| Radar Chart | <img src="assets/figure-atlas/radar.png" width="100"> | Multi-axis radial arrangement with closed polygon for composite performance | Multi-metric variety/model evaluation, trait profile comparison |
| Ridge Plot | <img src="assets/figure-atlas/RidgePlot.png" width="100"> | Multiple density curves stacked vertically with vertical offset | Multi-group/time-series distribution comparison, trait distribution trends |
| Sankey Diagram | <img src="assets/figure-atlas/sankey.png" width="100"> | Flow width encoding between nodes across multiple stages | Pathway/process flow visualization, categorical flow attribution |
| Stacked Bar Scatter | <img src="assets/figure-atlas/StackedBarScatter.png" width="100"> | Stacked bars carrying composition ratios with overlaid scatter for individual values | Composition display while preserving raw sample points |
| Trend Line | <img src="assets/figure-atlas/trend.png" width="100"> | Line plot along continuous variable (time/environmental gradient) with confidence band | Trait variation along environmental gradients, time-series trends |
| Violin Plot | <img src="assets/figure-atlas/violin_chart.png" width="100"> | Mirrored density outline showing distribution shape | Between-group distribution shape and dispersion comparison, non-normal data display |

---

## Workflow

```text
┌─────────────────────────────────────────────────────────────┐
│  User Intent Parsing                                         │
└─────────────────────────────────────────────────────────────┘
  Step -1  Clarify intent   │ Ask reverse questions: "What question does this data answer?"
  Step 0a  Classify archetype │ Four paradigms: quantitative grid / schematic-led / image plate + quant / asymmetric mixed
  Step 0b  Parse data        │ Question-driven structured parsing — never template-driven
  Step 1   Justify figure    │ Evidence-based selection: N panels answer N distinct scientific questions
  Step 2   Detect environment│ Runtime self-check (Python / R kernels, dependency integrity)
  Step 3   Inject style      │ Visual baseline: typography system + color scheme + export specs
  Step 4   Scan assets       │ Scan assets/figures/<type>/, match production scripts per panel
  Step 5   Render            │ Copy-First native execution or cross-type parameter inheritance
  Step 5.5 Validate data     │ Pre-render per-panel feasibility check — refuse if criteria not met
  Step 6   QA verification   │ 4-pass QA protocol, 30+ checkpoints
  Step 7   Deliver           │ Vector PDF + 300dpi PNG + Statistics Report + QA Report
```

**Core principle**: Question-driven, not template-driven — figure-type selection follows the number and structure of scientific questions; visual style is inherited through the asset library rather than built from scratch.

---

## Installation

`academic-figure-skill` is a skill package built around `SKILL.md`. A complete installation must preserve `references/`, `scripts/`, `assets/`, `install/`, and other directories — the skill depends on these files for style baseline injection, asset scanning, and cross-platform adaptation.

### Claude Code

If Claude Code is not yet installed:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

Clone the repository to a stable path and install the skill:

```bash
mkdir -p ~/ai-skills
cd ~/ai-skills
git clone https://github.com/TingxiYu/academic-figure-skill.git academic-figure-skill
cp -r academic-figure-skill ~/.claude/skills/
```

After installation, describe your task naturally in a Claude Code session — the skill triggers automatically:

```text
Please use academic-figure-skill to analyze the multip-traits.csv data in the project files and perform a visualization analysis.
```

```text
Use academic-figure-skill to plot the data.csv data as a Nature-style differential expression volcano plot.
```

To update:

```bash
cd ~/ai-skills/academic-figure-skill
git pull
cp -r . ~/.claude/skills/academic-figure-skill/
```

### Codex

Codex loads skills through `install/codex/` which provides `manifest.yaml` + `instructions.md`. Copy the required directories to `~/.codex/skills/academic-figure-skill/`:

```bash
git clone https://github.com/TingxiYu/academic-figure-skill.git
cd academic-figure-skill
mkdir -p ~/.codex/skills/academic-figure-skill
cp -r SKILL.md references/ scripts/ assets/ install/codex/* ~/.codex/skills/academic-figure-skill/
```

After installation, describe your task naturally in a Codex session — the skill activates automatically based on trigger rules in `manifest.yaml`.

You can also ask Codex to install for you:

```text
Install the Codex skill from https://github.com/TingxiYu/academic-figure-skill.git.
Clone the repo, then copy SKILL.md, references/, scripts/, assets/, and install/codex/ to ~/.codex/skills/academic-figure-skill/.
Keep the full directory structure — do not copy only SKILL.md.
```

### Cursor

Copy the skill rules file to your project root. Cursor will automatically follow the specifications when generating code:

```bash
git clone https://github.com/TingxiYu/academic-figure-skill.git
cp academic-figure-skill/install/cursor/.cursorrules <your-project>/.cursorrules
```

The `.cursorrules` file includes color palettes, typography baselines, export specifications, and other core rules. To update, re-run the copy command.

### GitHub Copilot

Copy the skill instructions file to your project's `.github/` directory. Copilot loads this context when generating code:

```bash
git clone https://github.com/TingxiYu/academic-figure-skill.git
mkdir -p <your-project>/.github
cp academic-figure-skill/install/copilot/copilot-instructions.md <your-project>/.github/
```

If you already have `.github/copilot-instructions.md`, append this skill's content to the end of the file.

### Other Agents

For other AI coding assistants:

1. Keep a stable local clone of the repository
2. Create a lightweight subagent, slash command, or custom prompt wrapper that points to `SKILL.md`
3. Ensure `references/`, `scripts/`, `assets/` stay at the same relative path as `SKILL.md`
4. If the agent has its own format requirements, adjust the frontmatter and body structure

---

## Directory Layout

```text
	academic-figure-skill/             ← Core skill package (this directory)
    ├── README.md                      ← Documentation (Chinese)
    ├── README_EN.md                   ← Documentation (English)
    ├── LICENSE                        ← Apache 2.0 License
    ├── SKILL.md                       ← Skill entry point: 8-step workflow + all rules
    ├── references/                    ← 16 shared knowledge documents
    │   ├── figure-contract.md         ← Figure contract: core conclusion + evidence chain + review risks
    │   ├── color-palettes.md          ← Color system: categorical/diverging/sequential + colorblind-friendly
    │   ├── typography.md              ← Font specification: Arial/Helvetica, ≥5pt minimum
    │   ├── journal-specs.md           ← Journal dimensions: single 89mm / double 183mm
    │   ├── export-specs.md            ← Export specification: PDF/SVG vector + 300dpi PNG
    │   ├── multipanel-layout.md       ← Multi-panel layout: anti-redundancy + hero panel + narrative order
    │   ├── directory-map.md           ← Figure-type directory mapping: keywords → asset paths
    │   ├── checklist.md               ← Complete QA checklist
    │   ├── common-pitfalls.md         ← Common pitfalls and solutions
    │   ├── revision-cases.md          ← Reviewer revision case library
    │   ├── journal-intel.md           ← Journal-specific intelligence
    │   ├── figure-deconstruction.md   ← Figure deconstruction: compositional inspiration
    │   ├── matplotlib.md              ← Python/matplotlib/seaborn guide
    │   ├── complexheatmap.md          ← R ComplexHeatmap guide
    │   ├── r-rendering.md             ← R PNG rendering specification (cairo device)
    │   └── compose.R                  ← R composition reference implementation
    ├── scripts/                       ← Composition engine + QA tools + evaluation suite
    │   ├── compose.py                 ← Multi-panel layout engine
    │   ├── eval_runner.py             ← Full asset audit (29 types auto-scan)
    │   ├── trigger_benchmark.py       ← Trigger accuracy benchmark
    │   ├── qa_coverage.py             ← QA check coverage verification
    │   ├── qa_validator.py            ← Automated code check (AP-0~CL-7)
    │   ├── check_references.py        ← Reference integrity check
    │   ├── e2e_runner.py              ← E2E integration test (A/B scenario auto-scoring)
    │   ├── check_colors.py            ← Color compliance check
    │   ├── check_dimensions.py        ← Dimension specification check
    │   ├── check_export.py            ← Export parameter check
    │   ├── check_fontsize.py          ← Font size compliance check
    │   ├── check_figure.py            ← Figure comprehensive check
    │   ├── generate_adapters.py       ← Cross-platform adapter generation
    │   ├── generate_atlas.py          ← Figure atlas auto-generation
    │   └── run_ab_tests.py            ← A/B test runner
    ├── assets/
    │   ├── figures/                   ← 29+ figure-type production scripts and previews
    │   │   ├── 3DHeatmap/             ← 3-D heatmap (R/ComplexHeatmap)
    │   │   ├── AUROC/                 ← AUROC curves
    │   │   ├── BarAblation/           ← Ablation study bars
    │   │   ├── BarCategorical/        ← Categorical bar charts
    │   │   ├── BarComparison/         ← Method comparison bars
    │   │   ├── BarComposition/        ← Composition bars
    │   │   ├── BarDistribution/       ← Distribution bars
    │   │   ├── ConfusionMatrix/       ← Confusion matrix
    │   │   ├── CorrelationMatrix/     ← Correlation matrix (ggpairs)
    │   │   ├── DensityHeatmap/        ← Density heatmap
    │   │   ├── Frequency_3DHeatmap/   ← Frequency 3-D heatmap
    │   │   ├── GroupedBarChart/       ← Grouped bar chart
    │   │   ├── GroupedCorrelationMatrix/ ← Grouped correlation matrix
    │   │   ├── GroupedViolin/         ← Grouped violin plot
    │   │   ├── KernelDensity/         ← Kernel density estimation
    │   │   ├── LineTrend/             ← Trend line plot
    │   │   ├── Manifold/              ← Manifold visualization
    │   │   ├── MantelCorrelation/     ← Mantel correlation test
    │   │   ├── MarginalDensity/       ← Marginal density plot
    │   │   ├── MarkerGeneDotPlot/     ← Marker gene dot plot
    │   │   ├── PCA/                   ← PCA principal component analysis
    │   │   ├── PairedBoxScatter/      ← Paired box-scatter plot
    │   │   ├── Radar/                 ← Radar chart
    │   │   ├── RidgePlot/             ← Ridge density plot
    │   │   ├── SankeyDiagram/         ← Sankey flow diagram
    │   │   ├── StackedBarScatter/     ← Stacked bar scatter composite
    │   │   ├── Violin/                ← Violin plot
    │   │   ├── heatmap/               ← Clustered heatmap
    │   │   ├── volcano/               ← Volcano plot
    │   │   ├── basic-plots/           ← Basic plot types
    │   │   ├── multipanel/            ← Multi-panel templates
    │   │   └── other/                 ← Long-tail figure types
    │   └── figure-atlas/              ← Figure atlas preview PNG collection
    └── install/                       ← Cross-platform adapters
        ├── claude-code/               ← Claude Code (native support, ready to use)
        ├── cursor/                    ← Cursor IDE adapter
        ├── copilot/                   ← GitHub Copilot adapter
        └── codex/                     ← Codex CLI adapter
```

---

## Quality Assessment

### 4-Pass QA Protocol

| Pass | Name | Checks | Description |
|------|------|--------|-------------|
| Pass 0 | Anti-Pattern Scan (AP) | 8 | Default palettes, four-sided borders, legend inside plot, screenshot-only export, jet colormap, bars without points, default fonts, large sample not rasterized |
| Pass 1 | Code Compliance (CL) | 7 | Typography baseline, color scheme, export specs, asset confirmation table, no downsampling, figure dimensions, journal specs |
| Pass 2 | Visual Logic & Data Integrity (VI) | 6 | Data range, heatmap variance, correlation strength, PCA separation, distribution shape, data loss transparency |
| Pass 3 | Rendered Output Verification (VV) | 5 | PDF generated, PNG generated, non-zero files, font embedding, correct dimensions |

### Running Evaluations

```bash
# Full asset audit
python scripts/eval_runner.py

# Single type audit
python scripts/eval_runner.py --type Heatmap

# E2E integration tests
python scripts/e2e_runner.py

# Trigger accuracy benchmark
python scripts/trigger_benchmark.py
```

---

## Contributing

Academic Figure Skill uses a skill plugin architecture. To add a new figure type:

1. Create a new directory `<FigureType>/` under `assets/figures/`
2. Add production scripts (`.py` or `.R`) and a preview PNG
3. Add keyword mappings in `references/directory-map.md`
4. Run `python scripts/eval_runner.py --type <FigureType>` to verify

---

## License

[Apache 2.0](LICENSE) © 2025 Academic Figure Skill Contributors
