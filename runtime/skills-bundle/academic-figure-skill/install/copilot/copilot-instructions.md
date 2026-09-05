# Academic Figure Skill — Scientific Figure Instructions for GitHub Copilot
# Place this file at: <your-repo>/.github/copilot-instructions.md
# Generated: 2026-07-05 13:39 UTC

# Academic Figure Skill Portable Core Rules
# Auto-generated from academic-figure-skill/SKILL.md — 2026-07-05 13:39 UTC
# These rules work across Claude Code, Codex, Cursor, and Copilot.

## Design Principles
1. One figure, one core message. Remove gridlines, borders, and redundant legends.
2. Restrained color > abundant color. Use 2-4 semantic colors + 1 accent. Never default palettes.
3. Design for print, not screen. Single column 89mm, double column 183mm.
4. Vector first, raster fallback. PDF/SVG/EPS for line art; TIFF/PNG (≥300dpi) for raster.

## Color Palette — COPY VERBATIM

```python
# Academic Figure Skill Nature/Cell/Science Color Palette -- COPY VERBATIM
CATEGORICAL = ["#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666"]
CATEGORICAL_EXTENDED = [
    "#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666",
    "#4393C3", "#D6604D", "#5AAE61", "#B35806", "#9970AB", "#999999",
]
DIVERGING   = ["#2166AC", "#F7F7F7", "#B2182B"]
SEQUENTIAL  = ["#F7FBFF", "#6BAED6", "#08306B"]
ACCENT_RED  = "#B2182B"
GREY        = "#999999"
BLACK       = "#222222"
```

```r
# Academic Figure Skill Nature/Cell/Science Color Palette -- COPY VERBATIM
categorical <- c("#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666")
categorical_extended <- c(
  "#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666",
  "#4393C3", "#D6604D", "#5AAE61", "#B35806", "#9970AB", "#999999"
)
diverging  <- c("#2166AC", "#F7F7F7", "#B2182B")
sequential <- c("#F7FBFF", "#6BAED6", "#08306B")
accent_red <- "#B2182B"
grey       <- "#999999"
black      <- "#222222"
```

Color roles: Blue (#2166AC) = control/baseline. Red (#B2182B) = emphasis/up-regulated. Green (#1B7837) = treatment/recovery. Grey (#999999/#666666) = background/non-significant. Never use jet/rainbow or default matplotlib/seaborn palettes.

## Typography — COPY VERBATIM

```python
# Academic Figure Skill Typography Baseline — COPY VERBATIM, place at TOP of script
import matplotlib as mpl
mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "Liberation Sans"],
    "font.size": 8,
    "axes.titlesize": 8,
    "axes.labelsize": 8,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 8,
    "figure.titlesize": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.6,
    "xtick.direction": "out",
    "ytick.direction": "out",
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
    "legend.frameon": False,
})
```

```r
# Academic Figure Skill Typography Baseline — COPY VERBATIM, place at TOP of script
library(ggplot2)
theme_cns <- theme_bw(base_size = 8, base_family = "Arial") +
  theme(
    axis.title = element_text(size = 8),
    axis.text = element_text(size = 7, color = "#333333"),
    legend.title = element_text(size = 8, face = "bold"),
    legend.text = element_text(size = 7),
    strip.text = element_text(size = 8, face = "bold"),
    panel.grid = element_blank(),
    legend.background = element_blank(),
    legend.key = element_blank()
  )
```

Font: Arial/Helvetica. No text below 5pt at final print dimensions. Panel labels: lowercase bold a,b,c... at consistent positions.

## Export — COPY VERBATIM

```python
# Academic Figure Skill Export Baseline — COPY VERBATIM
mpl.rcParams.update({
    "pdf.fonttype": 42,         # TrueType font embedding
    "svg.fonttype": "none",     # editable text in SVG
    "savefig.bbox": "tight",    # trim whitespace
    "savefig.dpi": 300,
})

def save_cns_figure(fig, filename):
    """Standard Academic Figure Skill export: vector PDF + 300dpi PNG preview."""
    fig.savefig(f"{filename}.pdf", bbox_inches="tight", dpi=300)
    fig.savefig(f"{filename}.png", bbox_inches="tight", dpi=300)
```

## Layout Rules
- Single column: 89mm wide. Double column: 183mm wide. Max height: 247mm.
- Remove top and right spines. Ticks outward. Gridlines off by default.
- Legend: outside plot area or direct labeling. Never inside occluding data.
- Panel width never below 35mm. Below 45mm = warn.
- Multi-panel: rows have aspect-ratio-correct heights (heatmap=1.0, ridge=0.65).

## Production Scripts
- Check `assets/figures/<type>/` for matching production scripts first.
- If found, copy-modify-run — change only data paths and labels.
- If not found, cross-type inherit from similar figure type.
- R scripts: png(type="cairo"), showtext_auto(FALSE) before export.

## QA Checklist
- [ ] Custom hex colors used (no defaults)
- [ ] Top/right spines removed
- [ ] Arial/Helvetica font set
- [ ] PDF vector + 300dpi PNG preview saved
- [ ] Dimensions match journal column width
- [ ] Panel labels consistent (a,b,c...)
- [ ] Legend outside plot or direct labeling
- [ ] Colorblind-friendly (no red-green only pairs)

