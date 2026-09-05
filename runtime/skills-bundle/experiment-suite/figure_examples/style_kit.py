"""Shared publication-style helpers for experiment-suite figures."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt


WONG = [
    "#000000",
    "#E69F00",
    "#56B4E9",
    "#009E73",
    "#F0E442",
    "#0072B2",
    "#D55E00",
    "#CC79A7",
]

PALETTE = {
    "blue_main": "#0072B2",
    "blue_secondary": "#56B4E9",
    "green_3": "#009E73",
    "red_strong": "#D55E00",
    "teal": "#009E73",
    "violet": "#CC79A7",
    "neutral_mid": "#666666",
}

DEFAULT_COLORS = [
    "#0072B2",
    "#D55E00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#E69F00",
]


def apply_publication_style(font_size: int = 8, axes_linewidth: float = 0.6) -> None:
    """Apply a shared journal-style matplotlib configuration."""
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "DejaVu Sans", "Liberation Sans"],
        "font.size": font_size,
        "axes.labelsize": font_size,
        "axes.titlesize": font_size,
        "xtick.labelsize": font_size,
        "ytick.labelsize": font_size,
        "legend.fontsize": font_size,
        "axes.spines.right": False,
        "axes.spines.top": False,
        "axes.linewidth": axes_linewidth,
        "axes.grid": False,
        "lines.linewidth": 1.2,
        "lines.markersize": 3.5,
        "savefig.dpi": 400,
        "savefig.bbox": "tight",
        "svg.fonttype": "none",
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
    })


def add_panel_label(ax, label: str, x: float = -0.12, y: float = 1.03) -> None:
    ax.text(
        x, y, label,
        transform=ax.transAxes,
        fontsize=9,
        fontweight="bold",
        ha="left",
        va="bottom",
    )


def add_simulated_watermark(ax, x: float = 1.0, y: float = 1.02) -> None:
    ax.text(
        x, y, "simulated",
        transform=ax.transAxes,
        ha="right",
        va="bottom",
        fontsize=7,
        color="gray",
        alpha=0.5,
        style="italic",
    )


def save_publication_bundle(fig, out_base: str, dpi: int = 600) -> None:
    """Save PDF/SVG/TIFF together when possible."""
    out_path = Path(out_base)
    fig.savefig(out_path.with_suffix(".pdf"))
    fig.savefig(out_path.with_suffix(".svg"))
    fig.savefig(out_path.with_suffix(".tiff"), dpi=dpi)
