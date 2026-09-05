# Basic Plots Assets

Place production scripts for boxplots, scatter plots, bar charts, and line plots. Each with a 300dpi PNG preview.

## Expected Variants

- `box_n5_stripplot.py` — Boxplot with individual points, n<10 per group
- `box_multi_group.R` — Multi-group boxplot with significance brackets
- `scatter_regression.py` — Scatter with linear regression and confidence band
- `scatter_correlation.R` — Correlation scatter with marginal distributions
- `bar_with_points.py` — Bar chart overlaid with individual data points
- `bar_grouped.R` — Grouped bar chart with error bars
- `line_time_series.py` — Multi-line time series with SEM ribbons
- `line_dose_response.R` — Dose-response line plot with direct labels

## Pattern-Level Parameters to Preserve

- Point size and jitter width by sample size
- Bar width (0.6-0.7) and spacing
- Error bar type (SEM vs SD vs CI) and lineweight
- Statistical bracket height and font size
- Line count limit (≤4 per plot) and direct label positioning
