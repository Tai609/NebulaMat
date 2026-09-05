# Color Palette Reference

> **BASELINE -- COPY VERBATIM:** Copy this block into every generated script. Do not modify values, omit lines, or substitute default palettes.

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

---

## Nature / Cell / Science Color Rules

Academic Figure Skill uses a restrained journal-safe palette rather than default matplotlib, ggplot2, seaborn, Excel, Scanpy, or rainbow palettes. The target look is: high contrast, print-safe, colorblind-aware, and semantically assigned.

### 1. Use Semantic Roles

- Blue `#2166AC`: primary reference, control, baseline, or negative direction.
- Red `#B2182B`: strongest emphasis, disease/high-risk/up-regulated direction; use sparingly.
- Green `#1B7837`: treatment, recovery, beneficial, or orthogonal biological group.
- Orange `#F1A340`: secondary contrast when red is already reserved for emphasis.
- Purple `#762A83`: third/fourth category, model family, or alternate lineage.
- Grey `#999999`: background, non-significant, other, or low-priority category.

### 2. Limit Saturated Color Area

Use 2-4 main colors plus one accent. The accent color should occupy a small area: selected labels, threshold highlights, top genes, or a single hero result. Large saturated red blocks make the figure feel alarmist and are harder to read in print.

### 3. Avoid Red-Green-Only Encoding

Red and green may both appear in the palette, but they must not be the only cue for a critical comparison. Add at least one redundant encoding: shape, line style, direct label, facet, or ordering.

### 4. Match Palette to Data Type

- Categorical data: use `CATEGORICAL` up to six classes.
- More than six classes: use `CATEGORICAL_EXTENDED`, then add direct labels or grouping; avoid legends with 12+ tiny entries when possible.
- Diverging data such as log2FC, z-score, signed correlations: use `DIVERGING` centered at the scientific zero.
- Sequential data such as expression, density, abundance, confidence: use `SEQUENTIAL` or a perceptually uniform single-hue map.
- Non-significant or background points: use grey with low alpha, plotted below signal layers.

### 5. Never Use These Palettes

Reject `jet`, `rainbow`, `hsv`, `tab10`, `tab20`, seaborn `deep/muted/pastel/bright/dark/colorblind`, ggplot2 hue defaults, Excel defaults, and Brewer qualitative `Set1/Set2/Set3/Paired` as final journal palettes. They look default, can distort luminance, or become crowded in multi-panel figures.

### 6. Multi-Panel Consistency

A color means the same thing across all panels in one figure. If blue means control in panel a, blue cannot mean treatment in panel d. Reserve red for the single strongest result or risk direction across the whole figure.

## Quick Use

**Python**
```python
colors = CATEGORICAL[:n_groups]
ax.plot(x, y, color=CATEGORICAL[0])
ax.scatter(x_ns, y_ns, color=GREY, alpha=0.25)
```

**R**
```r
scale_color_manual(values = categorical[seq_len(n_groups)])
scale_fill_gradientn(colors = diverging)
```
