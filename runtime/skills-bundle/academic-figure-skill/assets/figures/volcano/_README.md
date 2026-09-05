# Volcano Plot Assets

Place production volcano plot scripts and their 300dpi PNG previews here.

## Expected Variants

- `deseq2_standard.py` / `.R` — RNA-seq differential expression, adjusted p-value threshold
- `microarray_standard.py` — Microarray data, typically larger feature count
- `proteomics_labeled.py` / `.R` — Fewer features (~100-5000), may need larger point size
- `multi_comparison.py` — Faceted volcano for multiple contrasts

## Pattern-Level Parameters to Preserve

When using these scripts as reference, pay attention to:
- Point size vs. feature count ratio (s=3 for ~5000, s=1-2 for >20000, s=5-8 for <1000)
- Alpha transparency by category (NS: 0.3-0.4 for density, DE: 0.6-0.8 for visibility)
- Threshold line style (dashed, 0.5pt, annotated)
- Gene label offset (xytext values)
- Legend position relative to data density
