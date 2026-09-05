# Export Specifications

> **BASELINE — COPY VERBATIM:** The code block below must be included in every generated script, placed after the typography baseline and before any plotting code.

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

```r
# Academic Figure Skill Export Baseline — COPY VERBATIM
save_cns_figure <- function(plot, filename, width_mm = 183, height_mm = NULL) {
  ggsave(paste0(filename, ".pdf"), plot, device = cairo_pdf,
         width = width_mm, height = height_mm, units = "mm", dpi = 300)
  png(paste0(filename, ".png"), width = width_mm, height = height_mm,
      units = "mm", res = 300, type = "cairo")
  print(plot)
  dev.off()
}
```

---

## Format Selection

| Content Type | Format | Notes |
|-------------|--------|-------|
| Line plots, scatter plots, bar charts, boxplots | PDF or SVG or EPS | Vector elements (lines, text, shapes) must remain vector |
| Heatmap color blocks, micrographs, photos | TIFF or PNG at ≥300 dpi | True raster content only |
| Mixed (scatter with >100K rasterized points on vector axes) | PDF with `rasterized=True` on the data layer | Keeps axes/labels as vector text |

**Always deliver:**
1. One vector master file (PDF preferred, or SVG/EPS if specified by journal)
2. One 300 dpi PNG preview (for quick viewing, chat sharing, manuscript drafts)

## Python Matplotlib Export

```python
# Vector master (submission-ready)
fig.savefig("figure.pdf", bbox_inches="tight", dpi=300,
            pdf.fonttype=42,    # Embed TrueType fonts as text, not outlines
            svg.fonttype="none") # Keep text editable in SVG

# Raster preview
fig.savefig("figure.png", bbox_inches="tight", dpi=300)

# For scatter plots with very large point counts:
ax.scatter(x, y, s=2, rasterized=True)  # rasterize data layer only
```

Key matplotlib rcParams:
```python
mpl.rcParams.update({
    "svg.fonttype": "none",     # Editable text in SVG
    "pdf.fonttype": 42,         # TrueType font embedding in PDF
    "savefig.bbox": "tight",    # Trim whitespace
    "savefig.dpi": 300,
})
```

## R ggplot2 Export

```r
# Vector master
ggsave("figure.pdf", width = 89, height = 70, units = "mm",
       device = cairo_pdf, dpi = 300)

# Raster preview
ggsave("figure.png", width = 89, height = 70, units = "mm", dpi = 300)
```

## R ComplexHeatmap Export

```r
# Vector master
cairo_pdf("heatmap.pdf", width = 183/25.4, height = 120/25.4)
draw(ht)
dev.off()

# Raster preview
png("heatmap_preview.png", width = 183, height = 120, units = "mm", res = 300)
draw(ht)
dev.off()
```

## Resolution Requirements by Journal

| Journal Family | Line Art | Raster/Photo |
|---------------|----------|-------------|
| Nature | ≥600 dpi (line art), ≥300 dpi (photo) | ≥300 dpi |
| Cell | ≥600 dpi (line art), ≥300 dpi (photo) | ≥300 dpi |
| Science | ≥600 dpi (line art), ≥300 dpi (photo) | ≥300 dpi |

**Guideline:** When in doubt, export at 600 dpi for line art and 300 dpi for everything else.

## File Naming Convention

- Use descriptive names: `fig1_microbiome_heatmap.pdf` not `figure1.pdf`
- Match the numbering in your manuscript: `fig2a_volcano.pdf`, `fig2b_pathway.pdf`
- Supplementary figures: `figS1_quality_control.pdf`
