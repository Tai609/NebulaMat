"""
Pattern Reference: RNA-seq Differential Expression Volcano Plot
==============================================================
Figure type: Volcano plot (log2FC vs -log10 padj)
Target: Single-column (89mm), Nature Communications standard
Data: DESeq2 output from RNA-seq experiment (~5000 genes)
Proven through: pattern derived from published CNS volcano plots

When using this as a reference for a new volcano plot:
- PRESERVE: color scheme, alpha values, point sizing, threshold line styles,
  legend placement, font sizes, spine removal, export parameters
- REPLACE: data loading section, gene labels, title/journal-specific dimensions
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib as mpl

# ============================================================
# GLOBAL STYLE — PRESERVE THIS BLOCK
# ============================================================
mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "Liberation Sans"],
    "font.size": 7,
    "axes.labelsize": 7,
    "xtick.labelsize": 6,
    "ytick.labelsize": 6,
    "legend.fontsize": 6,
    "pdf.fonttype": 42,
    "svg.fonttype": "none",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.6,
    "xtick.direction": "out",
    "ytick.direction": "out",
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
})

# ============================================================
# COLOR PALETTE — PRESERVE (CNS standard 3-category semantic)
# ============================================================
GREY  = "#999999"  # Not significant (background density)
BLUE  = "#2166AC"  # Significant, low fold-change
RED   = "#B2182B"  # Significant, high fold-change (accent)
THRESHOLD_COLOR = "#555555"  # Threshold annotation lines

# ============================================================
# DIMENSIONS — PRESERVE layout ratio, ADAPT width to journal
# ============================================================
mm_to_inch = 1 / 25.4
FIG_W = 89 * mm_to_inch   # Single-column: 89mm
FIG_H = 80 * mm_to_inch   # Height: 80mm is well-proportioned

# ============================================================
# PARAMETERS — PRESERVE these proven values
# ============================================================
ALPHA_THRESHOLD = 0.05      # Adjusted p-value (FDR) — CNS default
FC_CUTOFF = 1.0             # |log2FC| > 1 (2-fold change)
POINT_SIZE = 3              # For ~5000 features
POINT_ALPHA_NS = 0.4        # NS points: translucent for density
POINT_ALPHA_SIG = 0.6       # Sig points: more visible
TOP_LABELS = 10             # Label top-N genes by significance
LABEL_FONTSIZE = 5          # Gene labels: small, italic
LABEL_OFFSET = (5, 5)       # xytext offset in points

# ============================================================
# DATA LOADING — REPLACE THIS SECTION with your data source
# ============================================================
# Example: df = pd.read_csv("deseq2_results.csv")
# Required columns: gene (str), log2FC (float), padj (float)
# Minimum: 100 features

np.random.seed(42)  # Remove in production
n_genes = 5000

# Simulated DESeq2 output (REPLACE with real data)
log2FC_null = np.random.normal(0, 0.3, n_genes)
pval_null   = np.random.uniform(0.01, 1.0, n_genes)
n_de = 200
log2FC_de = np.concatenate([
    np.random.normal(2.0, 0.5, n_de // 2),
    np.random.normal(-1.8, 0.5, n_de // 2),
])
pval_de = 10 ** (-np.random.uniform(2, 30, n_de))

log2FC = np.concatenate([log2FC_null, log2FC_de])
pval   = np.concatenate([pval_null,   pval_de])
genes  = np.array([f"Gene_{i}" for i in range(n_genes + n_de)])

df = pd.DataFrame({"gene": genes, "log2FC": log2FC, "padj": pval})

# ============================================================
# DATA PREPROCESSING — PRESERVE this logic
# ============================================================
# Handle p=0 edge case (p=0 breaks -log10 scale)
df["padj"] = df["padj"].clip(lower=1e-300)

# Categorize by significance + fold-change
df["category"] = "NS"
df.loc[(df["padj"] < ALPHA_THRESHOLD) & (df["log2FC"].abs() < FC_CUTOFF), "category"] = "Sig_lowFC"
df.loc[(df["padj"] < ALPHA_THRESHOLD) & (df["log2FC"].abs() >= FC_CUTOFF), "category"] = "Sig_highFC"

# ============================================================
# FIGURE RENDERING — PRESERVE visual structure
# ============================================================
fig, ax = plt.subplots(figsize=(FIG_W, FIG_H))

# Plot by z-order: NS (bottom) → Sig_lowFC → Sig_highFC (top)
for cat, color, zorder, alpha in [
    ("NS",          GREY, 1, POINT_ALPHA_NS),
    ("Sig_lowFC",   BLUE, 2, POINT_ALPHA_SIG),
    ("Sig_highFC",  RED,  3, POINT_ALPHA_SIG),
]:
    subset = df[df["category"] == cat]
    ax.scatter(subset["log2FC"], -np.log10(subset["padj"]),
               c=color, s=POINT_SIZE, alpha=alpha,
               edgecolors="none", rasterized=True,
               zorder=zorder, label=f"{cat} ({len(subset)})")

# Significance threshold line (horizontal)
ax.axhline(-np.log10(ALPHA_THRESHOLD), color=THRESHOLD_COLOR,
           linestyle="--", linewidth=0.5, alpha=0.7)

# Fold-change threshold lines (vertical)
ax.axvline( FC_CUTOFF, color=THRESHOLD_COLOR, linestyle="--", linewidth=0.5, alpha=0.7)
ax.axvline(-FC_CUTOFF, color=THRESHOLD_COLOR, linestyle="--", linewidth=0.5, alpha=0.7)

# Annotate threshold value
ax.text(ax.get_xlim()[1] * 0.95, -np.log10(ALPHA_THRESHOLD) + 0.3,
        f"padj = {ALPHA_THRESHOLD}", fontsize=5, color=THRESHOLD_COLOR,
        ha="right", va="bottom")

# Label top genes (PRESERVE: label only most significant in highFC category)
top_hits = df[df["category"] == "Sig_highFC"].nsmallest(TOP_LABELS, "padj")
for _, row in top_hits.iterrows():
    ax.annotate(row["gene"],
                (row["log2FC"], -np.log10(row["padj"])),
                fontsize=LABEL_FONTSIZE, fontstyle="italic",
                xytext=LABEL_OFFSET, textcoords="offset points",
                color=RED, alpha=0.9)

# Axes labels — PRESERVE formula notation
ax.set_xlabel("log$_{2}$(Fold Change)", fontsize=7)
ax.set_ylabel("−log$_{10}$(adjusted p-value)", fontsize=7)

# Legend outside plot — PRESERVE position
ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left",
          frameon=False, fontsize=5, title="Category", title_fontsize=6)

# Hit count annotation — PRESERVE position and style
n_up = len(df[(df["category"] == "Sig_highFC") & (df["log2FC"] > 0)])
n_dn = len(df[(df["category"] == "Sig_highFC") & (df["log2FC"] < 0)])
ax.text(0.02, 0.98, f"Up: {n_up}  |  Down: {n_dn}",
        transform=ax.transAxes, fontsize=6, va="top",
        bbox=dict(boxstyle="round,pad=0.3", facecolor="white",
                  edgecolor="none", alpha=0.8))

# ============================================================
# EXPORT — PRESERVE format settings
# ============================================================
fig.savefig("volcano_deseq2.pdf", bbox_inches="tight", dpi=300)
fig.savefig("volcano_deseq2.png", bbox_inches="tight", dpi=300)
plt.close()

print("Delivered: volcano_deseq2.pdf (vector) + volcano_deseq2.png (300dpi preview)")
print(f"Results: {n_up} upregulated, {n_dn} downregulated (padj<{ALPHA_THRESHOLD}, |log2FC|>{FC_CUTOFF})")
