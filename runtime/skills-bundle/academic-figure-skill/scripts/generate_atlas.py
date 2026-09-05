#!/usr/bin/env python3
"""
Academic Figure Skill Chart Atlas Generator.

Generates 5 atlas grid images (4x4 subplots each) demonstrating Academic Figure Skill's
visual grammar range using pure matplotlib with CNS standard styling.

Output: academic-figure-skill/assets/chart-atlas/atlas-*.png
"""

import os
import sys
import warnings
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import matplotlib.patches as mpatches
from matplotlib.colors import LinearSegmentedColormap
from scipy import stats
from scipy.cluster.hierarchy import linkage, dendrogram

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "assets", "chart-atlas")

# ---------------------------------------------------------------------------
# Academic Figure Skill color palette
# ---------------------------------------------------------------------------
CNS_COLORS = {
    "green":   "#1B7837",
    "purple":  "#762A83",
    "blue":    "#2166AC",
    "red":     "#B2182B",
    "orange":  "#F1A340",
    "gray":    "#999999",
    "light_gray": "#CCCCCC",
    "dark_gray": "#666666",
    "bg":      "#F7F7F7",
}
CNS_PALETTE = [
    CNS_COLORS["blue"],
    CNS_COLORS["red"],
    CNS_COLORS["green"],
    CNS_COLORS["purple"],
    CNS_COLORS["orange"],
    CNS_COLORS["gray"],
]
CNS_DIVERGING_CMAP = LinearSegmentedColormap.from_list(
    "cns_diverging",
    [CNS_COLORS["blue"], CNS_COLORS["bg"], CNS_COLORS["red"]],
    N=256,
)
CNS_SEQUENTIAL_CMAP = LinearSegmentedColormap.from_list(
    "cns_sequential",
    [CNS_COLORS["bg"], CNS_COLORS["blue"]],
    N=256,
)

# ---------------------------------------------------------------------------
# Global matplotlib rcParams
# ---------------------------------------------------------------------------
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 5,
    "axes.titlesize": 5.5,
    "axes.labelsize": 5,
    "xtick.labelsize": 4,
    "ytick.labelsize": 4,
    "legend.fontsize": 4,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.05,
    "axes.linewidth": 0.5,
    "xtick.major.width": 0.4,
    "ytick.major.width": 0.4,
    "xtick.major.size": 2,
    "ytick.major.size": 2,
    "lines.linewidth": 0.8,
    "lines.markersize": 2.5,
    "patch.linewidth": 0.3,
    "errorbar.capsize": 1.5,
})

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def set_seed(seed=42):
    np.random.seed(seed)

def style_ax(ax, hide_spines=("top", "right")):
    """Apply CNS clean style to an axis: remove specified spines."""
    for spine in hide_spines:
        ax.spines[spine].set_visible(False)

def add_panel_label(ax, label, x=-0.1, y=1.05):
    """Add lowercase bold panel label in top-left."""
    ax.text(
        x, y, label, transform=ax.transAxes,
        fontsize=6, fontweight="bold", fontfamily="sans-serif",
        va="top", ha="left", color="black",
    )

def add_panel_label_inside(ax, label):
    """Add panel label inside top-left corner."""
    ax.text(
        0.03, 0.94, label, transform=ax.transAxes,
        fontsize=5.5, fontweight="bold", fontfamily="sans-serif",
        va="top", ha="left", color=CNS_COLORS["dark_gray"],
    )

def _alpha_color(hex_color, alpha):
    """Convert a hex color to RGBA with given alpha."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255
    return (r, g, b, alpha)

LABELS = list("abcdefghijklmnop")

# ---------------------------------------------------------------------------
# Atlas 1: Bar Charts (16 variants)
# ---------------------------------------------------------------------------

def _bar_grouped(ax):
    """a) Grouped bars."""
    groups = 4
    n_per = 3
    data = np.random.RandomState(100).normal(loc=[3, 5, 4], scale=[0.5, 0.7, 0.6],
                                              size=(groups, n_per))
    data = np.abs(data)
    x = np.arange(groups)
    w = 0.22
    colors = CNS_PALETTE[:n_per]
    for i in range(n_per):
        ax.bar(x + i * w, data[:, i], w, color=colors[i], edgecolor="white", linewidth=0.2)
    ax.set_xticks(x + w)
    ax.set_xticklabels([], fontsize=3)
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[0])

def _bar_stacked(ax):
    """b) Stacked bars."""
    groups = 5
    n_parts = 3
    data = np.random.RandomState(101).rand(groups, n_parts) * 3 + 1
    x = np.arange(groups)
    colors = CNS_PALETTE[:n_parts]
    bottom = np.zeros(groups)
    for i in range(n_parts):
        ax.bar(x, data[:, i], 0.6, bottom=bottom, color=colors[i],
               edgecolor="white", linewidth=0.2)
        bottom += data[:, i]
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[1])

def _bar_horizontal(ax):
    """c) Horizontal bars."""
    groups = 6
    data = np.random.RandomState(102).normal(loc=4, scale=1.5, size=groups)
    data = np.abs(data)
    y = np.arange(groups)
    colors = [CNS_PALETTE[i % len(CNS_PALETTE)] for i in range(groups)]
    ax.barh(y, data, 0.55, color=colors, edgecolor="white", linewidth=0.2)
    ax.set_yticks([])
    ax.set_xticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[2])

def _bar_points(ax):
    """d) Bars with individual points overlaid."""
    groups = 4
    n_per = 8
    means = np.random.RandomState(103).normal(loc=[3, 5, 4, 4.5], scale=0.4, size=groups)
    means = np.abs(means)
    x = np.arange(groups)
    ax.bar(x, means, 0.5, color=CNS_COLORS["light_gray"], edgecolor="white", linewidth=0.2,
           zorder=1)
    for i in range(groups):
        pts = np.random.RandomState(200 + i).normal(loc=means[i], scale=0.35, size=n_per)
        pts = np.abs(pts)
        ax.scatter(np.full(n_per, x[i]) + np.random.RandomState(300 + i).uniform(-0.12, 0.12, n_per),
                   pts, s=6, color=CNS_PALETTE[i], zorder=2, edgecolors="white", linewidth=0.1,
                   alpha=0.7)
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[3])

def _bar_significance(ax):
    """e) Grouped bars with significance brackets."""
    groups = 3
    n_per = 2
    data = np.random.RandomState(104).normal(loc=[[2, 5], [2.3, 5.8], [2.1, 4.5]],
                                              scale=[[0.4, 0.5], [0.5, 0.6], [0.4, 0.5]])
    data = np.abs(data)
    x = np.arange(groups)
    w = 0.28
    colors = [CNS_COLORS["blue"], CNS_COLORS["green"]]
    for i in range(n_per):
        ax.bar(x + i * w, data[:, i], w, color=colors[i], edgecolor="white", linewidth=0.2)
    y_max = data.max() + 1
    # bracket between group 0/1 and 1/2
    for (g1, g2), h_off in zip([(0, 1), (1, 2)], [0.3, 0.6]):
        y = y_max + h_off
        ax.plot([x[g1] + w, x[g1] + w, x[g2] + w, x[g2] + w],
                [y - 0.2, y, y, y - 0.2],
                color=CNS_COLORS["dark_gray"], linewidth=0.5, clip_on=False)
        ax.text((x[g1] + x[g2]) / 2 + w, y + 0.08, "*", ha="center", fontsize=6,
                color=CNS_COLORS["red"])
    ax.set_xticks(x + w / 2)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[4])

def _bar_paired(ax):
    """f) Paired before/after bars."""
    pairs = 8
    before = np.random.RandomState(105).normal(loc=3, scale=0.6, size=pairs)
    before = np.abs(before)
    after = before + np.random.RandomState(106).normal(loc=-0.2, scale=0.5, size=pairs)
    after = np.abs(after)
    x = np.arange(pairs)
    w = 0.3
    ax.bar(x - w / 2, before, w, color=CNS_COLORS["gray"], edgecolor="white", linewidth=0.2,
           label="Before")
    ax.bar(x + w / 2, after, w, color=CNS_COLORS["blue"], edgecolor="white", linewidth=0.2,
           label="After")
    for i in range(pairs):
        ax.plot([x[i] - w / 2, x[i] + w / 2], [before[i], after[i]],
                color=CNS_COLORS["dark_gray"], linewidth=0.3, alpha=0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[5])

def _bar_dotplot(ax):
    """g) Dot plot (mean + individual points)."""
    groups = 5
    n_per = 10
    x = np.arange(groups)
    for i in range(groups):
        pts = np.random.RandomState(300 + i).normal(loc=3 + i * 0.4, scale=0.3, size=n_per)
        pts = np.abs(pts)
        ax.scatter(np.full(n_per, x[i]) + np.random.RandomState(400 + i).uniform(-0.1, 0.1, n_per),
                   pts, s=4, color=CNS_COLORS["light_gray"], zorder=1, edgecolors="none",
                   alpha=0.6)
        mean_val = pts.mean()
        ax.plot([x[i] - 0.25, x[i] + 0.25], [mean_val, mean_val],
                color=CNS_COLORS["red"], linewidth=1.5, zorder=2)
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[6])

def _bar_stripplot_overlay(ax):
    """h) Bar chart with stripplot overlay."""
    groups = 4
    n_per = 12
    means = np.random.RandomState(107).uniform(2, 5, groups)
    x = np.arange(groups)
    ax.bar(x, means, 0.5, color=_alpha_color(CNS_COLORS["blue"], 0.35),
           edgecolor=CNS_COLORS["blue"], linewidth=0.3, zorder=1)
    for i in range(groups):
        pts = np.random.RandomState(500 + i).normal(loc=means[i], scale=0.8, size=n_per)
        pts = np.abs(pts)
        ax.scatter(np.full(n_per, x[i]) + np.random.RandomState(600 + i).uniform(-0.14, 0.14, n_per),
                   pts, s=5, color=CNS_COLORS["dark_gray"], zorder=2, edgecolors="none",
                   alpha=0.55)
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[7])

def _bar_full_stacked(ax):
    """i) 100% stacked bars."""
    groups = 5
    n_parts = 3
    data = np.random.RandomState(108).rand(groups, n_parts) * 5 + 1
    data_sum = data.sum(axis=1, keepdims=True)
    data_pct = data / data_sum
    x = np.arange(groups)
    colors = CNS_PALETTE[:n_parts]
    bottom = np.zeros(groups)
    for i in range(n_parts):
        ax.bar(x, data_pct[:, i], 0.55, bottom=bottom, color=colors[i],
               edgecolor="white", linewidth=0.2)
        bottom += data_pct[:, i]
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[8])

def _bar_diverging(ax):
    """j) Diverging bar chart."""
    n = 12
    data = np.random.RandomState(109).normal(loc=0, scale=2, size=n)
    y = np.arange(n)
    colors = [CNS_COLORS["red"] if v > 0 else CNS_COLORS["blue"] for v in data]
    ax.barh(y, data, 0.55, color=colors, edgecolor="white", linewidth=0.15)
    ax.axvline(0, color="black", linewidth=0.4)
    ax.set_yticks([])
    ax.set_xticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[9])

def _bar_waterfall(ax):
    """k) Waterfall bar chart."""
    n = 8
    changes = np.random.RandomState(110).normal(loc=0, scale=1.5, size=n)
    cumulative = np.zeros(n + 1)
    for i in range(n):
        cumulative[i + 1] = cumulative[i] + changes[i]
    x = np.arange(n + 1)
    ax.plot(x, cumulative, "o-", color=CNS_COLORS["blue"], markersize=2,
            linewidth=0.8, zorder=2)
    for i in range(n):
        color = CNS_COLORS["green"] if changes[i] > 0 else CNS_COLORS["red"]
        ax.bar(i, changes[i], 0.4, bottom=cumulative[i], color=color,
               edgecolor="white", linewidth=0.15, zorder=1)
    ax.axhline(0, color="black", linewidth=0.4)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[10])

def _bar_lollipop(ax):
    """l) Lollipop chart."""
    n = 9
    data = np.random.RandomState(111).uniform(1, 8, n)
    data.sort()
    y = np.arange(n)
    ax.hlines(y, 0, data, color=CNS_COLORS["light_gray"], linewidth=1.2, zorder=1)
    ax.scatter(data, y, s=18, color=CNS_COLORS["blue"], zorder=2, edgecolors="white",
               linewidth=0.3)
    ax.set_yticks([])
    ax.set_xticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[11])

def _bar_percent_h(ax):
    """m) Percent stacked horizontal bars."""
    groups = 5
    n_parts = 3
    data = np.random.RandomState(112).rand(groups, n_parts) * 4 + 1
    data_pct = data / data.sum(axis=1, keepdims=True)
    y = np.arange(groups)
    colors = CNS_PALETTE[:n_parts]
    left = np.zeros(groups)
    for i in range(n_parts):
        ax.barh(y, data_pct[:, i], 0.5, left=left, color=colors[i],
                edgecolor="white", linewidth=0.2)
        left += data_pct[:, i]
    ax.set_yticks([])
    ax.set_xticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[12])

def _bar_nested(ax):
    """n) Nested grouped bars."""
    groups = 3
    n_outer = 2
    n_inner = 2
    x = np.arange(groups)
    outer_w = 0.55
    inner_w = 0.22
    offsets = [-0.15, 0.15]
    outer_colors = [CNS_COLORS["blue"], CNS_COLORS["green"]]
    inner_colors = [_alpha_color(CNS_COLORS["blue"], 0.6), _alpha_color(CNS_COLORS["blue"], 0.35),
                    _alpha_color(CNS_COLORS["green"], 0.6), _alpha_color(CNS_COLORS["green"], 0.35)]
    for j in range(n_outer):
        for k in range(n_inner):
            vals = np.random.RandomState(113 + j * 10 + k).uniform(1, 4, groups)
            ax.bar(x + offsets[j] + (k - 0.5) * inner_w, vals, inner_w,
                   color=inner_colors[j * 2 + k], edgecolor="white", linewidth=0.15)
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[13])

def _bar_error_only(ax):
    """o) Error-bar only chart (mean +/- SEM)."""
    groups = 6
    means = np.random.RandomState(114).uniform(2, 6, groups)
    errors = np.random.RandomState(115).uniform(0.2, 1.0, groups)
    x = np.arange(groups)
    colors = [CNS_PALETTE[i % len(CNS_PALETTE)] for i in range(groups)]
    ax.errorbar(x, means, yerr=errors, fmt="o", color=CNS_COLORS["dark_gray"],
                markersize=4, linewidth=0.8, capsize=2, zorder=2)
    for i in range(groups):
        ax.plot([x[i], x[i]], [means[i] - errors[i], means[i] + errors[i]],
                color=colors[i], linewidth=2, zorder=1, alpha=0.6)
    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[14])

def _bar_range(ax):
    """p) Range/interval bar chart."""
    n = 8
    mins = np.random.RandomState(116).uniform(0.5, 3, n)
    maxs = mins + np.random.RandomState(117).uniform(2, 5, n)
    means = (mins + maxs) / 2
    y = np.arange(n)
    ax.hlines(y, mins, maxs, color=CNS_COLORS["light_gray"], linewidth=2, zorder=1)
    ax.scatter(means, y, s=14, color=CNS_COLORS["blue"], zorder=2, edgecolors="white",
               linewidth=0.3)
    ax.scatter(mins, y, s=8, color=CNS_COLORS["gray"], zorder=2, edgecolors="white",
               linewidth=0.2, marker="|")
    ax.scatter(maxs, y, s=8, color=CNS_COLORS["gray"], zorder=2, edgecolors="white",
               linewidth=0.2, marker="|")
    ax.set_yticks([])
    ax.set_xticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[15])

BAR_PANELS = [
    _bar_grouped, _bar_stacked, _bar_horizontal, _bar_points,
    _bar_significance, _bar_paired, _bar_dotplot, _bar_stripplot_overlay,
    _bar_full_stacked, _bar_diverging, _bar_waterfall, _bar_lollipop,
    _bar_percent_h, _bar_nested, _bar_error_only, _bar_range,
]

# ---------------------------------------------------------------------------
# Atlas 2: Line / Scatter (16 variants)
# ---------------------------------------------------------------------------

def _scatter_simple(ax):
    """a) Simple scatter plot."""
    n = 60
    x = np.random.RandomState(200).uniform(0, 10, n)
    y = x * 0.7 + np.random.RandomState(201).normal(loc=0, scale=1.2, size=n)
    ax.scatter(x, y, s=6, color=CNS_COLORS["blue"], edgecolors="white", linewidth=0.1,
               alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[0])

def _scatter_regression(ax):
    """b) Scatter with regression line and CI band."""
    n = 50
    x = np.random.RandomState(202).uniform(0, 10, n)
    y = 2 + 0.6 * x + np.random.RandomState(203).normal(loc=0, scale=1.5, size=n)
    ax.scatter(x, y, s=6, color=CNS_COLORS["blue"], edgecolors="white", linewidth=0.1,
               alpha=0.6)
    slope, intercept, r_val, _, _ = stats.linregress(x, y)
    x_line = np.linspace(x.min(), x.max(), 100)
    y_line = intercept + slope * x_line
    n_pts = len(x)
    x_mean = x.mean()
    ssx = np.sum((x - x_mean) ** 2)
    se = np.sqrt(np.sum((y - (intercept + slope * x)) ** 2) / (n_pts - 2))
    ci = 1.96 * se * np.sqrt(1 / n_pts + (x_line - x_mean) ** 2 / ssx)
    ax.fill_between(x_line, y_line - ci, y_line + ci, color=CNS_COLORS["blue"],
                    alpha=0.12, zorder=0)
    ax.plot(x_line, y_line, color=CNS_COLORS["red"], linewidth=1, zorder=2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[1])

def _line_multiseries(ax):
    """c) Multi-line time series."""
    n = 30
    for i in range(4):
        base = np.random.RandomState(204 + i).uniform(0, 3)
        trend = np.linspace(0, np.random.RandomState(220 + i).uniform(1, 4), n)
        noise = np.random.RandomState(230 + i).normal(0, 0.3, n)
        y = base + trend + noise
        ax.plot(range(n), y, color=CNS_PALETTE[i], linewidth=0.8, alpha=0.8)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[2])

def _scatter_doseresponse(ax):
    """d) Dose-response curve."""
    doses = np.logspace(-1, 2, 8)
    response = 100 / (1 + np.exp(-(np.log10(doses) - 0.6) * 3))
    noise = np.random.RandomState(205).normal(0, 3, len(doses))
    y = response + noise
    ax.scatter(doses, y, s=10, color=CNS_COLORS["blue"], zorder=2, edgecolors="white",
               linewidth=0.2)
    x_smooth = np.logspace(-1, 2, 100)
    y_smooth = 100 / (1 + np.exp(-(np.log10(x_smooth) - 0.6) * 3))
    ax.plot(x_smooth, y_smooth, color=CNS_COLORS["red"], linewidth=0.8, zorder=1)
    ax.set_xscale("log")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[3])

def _scatter_correlation(ax):
    """e) Correlation scatter plot."""
    n = 40
    x = np.random.RandomState(206).uniform(0, 10, n)
    y = x * 0.75 + np.random.RandomState(207).normal(0, 1.2, n)
    r_val, _ = stats.pearsonr(x, y)
    ax.scatter(x, y, s=7, color=CNS_COLORS["purple"], edgecolors="white", linewidth=0.1,
               alpha=0.6)
    ax.text(0.95, 0.08, f"r={r_val:.2f}", transform=ax.transAxes, fontsize=4,
            ha="right", va="bottom", color=CNS_COLORS["dark_gray"])
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[4])

def _scatter_bubble(ax):
    """f) Bubble chart."""
    n = 30
    x = np.random.RandomState(208).uniform(0, 10, n)
    y = np.random.RandomState(209).uniform(0, 10, n)
    sizes = np.random.RandomState(210).uniform(10, 60, n)
    colors = np.random.RandomState(211).choice(CNS_PALETTE[:4], n)
    ax.scatter(x, y, s=sizes, c=colors, edgecolors="white", linewidth=0.2, alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[5])

def _line_sem_ribbon(ax):
    """g) Line chart with SEM ribbon."""
    n = 20
    x = np.arange(n)
    mean = np.sin(np.linspace(0, 2 * np.pi, n)) * 2 + 5
    err = 0.4 + np.random.RandomState(212).uniform(0.1, 0.6, n)
    ax.fill_between(x, mean - err, mean + err, color=CNS_COLORS["blue"], alpha=0.15, zorder=0)
    ax.plot(x, mean, color=CNS_COLORS["blue"], linewidth=1, zorder=2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[6])

def _scatter_marginal_hist(ax):
    """h) Scatter with marginal histograms (manually via insets)."""
    n = 80
    x = np.random.RandomState(213).normal(loc=5, scale=1.5, size=n)
    y = 0.5 * x + np.random.RandomState(214).normal(loc=0, scale=1, size=n)
    ax.scatter(x, y, s=5, color=CNS_COLORS["blue"], edgecolors="white", linewidth=0.1,
               alpha=0.5, zorder=2)
    # top marginal
    ax_top = ax.inset_axes([0, 1.02, 1, 0.18], sharex=ax)
    ax_top.hist(x, bins=15, color=CNS_COLORS["blue"], alpha=0.5, edgecolor="white",
                linewidth=0.1)
    ax_top.set_xticks([])
    ax_top.set_yticks([])
    style_ax(ax_top, ("top", "right", "left"))
    # right marginal
    ax_right = ax.inset_axes([1.02, 0, 0.18, 1], sharey=ax)
    ax_right.hist(y, bins=15, orientation="horizontal", color=CNS_COLORS["green"],
                  alpha=0.5, edgecolor="white", linewidth=0.1)
    ax_right.set_xticks([])
    ax_right.set_yticks([])
    style_ax(ax_right, ("top", "right", "bottom"))
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[7])

def _line_step(ax):
    """i) Step plot."""
    n = 25
    x = np.arange(n)
    y = np.random.RandomState(215).uniform(1, 5, n).cumsum() / 5
    ax.step(x, y, where="mid", color=CNS_COLORS["purple"], linewidth=1)
    ax.fill_between(x, 0, y, step="mid", color=_alpha_color(CNS_COLORS["purple"], 0.12))
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[8])

def _scatter_connected(ax):
    """j) Connected scatter plot."""
    n = 15
    x = np.arange(n)
    y = np.random.RandomState(216).normal(loc=0, scale=1, size=n).cumsum() + 5
    ax.plot(x, y, "-", color=CNS_COLORS["light_gray"], linewidth=0.6, zorder=1)
    colors = plt.cm.RdYlGn((y - y.min()) / (y.max() - y.min() + 1e-9))
    ax.scatter(x, y, s=14, c=[CNS_COLORS["blue"] if yi < y.mean() else CNS_COLORS["red"]
                             for yi in y],
               edgecolors="white", linewidth=0.2, zorder=2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[9])

def _scatter_multigroup(ax):
    """k) Multiple group scatter with different markers."""
    n = 25
    groups = 3
    markers = ["o", "s", "D"]
    for i in range(groups):
        x = np.random.RandomState(217 + i).uniform(0, 8, n)
        y = i * 2 + x * 0.4 + np.random.RandomState(230 + i).normal(0, 0.6, n)
        ax.scatter(x, y, s=8, marker=markers[i], color=CNS_PALETTE[i],
                   edgecolors="white", linewidth=0.1, alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[10])

def _scatter_loess(ax):
    """l) Scatter with LOESS smooth curve."""
    n = 50
    x = np.random.RandomState(218).uniform(0, 10, n)
    y = np.sin(x * 0.7) * 3 + x * 0.3 + np.random.RandomState(219).normal(0, 1, n)
    ax.scatter(x, y, s=5, color=_alpha_color(CNS_COLORS["blue"], 0.5), edgecolors="none",
               zorder=2)
    # lowess-style smooth using moving average
    sort_idx = np.argsort(x)
    x_s = x[sort_idx]
    y_s = y[sort_idx]
    # simple rolling average as proxy for LOESS
    window = 10
    y_loess = np.convolve(y_s, np.ones(window) / window, mode="same")
    ax.plot(x_s[window:-window], y_loess[window:-window], color=CNS_COLORS["red"],
            linewidth=1.2, zorder=3)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[11])

def _line_stem(ax):
    """m) Stem plot."""
    n = 20
    x = np.arange(n)
    y = np.random.RandomState(240).normal(loc=0, scale=1.5, size=n)
    markers, stems, baseline = ax.stem(x, y, linefmt="-", markerfmt="o", basefmt="k-")
    markers.set_color(CNS_COLORS["blue"])
    markers.set_markersize(3)
    markers.set_markeredgecolor("white")
    markers.set_markeredgewidth(0.15)
    stems.set_color(CNS_COLORS["light_gray"])
    stems.set_linewidth(0.6)
    baseline.set_color("black")
    baseline.set_linewidth(0.4)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[12])

def _scatter_polar(ax):
    """n) Polar scatter."""
    n = 40
    r = np.random.RandomState(241).uniform(0.5, 3, n)
    theta = np.random.RandomState(242).uniform(0, 2 * np.pi, n)
    cvals = np.random.RandomState(243).choice(CNS_PALETTE[:3], n)
    ax.scatter(theta, r, s=10, c=cvals, edgecolors="white", linewidth=0.2, alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[13])

def _line_area(ax):
    """o) Area chart with points."""
    n = 25
    x = np.arange(n)
    y = np.random.RandomState(244).uniform(1, 3, n).cumsum()
    y = y / y.max() * 5 + 1
    ax.fill_between(x, 0, y, color=_alpha_color(CNS_COLORS["green"], 0.2), zorder=0)
    ax.plot(x, y, "o-", color=CNS_COLORS["green"], markersize=3, linewidth=0.8, zorder=2,
            markerfacecolor="white", markeredgewidth=0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[14])

def _line_highlight(ax):
    """p) Line plot with highlighted region."""
    n = 40
    x = np.arange(n)
    y = np.random.RandomState(245).normal(0, 0.5, n).cumsum() + 3
    ax.plot(x, y, color=CNS_COLORS["blue"], linewidth=1, zorder=2)
    # highlight a region
    hl_start, hl_end = 12, 22
    ax.axvspan(hl_start, hl_end, color=_alpha_color(CNS_COLORS["orange"], 0.2), zorder=0)
    ax.plot(x[hl_start:hl_end + 1], y[hl_start:hl_end + 1], color=CNS_COLORS["red"],
            linewidth=1.5, zorder=3)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[15])

LINE_SCATTER_PANELS = [
    _scatter_simple, _scatter_regression, _line_multiseries, _scatter_doseresponse,
    _scatter_correlation, _scatter_bubble, _line_sem_ribbon, _scatter_marginal_hist,
    _line_step, _scatter_connected, _scatter_multigroup, _scatter_loess,
    _line_stem, _scatter_polar, _line_area, _line_highlight,
]

# ---------------------------------------------------------------------------
# Atlas 3: Heatmaps (16 variants)
# ---------------------------------------------------------------------------

def _heatmap_diverging(ax):
    """a) Diverging expression heatmap."""
    data = np.random.RandomState(300).normal(loc=0, scale=1, size=(10, 14))
    im = ax.imshow(data, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2.5, vmax=2.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[0])

def _heatmap_correlation_masked(ax):
    """b) Correlation matrix (upper triangle masked)."""
    n = 8
    raw = np.random.RandomState(301).normal(size=(10, n))
    corr = np.corrcoef(raw.T)
    mask = np.tril(np.ones_like(corr, dtype=bool))
    corr_masked = np.ma.array(corr, mask=mask)
    im = ax.imshow(corr_masked, cmap=CNS_SEQUENTIAL_CMAP, aspect="auto",
                   vmin=0, vmax=1)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[1])

def _heatmap_annotated(ax):
    """c) Annotated heatmap with values."""
    data = np.random.RandomState(302).uniform(0, 1, (5, 6))
    im = ax.imshow(data, cmap=CNS_SEQUENTIAL_CMAP, aspect="auto", vmin=0, vmax=1)
    for i in range(data.shape[0]):
        for j in range(data.shape[1]):
            ax.text(j, i, f"{data[i, j]:.1f}", ha="center", va="center",
                    fontsize=3.5, color="white" if data[i, j] > 0.5 else CNS_COLORS["dark_gray"])
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[2])

def _heatmap_split(ax):
    """d) Split heatmap (two colormaps)."""
    data = np.random.RandomState(303).normal(loc=0, scale=1, size=(10, 12))
    left = data[:, :6]
    right = data[:, 6:]
    im_left = ax.imshow(left, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2.5, vmax=2.5,
                       extent=[0, 6, 0, 10])
    ax.axvline(6, color="white", linewidth=1.5)
    im_right = ax.imshow(right, cmap=CNS_SEQUENTIAL_CMAP, aspect="auto", vmin=-2.5, vmax=2.5,
                         extent=[6, 12, 0, 10])
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[3])

def _heatmap_clustermap(ax):
    """e) Simple clustermap (heatmap + dendrogram-like side decoration)."""
    data = np.random.RandomState(304).normal(loc=0, scale=1, size=(10, 12))
    row_order = np.argsort(data.mean(axis=1))
    col_order = np.argsort(data.sum(axis=0))
    data_sorted = data[row_order][:, col_order]
    # Main heatmap with reduced extent to leave room for dendrogram
    im = ax.imshow(data_sorted, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2.5, vmax=2.5,
                   extent=[0, data.shape[1], 0, data.shape[0]])
    # Column dendrogram above
    Z_col = linkage(data.T, method="ward")
    dn_col = dendrogram(Z_col, no_plot=True)
    leaves_col = dn_col["leaves"]
    # Draw simple tree lines above the heatmap
    from collections import defaultdict
    icoord = dn_col["icoord"]
    dcoord = dn_col["dcoord"]
    # Scale dendrogram coordinates to fit above heatmap
    d_max = max(max(d) for d in dcoord) if dcoord else 1
    scale_y = 1.5 / d_max
    scale_x = data.shape[1] / 10.0
    for ic, dc in zip(icoord, dcoord):
        xs = [(v / 10.0) * data.shape[1] for v in ic]
        ys = [data.shape[0] + v * scale_y for v in dc]
        ax.plot(xs, ys, color=CNS_COLORS["dark_gray"], linewidth=0.25, clip_on=False)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_ylim(0, data.shape[0] + 2)
    ax.set_xlim(-0.5, data.shape[1] - 0.5)
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[4])

def _heatmap_density(ax):
    """f) Density heatmap (2D histogram)."""
    x = np.random.RandomState(305).normal(loc=0, scale=1, size=500)
    y = 0.5 * x + np.random.RandomState(306).normal(loc=0, scale=0.8, size=500)
    h = ax.hist2d(x, y, bins=20, cmap=CNS_SEQUENTIAL_CMAP, edgecolor="none")[3]
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[5])

def _heatmap_categorical(ax):
    """g) Categorical heatmap."""
    data = np.random.RandomState(307).randint(0, 5, (8, 10))
    cat_cmap = matplotlib.colors.ListedColormap(
        [CNS_COLORS["bg"], CNS_COLORS["light_gray"], CNS_COLORS["orange"],
         CNS_COLORS["blue"], CNS_COLORS["red"]]
    )
    im = ax.imshow(data, cmap=cat_cmap, aspect="auto", vmin=0, vmax=4)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(-0.5, data.shape[1] - 0.5)
    ax.set_ylim(-0.5, data.shape[0] - 0.5)
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[6])

def _heatmap_half_dendro(ax):
    """h) Heatmap + dendrogram half-and-half."""
    data = np.random.RandomState(308).normal(loc=0, scale=1, size=(10, 10))
    row_order = np.argsort(data.mean(axis=1))
    data_sorted = data[row_order]
    # right side: heatmap
    ax.imshow(data_sorted, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2.5, vmax=2.5,
              extent=[4, 10, 0, 10])
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    # left side: simulated dendrogram tree lines
    y_centers = np.arange(0.5, 10, 1)
    for i in range(len(y_centers) - 1):
        ax.plot([0.5, 3.5], [y_centers[i], y_centers[i]], color=CNS_COLORS["dark_gray"],
                linewidth=0.3)
    # vertical merge lines
    for i in range(0, len(y_centers) - 1, 2):
        mid_y = (y_centers[i] + y_centers[i + 1]) / 2
        ax.plot([2, 2], [y_centers[i], y_centers[i + 1]], color=CNS_COLORS["dark_gray"],
                linewidth=0.3)
        ax.plot([2, 3.5], [mid_y, mid_y], color=CNS_COLORS["dark_gray"], linewidth=0.3)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[7])

def _heatmap_upper_tri(ax):
    """i) Upper triangle correlation matrix."""
    n = 7
    raw = np.random.RandomState(309).normal(size=(15, n))
    corr = np.corrcoef(raw.T)
    mask = np.tril(np.ones_like(corr, dtype=bool), k=-1)
    corr_masked = np.ma.array(corr, mask=mask)
    im = ax.imshow(corr_masked, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-1, vmax=1)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[8])

def _heatmap_row_norm(ax):
    """j) Row-normalized (z-score) heatmap."""
    data = np.random.RandomState(310).uniform(0, 10, (10, 12))
    data_z = (data - data.mean(axis=1, keepdims=True)) / (data.std(axis=1, keepdims=True) + 1e-9)
    im = ax.imshow(data_z, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2, vmax=2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[9])

def _heatmap_discrete(ax):
    """k) Discrete/Boolean heatmap."""
    data = np.random.RandomState(311).choice([0, 0.5, 1], size=(8, 10))
    cmap = matplotlib.colors.ListedColormap([CNS_COLORS["bg"], CNS_COLORS["orange"], CNS_COLORS["blue"]])
    im = ax.imshow(data, cmap=cmap, aspect="auto", vmin=0, vmax=1)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(-0.5, data.shape[1] - 0.5)
    ax.set_ylim(-0.5, data.shape[0] - 0.5)
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[10])

def _heatmap_sparse(ax):
    """l) Sparse matrix heatmap."""
    data = np.random.RandomState(312).choice([0, 0, 0, 0.5, 1, 1.5, 2], size=(10, 12))
    im = ax.imshow(data, cmap=CNS_SEQUENTIAL_CMAP, aspect="auto", vmin=0, vmax=2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[11])

def _heatmap_annotations(ax):
    """m) Heatmap with row/column annotations."""
    data = np.random.RandomState(313).normal(loc=0, scale=1, size=(10, 12))
    im = ax.imshow(data, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2.5, vmax=2.5,
                   extent=[0, 12, 0, 10])
    # column annotation strip
    for j in range(data.shape[1]):
        ax.add_patch(plt.Rectangle((j, -0.4), 1, 0.4,
                                   facecolor=CNS_PALETTE[(j * 7) % len(CNS_PALETTE)],
                                   edgecolor="white", linewidth=0.1, clip_on=False))
    ax.set_xlim(0, 12)
    ax.set_ylim(-0.4, 10)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[12])

def _heatmap_gapped(ax):
    """n) Heatmap with gaps/spacing between groups."""
    data = np.random.RandomState(314).normal(loc=0, scale=1, size=(10, 12))
    ax.imshow(data, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-2.5, vmax=2.5)
    # add gap lines
    for sep in [3.5, 6.5, 9.5]:
        ax.axhline(sep, color="white", linewidth=1.2)
        ax.axvline(sep, color="white", linewidth=1.2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[13])

def _heatmap_binary(ax):
    """o) Binary/Boolean heatmap (presence/absence)."""
    data = np.random.RandomState(315).binomial(1, 0.35, size=(8, 10))
    cmap = matplotlib.colors.ListedColormap([CNS_COLORS["bg"], CNS_COLORS["blue"]])
    im = ax.imshow(data, cmap=cmap, aspect="auto", vmin=0, vmax=1)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[14])

def _heatmap_gradient(ax):
    """p) Smooth gradient heatmap (no grid lines)."""
    x = np.linspace(0, 4 * np.pi, 12)
    y = np.linspace(0, 3 * np.pi, 10)
    X, Y = np.meshgrid(x, y)
    Z = np.sin(X) * np.cos(Y)
    im = ax.imshow(Z, cmap=CNS_DIVERGING_CMAP, aspect="auto", vmin=-1, vmax=1,
                   interpolation="bilinear")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[15])

HEATMAP_PANELS = [
    _heatmap_diverging, _heatmap_correlation_masked, _heatmap_annotated, _heatmap_split,
    _heatmap_clustermap, _heatmap_density, _heatmap_categorical, _heatmap_half_dendro,
    _heatmap_upper_tri, _heatmap_row_norm, _heatmap_discrete, _heatmap_sparse,
    _heatmap_annotations, _heatmap_gapped, _heatmap_binary, _heatmap_gradient,
]

# ---------------------------------------------------------------------------
# Atlas 4: Distributions (16 variants)
# ---------------------------------------------------------------------------

def _dist_boxplot(ax):
    """a) Boxplot."""
    data = [np.random.RandomState(400 + i).normal(loc=3 + i * 0.6, scale=0.6 + i * 0.2,
            size=60) for i in range(4)]
    bp = ax.boxplot(data, patch_artist=True, widths=0.5, medianprops={"color": "white",
                    "linewidth": 0.8}, flierprops={"markersize": 2, "markerfacecolor":
                    CNS_COLORS["gray"]})
    for patch, color in zip(bp["boxes"], CNS_PALETTE[:4]):
        patch.set_facecolor(color)
        patch.set_edgecolor("white")
        patch.set_linewidth(0.2)
    ax.set_xticklabels([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[0])

def _dist_violin(ax):
    """b) Violin plot."""
    data = [np.random.RandomState(500 + i).normal(loc=3 + i * 0.6, scale=0.7 + i * 0.15,
            size=80) for i in range(4)]
    vp = ax.violinplot(data, positions=np.arange(4), showmeans=False, showmedians=True,
                       showextrema=True, widths=0.6)
    for i, body in enumerate(vp["bodies"]):
        body.set_facecolor(CNS_PALETTE[i])
        body.set_alpha(0.7)
        body.set_edgecolor("white")
        body.set_linewidth(0.2)
    for part in ["cmedians"]:
        if part in vp:
            vp[part].set_color("white")
            vp[part].set_linewidth(0.8)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[1])

def _dist_box_strip(ax):
    """c) Box + stripplot."""
    groups = 4
    n_per = 20
    for i in range(groups):
        pts = np.random.RandomState(600 + i).normal(loc=3 + i * 0.5, scale=0.6, size=n_per)
        x_jitter = np.random.RandomState(700 + i).uniform(-0.15, 0.15, n_per)
        ax.scatter(np.full(n_per, i) + x_jitter, pts, s=5, color=CNS_COLORS["dark_gray"],
                   edgecolors="none", alpha=0.4, zorder=2)
    bp = ax.boxplot([np.random.RandomState(800 + i).normal(loc=3 + i * 0.5, scale=0.6,
                     size=60) for i in range(4)], patch_artist=True, widths=0.35,
                     positions=np.arange(4), medianprops={"color": "white", "linewidth": 0.8},
                     flierprops={"markersize": 0.1})
    for patch, color in zip(bp["boxes"], CNS_PALETTE[:4]):
        patch.set_facecolor(_alpha_color(color, 0.6))
        patch.set_edgecolor("white")
        patch.set_linewidth(0.2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[2])

def _dist_histogram(ax):
    """d) Histogram."""
    data = np.random.RandomState(401).normal(loc=5, scale=1.5, size=200)
    ax.hist(data, bins=18, color=CNS_COLORS["blue"], edgecolor="white", linewidth=0.2,
            alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[3])

def _dist_kde_overlay(ax):
    """e) Histogram with KDE overlay."""
    data = np.random.RandomState(402).normal(loc=0, scale=1, size=300)
    bins = np.linspace(-4, 4, 25)
    ax.hist(data, bins=bins, density=True, color=CNS_COLORS["light_gray"], edgecolor="white",
            linewidth=0.2, alpha=0.6)
    # KDE
    kde = stats.gaussian_kde(data)
    x_kde = np.linspace(-4, 4, 200)
    ax.plot(x_kde, kde(x_kde), color=CNS_COLORS["red"], linewidth=1)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[4])

def _dist_ridgeline(ax):
    """f) Ridgeline plot."""
    n_groups = 5
    for i in range(n_groups):
        data = np.random.RandomState(403 + i).normal(loc=0, scale=0.7 + i * 0.2, size=200)
        kde = stats.gaussian_kde(data)
        x_kde = np.linspace(-5, 5, 200)
        y_kde = kde(x_kde)
        y_kde = y_kde / y_kde.max() * 0.7
        ax.fill_between(x_kde, i * 0.8, i * 0.8 + y_kde,
                        color=_alpha_color(CNS_PALETTE[i], 0.5),
                        edgecolor=CNS_PALETTE[i], linewidth=0.4, zorder=5 - i)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_ylim(-0.5, 5)
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[5])

def _dist_halfviolin(ax):
    """g) Half-violin plot."""
    groups = 4
    for i in range(groups):
        data = np.random.RandomState(404 + i).normal(loc=2 + i * 0.7, scale=0.8, size=100)
        kernel = stats.gaussian_kde(data)
        x_grid = np.linspace(data.min() - 1, data.max() + 1, 150)
        x_fill = np.concatenate([x_grid, x_grid[::-1]])
        y_vals = kernel(x_grid)
        y_vals = y_vals / y_vals.max() * 0.25
        y_fill = np.concatenate([np.full_like(x_grid, i), np.full_like(x_grid, i) + y_vals[::-1]])
        ax.fill(x_fill, y_fill, color=_alpha_color(CNS_PALETTE[i], 0.6),
                edgecolor=CNS_PALETTE[i], linewidth=0.3)
        # strip points
        pts = np.random.RandomState(900 + i).normal(loc=2 + i * 0.7, scale=0.8, size=25)
        ax.scatter(pts, np.full(25, i + 0.08) + np.random.RandomState(950 + i).uniform(-0.03, 0.03, 25),
                   s=4, color=CNS_COLORS["dark_gray"], edgecolors="none", alpha=0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[6])

def _dist_beeswarm(ax):
    """h) Bee swarm plot."""
    groups = 4
    n_per = 25
    colors = CNS_PALETTE[:4]
    for i in range(groups):
        data = np.sort(np.random.RandomState(405 + i).normal(loc=3 + i * 0.4, scale=0.5,
                       size=n_per))
        y_positions = _beeswarm_y(data, spread=0.1)
        ax.scatter(data, np.full(n_per, i) + y_positions, s=8, color=colors[i],
                   edgecolors="white", linewidth=0.1, alpha=0.8)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[7])

def _beeswarm_y(values, spread=0.12, max_iter=50):
    """Simple beeswarm-like offset computation."""
    n = len(values)
    y = np.zeros(n)
    r = spread
    for i in range(n):
        best_y = 0
        if i > 0:
            candidates = np.linspace(-r * 5, r * 5, 100)
            candidates = sorted(candidates, key=lambda c: (
                np.min(((values[:i] - values[i]) ** 2 + (y[:i] - c) ** 2))
                if i > 0 else 0
            ))
            best_y = candidates[0]
        y[i] = best_y
    return y

def _dist_sina(ax):
    """i) Sina-like plot (jittered violin)."""
    groups = 4
    n_per = 30
    for i in range(groups):
        data = np.random.RandomState(406 + i).normal(loc=3 + i * 0.5, scale=0.7, size=n_per)
        kde = stats.gaussian_kde(data)
        x_range = np.linspace(data.min() - 0.5, data.max() + 0.5, 500)
        density = kde(x_range)
        for j, val in enumerate(data):
            idx = np.argmin(np.abs(x_range - val))
            d = min(density[idx] / density.max(), 1.0)
            jitter = (np.random.RandomState(1000 + i * 100 + j).uniform(-d, d) * 0.3)
            ax.scatter(val, i + jitter, s=5, color=CNS_PALETTE[i], edgecolors="white",
                       linewidth=0.05, alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[8])

def _dist_split_violin(ax):
    """j) Split violin plot."""
    for i in range(3):
        data_a = np.random.RandomState(407 + i).normal(loc=2 + i, scale=0.6, size=80)
        data_b = np.random.RandomState(410 + i).normal(loc=2.5 + i, scale=0.7, size=80)
        for (data, side, color) in [(data_a, -1, CNS_COLORS["blue"]),
                                     (data_b, +1, CNS_COLORS["red"])]:
            kde = stats.gaussian_kde(data)
            x_grid = np.linspace(data.min() - 0.5, data.max() + 0.5, 150)
            vals = kde(x_grid)
            vals = vals / vals.max() * 0.3
            if side == -1:
                ax.fill_betweenx(x_grid, i - vals, i, color=_alpha_color(color, 0.6),
                                 edgecolor=color, linewidth=0.2)
            else:
                ax.fill_betweenx(x_grid, i, i + vals, color=_alpha_color(color, 0.6),
                                 edgecolor=color, linewidth=0.2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[9])

def _dist_ecdf(ax):
    """k) Empirical CDF plot."""
    data = np.random.RandomState(411).normal(loc=0, scale=1, size=80)
    sorted_data = np.sort(data)
    y = np.arange(1, len(sorted_data) + 1) / len(sorted_data)
    ax.step(sorted_data, y, where="post", color=CNS_COLORS["blue"], linewidth=0.8)
    ax.plot(sorted_data, y, "o", color=CNS_COLORS["blue"], markersize=1.5,
            markeredgewidth=0, alpha=0.3)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[10])

def _dist_qq(ax):
    """l) QQ plot."""
    data = np.random.RandomState(412).normal(loc=0, scale=1, size=60)
    theoretical = np.sort(np.random.RandomState(413).normal(loc=0, scale=1, size=60))
    observed = np.sort(data)
    ax.scatter(theoretical, observed, s=6, color=CNS_COLORS["blue"], edgecolors="white",
               linewidth=0.1, alpha=0.7)
    mn = min(theoretical.min(), observed.min())
    mx = max(theoretical.max(), observed.max())
    ax.plot([mn, mx], [mn, mx], "--", color=CNS_COLORS["light_gray"], linewidth=0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[11])

def _dist_overlapping_hist(ax):
    """m) Overlapping histograms."""
    d1 = np.random.RandomState(414).normal(loc=3, scale=0.8, size=150)
    d2 = np.random.RandomState(415).normal(loc=5, scale=1, size=150)
    ax.hist(d1, bins=18, color=_alpha_color(CNS_COLORS["blue"], 0.5), edgecolor="white",
            linewidth=0.15, alpha=0.6)
    ax.hist(d2, bins=18, color=_alpha_color(CNS_COLORS["red"], 0.5), edgecolor="white",
            linewidth=0.15, alpha=0.6)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[12])

def _dist_raincloud(ax):
    """n) Raincloud plot (half-violin + box + points)."""
    groups = 3
    colors = CNS_PALETTE[:3]
    for i in range(groups):
        data = np.random.RandomState(416 + i).normal(loc=2 + i * 1.5, scale=0.8, size=60)
        # half violin pointing down
        kde = stats.gaussian_kde(data)
        x_grid = np.linspace(data.min() - 1, data.max() + 1, 150)
        vals = kde(x_grid)
        vals = vals / vals.max() * 0.3
        ax.fill_betweenx(x_grid, i - 0.05 - vals, i - 0.05,
                        color=_alpha_color(colors[i], 0.5), edgecolor=colors[i], linewidth=0.3)
        # box
        bp = ax.boxplot([data], positions=[i], widths=0.18, patch_artist=True,
                        medianprops={"color": "white", "linewidth": 0.6},
                        flierprops={"markersize": 0.1})
        bp["boxes"][0].set_facecolor(_alpha_color(colors[i], 0.5))
        bp["boxes"][0].set_edgecolor("white")
        # points
        n_pts = min(20, len(data))
        pts_sample = np.sort(data)[:n_pts]
        for j, pt in enumerate(pts_sample):
            ax.scatter(pt, i + 0.12 + np.random.RandomState(1100 + i * 50 + j).uniform(-0.04, 0.04),
                       s=3, color=CNS_COLORS["dark_gray"], edgecolors="none", alpha=0.4)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[13])

def _dist_2dhist(ax):
    """o) 2D histogram."""
    x = np.random.RandomState(417).normal(loc=0, scale=1, size=400)
    y = np.random.RandomState(418).normal(loc=0, scale=1, size=400)
    ax.hist2d(x, y, bins=15, cmap=CNS_SEQUENTIAL_CMAP, edgecolor="none")[3]
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[14])

def _dist_rug(ax):
    """p) Rug plot."""
    data = np.random.RandomState(419).normal(loc=0, scale=1, size=80)
    # KDE
    kde = stats.gaussian_kde(data)
    x_kde = np.linspace(-4, 4, 200)
    ax.plot(x_kde, kde(x_kde), color=CNS_COLORS["blue"], linewidth=1, zorder=1)
    # rug ticks at bottom
    ax.plot(data, np.zeros_like(data) - 0.02, "|", color=CNS_COLORS["dark_gray"],
            markersize=4, mew=0.3, zorder=2)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[15])

DIST_PANELS = [
    _dist_boxplot, _dist_violin, _dist_box_strip, _dist_histogram,
    _dist_kde_overlay, _dist_ridgeline, _dist_halfviolin, _dist_beeswarm,
    _dist_sina, _dist_split_violin, _dist_ecdf, _dist_qq,
    _dist_overlapping_hist, _dist_raincloud, _dist_2dhist, _dist_rug,
]

# ---------------------------------------------------------------------------
# Atlas 5: Volcano / Special (16 variants)
# ---------------------------------------------------------------------------

def _volcano_standard(ax):
    """a) Standard volcano plot."""
    n = 200
    fc = np.random.RandomState(600).normal(loc=0, scale=0.8, size=n)
    pval = np.random.RandomState(601).exponential(scale=0.5, size=n)
    log_p = -np.log10(pval + 1e-10)
    colors = np.full(n, CNS_COLORS["light_gray"])
    sig_up = (fc > 1) & (log_p > 1.3)
    sig_down = (fc < -1) & (log_p > 1.3)
    colors[sig_up] = CNS_COLORS["red"]
    colors[sig_down] = CNS_COLORS["blue"]
    ax.scatter(fc, log_p, s=4, c=colors, edgecolors="none", alpha=0.7)
    ax.axhline(1.3, color=CNS_COLORS["dark_gray"], linewidth=0.3, linestyle="--")
    ax.axvline(-1, color=CNS_COLORS["dark_gray"], linewidth=0.3, linestyle="--")
    ax.axvline(1, color=CNS_COLORS["dark_gray"], linewidth=0.3, linestyle="--")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[0])

def _volcano_highlighted(ax):
    """b) Volcano with highlighted genes."""
    n = 200
    fc = np.random.RandomState(602).normal(loc=0, scale=0.9, size=n)
    pval = np.random.RandomState(603).exponential(scale=0.5, size=n)
    log_p = -np.log10(pval + 1e-10)
    colors = np.full(n, CNS_COLORS["light_gray"])
    sizes = np.full(n, 3)
    # highlight top genes
    top_idx = np.argsort(log_p)[-8:]
    for idx in top_idx:
        colors[idx] = CNS_COLORS["red"] if fc[idx] > 0 else CNS_COLORS["blue"]
        sizes[idx] = 12
    ax.scatter(fc, log_p, s=sizes, c=colors, edgecolors="white", linewidth=0.15, alpha=0.7)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[1])

def _volcano_faceted(ax):
    """c) Multi-panel volcano (inset mini-volcanos)."""
    for row in range(2):
        for col in range(2):
            n_small = 60
            fc_s = np.random.RandomState(604 + row * 2 + col).normal(loc=0, scale=0.6, size=n_small)
            pv_s = np.random.RandomState(608 + row * 2 + col).exponential(scale=0.5, size=n_small)
            lp_s = -np.log10(pv_s + 1e-10)
            offset_x = col * 5
            offset_y = row * 4
            ax.scatter(fc_s * 0.8 + offset_x, lp_s * 0.7 + offset_y, s=2,
                       color=CNS_PALETTE[row * 2 + col], edgecolors="none", alpha=0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(-1.5, 9.5)
    ax.set_ylim(-0.5, 7)
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[2])

def _ma_plot(ax):
    """d) MA plot."""
    n = 200
    a_vals = np.random.RandomState(612).uniform(1, 10, n)
    m_vals = np.random.RandomState(613).normal(loc=0, scale=1.2, size=n)
    ax.scatter(a_vals, m_vals, s=4, color=CNS_COLORS["blue"], edgecolors="none", alpha=0.5)
    ax.axhline(0, color=CNS_COLORS["red"], linewidth=0.4, linestyle="--")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[3])

def _quadrant_scatter(ax):
    """e) Quadrant scatter plot."""
    n = 120
    x = np.random.RandomState(614).normal(loc=0, scale=1.5, size=n)
    y = np.random.RandomState(615).normal(loc=0, scale=1.5, size=n)
    q_colors = []
    for xi, yi in zip(x, y):
        if xi > 0 and yi > 0:
            q_colors.append(CNS_COLORS["red"])
        elif xi < 0 and yi > 0:
            q_colors.append(CNS_COLORS["blue"])
        elif xi < 0 and yi < 0:
            q_colors.append(CNS_COLORS["green"])
        else:
            q_colors.append(CNS_COLORS["light_gray"])
    ax.scatter(x, y, s=6, c=q_colors, edgecolors="white", linewidth=0.1, alpha=0.6)
    ax.axhline(0, color=CNS_COLORS["dark_gray"], linewidth=0.4)
    ax.axvline(0, color=CNS_COLORS["dark_gray"], linewidth=0.4)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[4])

def _forest_plot(ax):
    """f) Forest / interval plot."""
    n = 8
    estimates = np.random.RandomState(616).normal(loc=0, scale=0.5, size=n)
    ci_lower = estimates - np.abs(np.random.RandomState(617).normal(loc=0.3, scale=0.2, size=n))
    ci_upper = estimates + np.abs(np.random.RandomState(618).normal(loc=0.3, scale=0.2, size=n))
    y = np.arange(n)[::-1]
    colors = [CNS_COLORS["red"] if est > 0 else CNS_COLORS["blue"] for est in estimates]
    ax.errorbar(estimates, y, xerr=[estimates - ci_lower, ci_upper - estimates],
                fmt="o", color=CNS_COLORS["dark_gray"], markersize=4, linewidth=0.8,
                capsize=2)
    ax.scatter(estimates, y, s=16, c=colors, edgecolors="white", linewidth=0.3, zorder=3)
    ax.axvline(0, color="black", linewidth=0.5, linestyle="--")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(min(ci_lower) - 0.5, max(ci_upper) + 0.5)
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[5])

def _radar_polar(ax):
    """g) Radar/polar plot."""
    categories = 6
    values1 = np.random.RandomState(619).uniform(2, 8, categories)
    values2 = np.random.RandomState(620).uniform(2, 8, categories)
    angles = np.linspace(0, 2 * np.pi, categories, endpoint=False).tolist()
    values1 = np.append(values1, values1[0])
    values2 = np.append(values2, values2[0])
    angles += angles[:1]
    ax.fill(angles, values1, color=_alpha_color(CNS_COLORS["blue"], 0.25), edgecolor=CNS_COLORS["blue"],
            linewidth=0.8)
    ax.fill(angles, values2, color=_alpha_color(CNS_COLORS["red"], 0.25), edgecolor=CNS_COLORS["red"],
            linewidth=0.8)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[6])

def _upset_matrix(ax):
    """h) UpSet-like matrix (simplified)."""
    sets = 5
    items = 12
    membership = np.random.RandomState(621).binomial(1, 0.3, size=(items, sets))
    col_sums = membership.sum(axis=0)
    sort_order = np.argsort(col_sums)[::-1]
    membership = membership[:, sort_order]
    labels = ["A", "B", "C", "D", "E"]
    cmap = matplotlib.colors.ListedColormap([CNS_COLORS["bg"], CNS_COLORS["blue"]])
    ax_top = ax
    # bottom: combination matrix
    for j in range(sets):
        for i in range(items):
            if membership[i, j]:
                ax.add_patch(plt.Rectangle((j, i), 0.8, 0.8,
                                           facecolor=CNS_COLORS["blue"],
                                           edgecolor="white", linewidth=0.15,
                                           alpha=0.7))
    # top: bar chart
    for j in range(sets):
        ax.add_patch(plt.Rectangle((j, items + 0.5), 0.6, col_sums[j] / max(col_sums) * 3,
                                   facecolor=CNS_COLORS["dark_gray"], edgecolor="white",
                                   linewidth=0.1))
    ax.set_xlim(-0.5, sets - 0.5)
    ax.set_ylim(0, items + 4.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[7])

def _waterfall_genomic(ax):
    """i) Genomic waterfall plot (mutation profile)."""
    n_patients = 12
    n_genes = 6
    data = np.random.RandomState(622).binomial(1, p=[0.3, 0.25, 0.2, 0.15, 0.1, 0.08],
                                                size=(n_patients, n_genes))
    mutation_types = ["Missense", "Nonsense", "Frameshift", "Splice"]
    type_colors = {
        "Missense": CNS_COLORS["green"],
        "Nonsense": CNS_COLORS["red"],
        "Frameshift": CNS_COLORS["blue"],
        "Splice": CNS_COLORS["orange"],
    }
    for pt in range(n_patients):
        for gene in range(n_genes):
            if data[pt, gene]:
                mut_type = np.random.choice(mutation_types)
                ax.add_patch(plt.Rectangle((gene, pt), 0.75, 0.75,
                                           facecolor=type_colors[mut_type],
                                           edgecolor="white", linewidth=0.1))
    ax.set_xlim(-0.5, n_genes - 0.5)
    ax.set_ylim(-0.5, n_patients - 0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[8])

def _manhattan(ax):
    """j) Manhattan plot (simplified)."""
    n_snps = 150
    chroms = np.repeat(np.arange(1, 5), n_snps // 4)
    if len(chroms) < n_snps:
        chroms = np.append(chroms, [5] * (n_snps - len(chroms)))
    pos = np.concatenate([np.arange(1, 51) for _ in range(5)])[:n_snps]
    pvals = np.random.RandomState(623).exponential(scale=0.5, size=n_snps)
    log_p = -np.log10(pvals + 1e-10)
    chrom_colors = [CNS_PALETTE[(c - 1) % len(CNS_PALETTE)] for c in chroms]
    cum_pos = pos + (chroms - 1) * 50
    ax.scatter(cum_pos, log_p, s=4, c=chrom_colors, edgecolors="none", alpha=0.6)
    ax.axhline(-np.log10(0.05 / n_snps), color=CNS_COLORS["red"], linewidth=0.4,
               linestyle="--")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[9])

def _bland_altman(ax):
    """k) Bland-Altman plot."""
    n = 80
    method_a = np.random.RandomState(624).uniform(1, 10, n)
    method_b = method_a + np.random.RandomState(625).normal(loc=0, scale=1, size=n)
    means = (method_a + method_b) / 2
    diffs = method_a - method_b
    ax.scatter(means, diffs, s=6, color=CNS_COLORS["blue"], edgecolors="white",
               linewidth=0.1, alpha=0.6)
    mean_diff = diffs.mean()
    sd_diff = diffs.std()
    ax.axhline(mean_diff, color=CNS_COLORS["red"], linewidth=0.5, linestyle="-")
    ax.axhline(mean_diff + 1.96 * sd_diff, color=CNS_COLORS["dark_gray"],
               linewidth=0.3, linestyle="--")
    ax.axhline(mean_diff - 1.96 * sd_diff, color=CNS_COLORS["dark_gray"],
               linewidth=0.3, linestyle="--")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[10])

def _roc_curve(ax):
    """l) ROC curve."""
    n = 100
    # simulate scores for two classes
    scores_pos = np.random.RandomState(626).normal(loc=1, scale=1, size=n)
    scores_neg = np.random.RandomState(627).normal(loc=0, scale=1, size=n)
    all_scores = np.concatenate([scores_pos, scores_neg])
    all_labels = np.concatenate([np.ones(n), np.zeros(n)])
    sort_idx = np.argsort(all_scores)[::-1]
    all_labels_sorted = all_labels[sort_idx]
    tpr = np.cumsum(all_labels_sorted) / all_labels_sorted.sum()
    fpr = np.cumsum(1 - all_labels_sorted) / (len(all_labels_sorted) - all_labels_sorted.sum())
    ax.plot(fpr, tpr, color=CNS_COLORS["blue"], linewidth=1)
    ax.plot([0, 1], [0, 1], "--", color=CNS_COLORS["light_gray"], linewidth=0.5)
    ax.fill_between(fpr, tpr, 0, color=_alpha_color(CNS_COLORS["blue"], 0.08))
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[11])

def _pr_curve(ax):
    """m) Precision-Recall curve."""
    n = 100
    tp = np.cumsum(np.random.RandomState(628).binomial(1, 0.1, size=n))
    fp = np.cumsum(np.random.RandomState(629).binomial(1, 0.05, size=n))
    precision = tp / (tp + fp + 1e-10)
    recall = tp / tp[-1] if tp[-1] > 0 else np.linspace(1, 0, n)
    ax.plot(recall, precision, color=CNS_COLORS["green"], linewidth=1)
    ax.fill_between(recall, 0, precision, color=_alpha_color(CNS_COLORS["green"], 0.08))
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[12])

def _calibration(ax):
    """n) Calibration curve."""
    n_pts = 10
    predicted = np.linspace(0, 1, n_pts)
    observed = predicted + np.random.RandomState(630).normal(loc=0, scale=0.08, size=n_pts)
    ax.plot(predicted, observed, "o-", color=CNS_COLORS["blue"], markersize=4,
            linewidth=0.8, markerfacecolor="white", markeredgewidth=0.5)
    ax.plot([0, 1], [0, 1], "--", color=CNS_COLORS["light_gray"], linewidth=0.5)
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[13])

def _funnel(ax):
    """o) Funnel plot (meta-analysis)."""
    n = 50
    se = np.random.RandomState(631).uniform(0.05, 0.5, n)
    effect = np.random.RandomState(632).normal(loc=0, scale=1, size=n) * se + 0.2
    ax.scatter(effect, se, s=10, color=CNS_COLORS["blue"], edgecolors="white",
               linewidth=0.2, alpha=0.5)
    # funnel lines
    se_line = np.linspace(0, 0.6, 50)
    ax.plot(0.2 + 1.96 * se_line, se_line, "--", color=CNS_COLORS["light_gray"],
            linewidth=0.4)
    ax.plot(0.2 - 1.96 * se_line, se_line, "--", color=CNS_COLORS["light_gray"],
            linewidth=0.4)
    ax.axvline(0.2, color=CNS_COLORS["red"], linewidth=0.4, linestyle="-")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.invert_yaxis()
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[14])

def _venn_simple(ax):
    """p) Simplified Venn diagram representation."""
    # 3-circle venn approximation using patches
    centers = [(0, 0.4), (-1, -0.5), (1, -0.5)]
    colors_v = [CNS_COLORS["blue"], CNS_COLORS["red"], CNS_COLORS["green"]]
    for (cx, cy), color in zip(centers, colors_v):
        circle = plt.Circle((cx, cy), 1.3, facecolor=_alpha_color(color, 0.25),
                            edgecolor=color, linewidth=0.6)
        ax.add_patch(circle)
    ax.set_xlim(-2.5, 2.5)
    ax.set_ylim(-2, 2)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    style_ax(ax)
    add_panel_label_inside(ax, LABELS[15])

VOLCANO_PANELS = [
    _volcano_standard, _volcano_highlighted, _volcano_faceted, _ma_plot,
    _quadrant_scatter, _forest_plot, _radar_polar, _upset_matrix,
    _waterfall_genomic, _manhattan, _bland_altman, _roc_curve,
    _pr_curve, _calibration, _funnel, _venn_simple,
]

# ---------------------------------------------------------------------------
# Atlas Assembly
# ---------------------------------------------------------------------------

def build_atlas(panel_funcs, title, output_path, figsize=(11, 9)):
    """
    Build a 4x4 atlas figure from a list of 16 panel-drawing functions.

    Parameters
    ----------
    panel_funcs : list of callable
        Each callable takes an `ax` and draws one panel.
    title : str
        Overall figure title (not shown, used for logging only).
    output_path : str
        Absolute path to save the PNG.
    figsize : tuple
        Figure dimensions in inches.
    """
    n_rows, n_cols = 4, 4
    fig = plt.figure(figsize=figsize, dpi=300, facecolor="white")
    gs = gridspec.GridSpec(n_rows, n_cols, figure=fig,
                           hspace=0.55, wspace=0.55,
                           left=0.04, right=0.96, top=0.95, bottom=0.04)

    for i, fn in enumerate(panel_funcs):
        row, col = divmod(i, n_cols)
        ax = fig.add_subplot(gs[row, col])
        set_seed(i * 137 + 42)
        fn(ax)

    fig.savefig(output_path, dpi=300, facecolor="white", edgecolor="none",
                bbox_inches="tight", pad_inches=0.08)
    plt.close(fig)
    print(f"  [OK] Saved: {output_path}")


def main():
    """Generate all 5 chart atlas images."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"\nAcademic Figure Skill Chart Atlas Generator")
    print(f"Output directory: {OUTPUT_DIR}\n")

    atlases = [
        ("atlas-01-bar-charts.png", BAR_PANELS),
        ("atlas-02-line-scatter.png", LINE_SCATTER_PANELS),
        ("atlas-03-heatmaps.png", HEATMAP_PANELS),
        ("atlas-04-distributions.png", DIST_PANELS),
        ("atlas-05-volcano-special.png", VOLCANO_PANELS),
    ]

    for filename, panels in atlases:
        output_path = os.path.join(OUTPUT_DIR, filename)
        short_name = filename.replace(".png", "").replace("atlas-", "Atlas ")
        print(f"Generating {short_name} ...")
        build_atlas(panels, filename, output_path)

    print(f"\nAll 5 atlas images generated successfully.")
    print(f"Location: {OUTPUT_DIR}\n")

    # List output files
    for f in sorted(os.listdir(OUTPUT_DIR)):
        fpath = os.path.join(OUTPUT_DIR, f)
        size_kb = os.path.getsize(fpath) / 1024
        print(f"  {f}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
