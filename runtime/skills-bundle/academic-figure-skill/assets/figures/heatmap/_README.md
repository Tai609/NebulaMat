# Heatmap Assets

Place production heatmap scripts and their 300dpi PNG previews here.

## Expected Variants

- `expression_clustered.R` — Expression heatmap with row/column dendrograms (ComplexHeatmap)
- `correlation_lower.py` / `.R` — Correlation matrix with lower-triangle mask
- `multi_annotation.R` — Multi-annotation heatmap (pathway, p-value, condition bars)
- `split_heatmap.R` — Heatmap with row_split and column_split
- `snp_effects.R` — SNP effect matrix with diverging scale

## Pattern-Level Parameters to Preserve

- dendrogram width (6-8mm) and linewidth (0.5pt)
- colorRamp2 breakpoints and color values
- row/column name fontsize (5-6pt) and max visible labels (~50)
- annotation bar width (2-3mm per bar)
- legend merging (merge_legend = TRUE)
- split gap width (2mm)
