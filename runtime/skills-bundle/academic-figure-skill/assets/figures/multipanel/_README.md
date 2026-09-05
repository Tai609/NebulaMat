# Multi-Panel Figure Assets

Place production multi-panel composition scripts and their 300dpi PNG previews here.

## Expected Variants

- `fig1_2x2_gridspec.py` — 2×2 grid with shared legend and panel labels
- `fig1_3x2_patchwork.R` — 3×2 layout with mixed panel types (R/patchwork)
- `irregular_1large_2small.py` — Irregular layout: 1 large + 2 small panels
- `cns_figure1_discovery.py` — Complete Figure 1: volcano + heatmap + boxplot + model

## Pattern-Level Parameters to Preserve

- gridspec width_ratios and height_ratios
- wspace and hspace values
- Panel label position (top-left corner offset) and font (bold 8-9pt)
- Shared vs. independent colorbar placement
- Overall figure dimension calculation (panel widths + gaps must fit journal limit)
- Legend unification strategy (single external vs. shared per row)
