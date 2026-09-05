"""Academic Figure Skill multi-panel composition engine.

The engine keeps journal dimensions, typography, panel labels, and export behavior
consistent across Python-only and mixed Python/R figures.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable

import matplotlib.gridspec as gridspec
import matplotlib.image as mpimg
import matplotlib.pyplot as plt
import numpy as np

MM_PER_INCH = 25.4
MAX_HEIGHT_MM = 247

# Nature/Cell/Science-safe palette: restrained, colorblind-aware, and print-safe.
CATEGORICAL = ["#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666"]
CATEGORICAL_EXTENDED = [
    "#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666",
    "#4393C3", "#D6604D", "#5AAE61", "#B35806", "#9970AB", "#999999",
]
DIVERGING = ["#2166AC", "#F7F7F7", "#B2182B"]
SEQUENTIAL = ["#F7FBFF", "#6BAED6", "#08306B"]
NEUTRAL = {
    "text": "#222222",
    "axis": "#444444",
    "grid": "#D9D9D9",
    "muted": "#999999",
    "background": "#FFFFFF",
}
ACCENT = "#B2182B"

# ═══════════════════════════════════════════════════════════
# Journal-specific palette variants (Nature / Cell / Science)
# ═══════════════════════════════════════════════════════════
# All three journals share the Academic Figure Skill restrained-color philosophy but differ
# in saturation, warmth, and grey emphasis. Palettes below reflect prevailing
# published-figure conventions in each journal family.

JOURNAL_PALETTES = {
    # Nature-family: cool-leaning, moderate saturation, deeper blue anchor
    "nature": {
        "CATEGORICAL": ["#08519C", "#A50F15", "#006D2C", "#D94801", "#54278F", "#525252"],
        "CATEGORICAL_EXTENDED": [
            "#08519C", "#A50F15", "#006D2C", "#D94801", "#54278F", "#525252",
            "#2171B5", "#CB181D", "#238B45", "#F16913", "#6A51A3", "#737373",
        ],
        "DIVERGING": ["#08519C", "#F7F7F7", "#A50F15"],
        "SEQUENTIAL": ["#F7FBFF", "#6BAED6", "#08306B"],
        "ACCENT": "#A50F15",
        "GREY": "#525252",
    },
    # Cell-family: slightly warmer, allows more saturated reds for hero results
    "cell": {
        "CATEGORICAL": ["#2166AC", "#CB181D", "#238B45", "#EF6548", "#88419D", "#636363"],
        "CATEGORICAL_EXTENDED": [
            "#2166AC", "#CB181D", "#238B45", "#EF6548", "#88419D", "#636363",
            "#4292C6", "#EF3B2C", "#41AB5D", "#FC8D59", "#8C6BB1", "#969696",
        ],
        "DIVERGING": ["#2166AC", "#FFFFFF", "#CB181D"],
        "SEQUENTIAL": ["#FEE8C8", "#FDBB84", "#7F0000"],
        "ACCENT": "#CB181D",
        "GREY": "#636363",
    },
    # Science-family: conservative, restrained saturation, more grey usage
    "science": {
        "CATEGORICAL": ["#3182BD", "#B30000", "#31A354", "#E6550D", "#756BB1", "#666666"],
        "CATEGORICAL_EXTENDED": [
            "#3182BD", "#B30000", "#31A354", "#E6550D", "#756BB1", "#666666",
            "#6BAED6", "#EF3B2C", "#74C476", "#FD8D3C", "#9E9AC8", "#969696",
        ],
        "DIVERGING": ["#3182BD", "#F7F7F7", "#B30000"],
        "SEQUENTIAL": ["#F7F7F7", "#969696", "#252525"],
        "ACCENT": "#B30000",
        "GREY": "#666666",
    },
}


def journal_palette(journal: str = None) -> dict:
    """Return palette dict for the given journal. Falls back to default Academic Figure Skill palette.

    Usage:
        pal = journal_palette("Nature Genetics")   # returns Nature variant
        colors = pal["CATEGORICAL"][:n_groups]
        div = pal["DIVERGING"]

    Journal name matching is substring-based and case-insensitive:
      "Nature", "Nature Genetics", "Nat Med"     -> nature variant
      "Cell", "Cell Reports", "Cell Systems"     -> cell variant
      "Science", "Sci Advances", "Sci Transl"    -> science variant
      None / unknown                              -> default (module-level CATEGORICAL/DIVERGING)
    """
    if not journal:
        return {
            "CATEGORICAL": CATEGORICAL,
            "CATEGORICAL_EXTENDED": CATEGORICAL_EXTENDED,
            "DIVERGING": DIVERGING,
            "SEQUENTIAL": SEQUENTIAL,
            "ACCENT": ACCENT,
            "GREY": NEUTRAL["muted"],
        }
    key = journal.lower()
    for jname, pal in JOURNAL_PALETTES.items():
        if jname in key or key.startswith(jname[:3]):
            return pal
    # Unknown journal: return default
    return {
        "CATEGORICAL": CATEGORICAL,
        "CATEGORICAL_EXTENDED": CATEGORICAL_EXTENDED,
        "DIVERGING": DIVERGING,
        "SEQUENTIAL": SEQUENTIAL,
        "ACCENT": ACCENT,
        "GREY": NEUTRAL["muted"],
    }

PANEL_ASPECT = {
    "heatmap": 1.0,
    "corr_heatmap": 1.0,
    "correlation_heatmap": 1.0,
    "correlation_matrix": 1.0,
    "grouped_correlation_matrix": 1.0,
    "pca": 1.0,
    "rda": 1.0,
    "radar": 1.0,
    "confusion_matrix": 1.0,
    "upset": 0.95,
    "mantel_correlation": 1.0,
    "auroc": 0.85,
    "volcano": 0.85,
    "roc": 0.85,
    "violin": 0.75,
    "box": 0.75,
    "line": 0.75,
    "trend": 0.75,
    "bar": 0.70,
    "bar_ablation": 0.70,
    "bar_comparison": 0.70,
    "bar_categorical": 0.70,
    "bar_composition": 0.75,
    "bar_distribution": 0.75,
    "forest": 0.70,
    "scatter": 0.75,
    "ridge": 0.65,
    "kde": 0.65,
    "density": 0.65,
    "sankey": 0.50,
    "bubble": 0.75,
    "marker_gene_dot_plot": 0.75,
    "dotplot": 0.75,
    "manifold": 1.0,
    "singlecell": 0.85,
    "image": 0.75,
    "schematic": 0.65,
}

# Font scaling by panel count: fewer panels = bigger fonts (more canvas per panel)
FONT_SCALE = {1: 1.25, 2: 1.20, 3: 1.15, 4: 1.10, 5: 1.05, 6: 1.00}

def _scaled_font_params(n_panels):
    s = FONT_SCALE.get(n_panels, 0.95)
    return {
        "font.size":      round(8 * s),
        "axes.titlesize": round(8 * s),
        "axes.labelsize": round(8 * s),
        "xtick.labelsize": round(7 * s),
        "ytick.labelsize": round(7 * s),
        "legend.fontsize": round(8 * s),
        "figure.titlesize": round(9 * s),
    }

def _unified_rcparams(n_panels=4):
    fonts = _scaled_font_params(n_panels)
    return {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "Liberation Sans"],
        **fonts,
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.linewidth": 0.6, "xtick.direction": "out", "ytick.direction": "out",
        "xtick.major.width": 0.6, "ytick.major.width": 0.6,
        "legend.frameon": False,
        "pdf.fonttype": 42, "svg.fonttype": "none",
        "savefig.bbox": "tight", "savefig.dpi": 300,
    }

UNIFIED_RCPARAMS = _unified_rcparams(4)  # default for 4 panels


_active_journal_palette: dict | None = None


def get_palette(n: int, role: str = "categorical") -> list[str]:
    """Return journal-safe colors for Nature/Cell/Science-style figures.

    When compose_figure(journal="Nature") is used, colors come from the
    journal-specific palette. Otherwise the Academic Figure Skill default palette is used.
    """
    if role == "sequential":
        return (_active_journal_palette or {}).get("SEQUENTIAL", SEQUENTIAL)[:]
    if role == "diverging":
        return (_active_journal_palette or {}).get("DIVERGING", DIVERGING)[:]
    if role not in ("categorical",):
        raise ValueError(f"Unknown palette role: {role!r}. Use 'categorical', 'sequential', or 'diverging'.")
    cat = (_active_journal_palette or {}).get("CATEGORICAL", CATEGORICAL)
    cat_ext = (_active_journal_palette or {}).get("CATEGORICAL_EXTENDED", CATEGORICAL_EXTENDED)
    base = cat_ext if n > len(cat) else cat
    if n <= len(base):
        return base[:n]
    repeats = (n + len(base) - 1) // len(base)
    return (base * repeats)[:n]


def get_aspect(panel_type: str) -> float:
    panel_type = panel_type.lower().replace(" ", "_").replace("-", "_")
    for key, val in PANEL_ASPECT.items():
        if key in panel_type:
            return val
    return 0.85


def _grid_shape(n: int, fig_width_mm: float) -> tuple[int, int]:
    if fig_width_mm >= 150:
        if n == 1:
            return 1, 1
        if n == 2:
            return 2, 1
        if n == 3:
            return 3, 1
        if n <= 4:
            return 2, 2
        if n <= 6:
            return 3, 2
        if n <= 9:
            return 3, 3
        return 4, (n + 3) // 4
    if n == 1:
        return 1, 1
    if n == 2:
        return 2, 1
    if n <= 4:
        return 2, 2
    return 3, (n + 2) // 3


def layout_symmetric(panel_types: Iterable[str], fig_width_mm: float = 183):
    panel_types = list(panel_types)
    n = len(panel_types)
    aspects = [get_aspect(t) for t in panel_types]
    cols, rows = _grid_shape(n, fig_width_mm)
    spacing = {
        (1, 1): (0.0, 0.0),
        (2, 1): (0.25, 0.0),
        (3, 1): (0.22, 0.0),
        (2, 2): (0.25, 0.28),
        (3, 2): (0.22, 0.25),
        (2, 3): (0.25, 0.28),
        (3, 3): (0.22, 0.25),
        (4, 3): (0.24, 0.26),
    }
    wspace, hspace = spacing.get((cols, rows), (0.24, 0.26))
    row_heights = []
    for r in range(rows):
        row_aspects = [aspects[r * cols + c] for c in range(min(cols, n - r * cols))]
        row_heights.append(max(row_aspects) if row_aspects else 0.85)
    margin = 0.10
    panel_w_mm = (fig_width_mm * (1 - 2 * margin)) / (cols + (cols - 1) * wspace)
    return cols, rows, row_heights, wspace, hspace, panel_w_mm


def panel_specs(panel_types: Iterable[str], fig_width_mm: float = 183):
    """Calculate per-panel physical specs: width_mm, height_mm, and dpi."""
    panel_types = list(panel_types)
    cols, rows, row_heights, wspace, hspace, panel_w_mm = layout_symmetric(panel_types, fig_width_mm)
    specs = []
    for i, _panel_type in enumerate(panel_types):
        r = i // cols
        specs.append({"width_mm": panel_w_mm, "height_mm": panel_w_mm * row_heights[r], "dpi": 300})
    return specs, cols, rows, row_heights, wspace, hspace


def _figure_height_mm(panel_w_mm: float, row_heights: list[float], hspace: float) -> float:
    data_h = sum(panel_w_mm * rh for rh in row_heights)
    gap_h = max(0, len(row_heights) - 1) * panel_w_mm * hspace * 0.25
    return min((data_h + gap_h) * 1.24, MAX_HEIGHT_MM)


def _make_grid(n: int, panel_types: list[str], fig_width_mm: float, hero_idx: int | None):
    specs, cols, rows, row_heights, wspace, hspace = panel_specs(panel_types, fig_width_mm)
    width_ratios = [1.0] * cols
    height_ratios = row_heights[:]
    placements = [(i // cols, i % cols) for i in range(n)]

    if hero_idx is not None and 0 <= hero_idx < n and 3 <= n <= 6:
        cols, rows = 2, max(2, n - 1)
        width_ratios = [1.35, 1.0]
        height_ratios = [1.0] * rows
        placements = []
        support_row = 0
        for i in range(n):
            if i == hero_idx:
                placements.append((slice(0, rows), 0))
            else:
                placements.append((support_row, 1))
                support_row += 1
        hspace = 0.24
        wspace = 0.25
        usable_width = fig_width_mm * 0.80
        panel_w_mm = usable_width / (sum(width_ratios) + wspace)
        specs = []
        for i in range(n):
            if i == hero_idx:
                specs.append({"width_mm": panel_w_mm * width_ratios[0], "height_mm": panel_w_mm * rows, "dpi": 300})
            else:
                specs.append({"width_mm": panel_w_mm, "height_mm": panel_w_mm, "dpi": 300})
        row_heights = height_ratios

    elif hero_idx is not None and n > 6:
        print(f"WARNING: hero layout only supports 3-6 panels, got {n}. "
              f"Falling back to symmetric grid. Consider splitting into multiple figures.")

    return specs, cols, rows, row_heights, width_ratios, wspace, hspace, placements


def compose_figure(
    panel_funcs: list[Callable],
    panel_types: list[str],
    fig_width_mm: float = 183,
    hero_idx: int | None = None,
    archetype: str = "auto",
    output_prefix: str = "figure",
    panel_labels: list[str] | None = None,
    journal: str | None = None,
):
    """Compose a publication-style multi-panel figure.

    Parameters
    ----------
    archetype : str
        Figure archetype from the contract (Step 0). One of:
        "auto", "quantitative_grid", "schematic_led", "image_plate",
        "asymmetric_mixed", "symmetric".
        "auto" auto-detects hero from panel type diversity.
        Hero panel gets 1.35x width, supporting panels stay at 1.0x.
    journal : str or None
        Journal name for palette selection (e.g. "Nature Genetics",
        "Cell Reports", "Science"). None uses the default Academic Figure Skill palette.
    """
    import matplotlib as mpl

    n = len(panel_funcs)
    if n == 0:
        raise ValueError("panel_funcs is empty — at least one panel is required")
    mpl.rcParams.update(_unified_rcparams(n))

    # Apply journal-specific palette if requested (visible to panel drawing funcs)
    global _active_journal_palette
    if journal:
        _active_journal_palette = journal_palette(journal)
    else:
        _active_journal_palette = None

    # Auto-detect hero if not explicitly set
    if hero_idx is None and archetype != "symmetric":
        hero_idx = detect_hero(panel_types, archetype)
    if len(panel_types) != n:
        raise ValueError("panel_funcs and panel_types must have the same length")
    if panel_labels is None:
        panel_labels = [chr(ord("a") + i) for i in range(min(n, 26))]
        if n > 26:
            panel_labels += [f"a{i - 25}" for i in range(26, n)]

    specs, cols, rows, row_heights, width_ratios, wspace, hspace, placements = _make_grid(
        n, panel_types, fig_width_mm, hero_idx
    )
    min_panel_w = min(s["width_mm"] for s in specs)
    if min_panel_w < 35:
        raise ValueError(f"Panel width {min_panel_w:.0f}mm < 35mm floor. Split into multiple figures.")
    if min_panel_w < 45:
        print(f"WARNING: Panel width {min_panel_w:.0f}mm < 45mm. Text may be compact.")

    fig_h_mm = _figure_height_mm(min_panel_w, row_heights, hspace)
    fig = plt.figure(figsize=(fig_width_mm / MM_PER_INCH, fig_h_mm / MM_PER_INCH))
    gs = gridspec.GridSpec(
        rows,
        cols,
        width_ratios=width_ratios,
        height_ratios=row_heights,
        wspace=wspace,
        hspace=hspace,
        left=0.10,
        right=0.96,
        top=0.95,
        bottom=0.08,
    )

    for i, func in enumerate(panel_funcs):
        loc = placements[i]
        ax = fig.add_subplot(gs[loc]) if isinstance(loc[0], slice) else fig.add_subplot(gs[loc[0], loc[1]])
        try:
            func(ax, specs[i])
        except TypeError:
            func(ax)
        _panel_label(ax, panel_labels[i])

    save_cns_figure(fig, output_prefix)
    print(f"Figure: {fig_width_mm}mm, {rows}x{cols}, {n} panels")
    print(f"Exported: {output_prefix}.pdf + {output_prefix}.png")
    return fig


def r_png_device(spec: dict, output_path: str) -> str:
    """Return an R png() call that matches the panel spec's exact physical dimensions.

    Usage in R script:
        eval(parse(text=Sys.getenv("CNS_PNG_DEVICE")))
        ... draw ...
        dev.off()

    Generated call example for 65mm panel:
        png("panel.png", width=2.559, height=2.559, units="in", res=300)

    NEVER hardcode width=4 in an R png() call. The width/height MUST come
    from the panel spec, otherwise the R panel renders at a different physical
    size than the Python panels, and fonts appear too small or too large.
    """
    w_in = spec["width_mm"] / MM_PER_INCH
    h_in = spec["height_mm"] / MM_PER_INCH
    dpi = spec["dpi"]
    return f'png("{output_path}", width={w_in:.3f}, height={h_in:.3f}, units="in", res={dpi}, type="cairo")'


def render_python_panel(panel_func: Callable, spec: dict, output_path: str | Path):
    """Render one Python panel to an image file for mixed-language composition."""
    import matplotlib as mpl

    mpl.rcParams.update(UNIFIED_RCPARAMS)
    output_path = Path(output_path)
    fig, ax = plt.subplots(figsize=(spec["width_mm"] / MM_PER_INCH, spec["height_mm"] / MM_PER_INCH))
    try:
        panel_func(ax, spec)
    except TypeError:
        panel_func(ax)
    fig.savefig(output_path, bbox_inches="tight", dpi=spec.get("dpi", 300))
    plt.close(fig)
    return output_path


def compose_cross_language(
    panel_specs_list: list[dict],
    panel_types: list[str],
    python_panels: list[tuple[int, Callable]],
    svg_panels: list[tuple[int, str | Path]] | None = None,
    fig_width_mm: float = 183,
    output_prefix: str = "figure",
    work_dir: str | Path | None = None,
    hero_idx: int | None = None,
):
    """Compose mixed Python/R outputs by rendering each panel into a shared grid."""
    work_dir = Path(work_dir or ".")
    panel_map: dict[int, Callable] = {}

    for idx, func in python_panels:
        panel_map[idx] = func

    for idx, image_path in svg_panels or []:
        image_path = Path(image_path)
        if not image_path.is_absolute():
            image_path = work_dir / image_path

        def _image_panel(ax, spec, path=image_path):
            img = mpimg.imread(path)
            ax.imshow(img)
            ax.set_axis_off()

        panel_map[idx] = _image_panel

    missing = [i for i in range(len(panel_specs_list)) if i not in panel_map]
    if missing:
        raise ValueError(f"Missing panel renderers for indexes: {missing}")

    panel_funcs = [panel_map[i] for i in range(len(panel_specs_list))]
    return compose_figure(
        panel_funcs,
        panel_types,
        fig_width_mm=fig_width_mm,
        hero_idx=hero_idx,
        output_prefix=output_prefix,
    )


def save_cns_figure(fig, filename: str):
    """Standard Academic Figure Skill export: vector PDF + 300dpi PNG preview."""
    fig.savefig(f"{filename}.pdf", bbox_inches="tight", dpi=300)
    fig.savefig(f"{filename}.png", bbox_inches="tight", dpi=300)


def _panel_label(ax, text: str, dark_bg: bool = False):
    """Add a Nature-style panel label. Positioned inside the panel area so
    bbox_inches="tight" does not clip it."""
    if dark_bg:
        ax.text(0.02, 0.96, text, transform=ax.transAxes,
                fontsize=9, fontweight="bold", va="top", color="white")
    else:
        ax.text(0.02, 0.96, text, transform=ax.transAxes,
                fontsize=9, fontweight="bold", va="top", color="black")


def _normalize_archetype(raw: str) -> str:
    """Normalize archetype names from contract docs to canonical form.

    Handles: "asymmetric mixed-modality", "schematic-led composite",
    "image plate + quant", "quantitative grid", etc.
    """
    import re
    s = raw.lower()
    s = s.replace("-", "_").replace("+", "_")
    s = re.sub(r"[_\s]+", "_", s).strip("_")
    return s


def detect_hero(panel_types: list[str], archetype: str = "auto") -> int | None:
    """Auto-detect which panel should be the hero based on archetype and panel types.

    Returns the index of the hero panel, or None for symmetric layout.

    Archetypes (from nature-figure stance.md):
      - "quantitative_grid": all panels equal → no hero (symmetric)
      - "schematic-led composite": first schematic/illustration panel is hero
      - "image plate + quant": first image/microscopy panel is hero
      - "asymmetric_mixed": largest/densest panel is hero
      - "auto": infer from panel types below
      - "symmetric": force symmetric (no hero)
    """
    n = len(panel_types)
    if n < 3:
        return None  # 1-2 panels don't need hero treatment

    archetype = _normalize_archetype(archetype)
    tokens = archetype.split("_")

    # "symmetric" as a token (NOT inside "asymmetric")
    if "symmetric" in tokens:
        return None
    if "quantitative" in tokens and "grid" in tokens:
        return None

    if "schematic" in tokens:
        # Find first schematic/illustration panel
        for i, t in enumerate(panel_types):
            if any(kw in t.lower() for kw in ("schematic", "illustration", "model", "diagram", "mechanism")):
                return i
        return 0  # default: first panel as hero

    if "image_plate" in archetype:
        for i, t in enumerate(panel_types):
            if any(kw in t.lower() for kw in ("image", "microscopy", "micrograph", "photo")):
                return i
        return 0

    if "asymmetric" in tokens:
        # Dense panels (heatmap, UMAP, multi-annotation) are typically hero
        dense_types = {"heatmap", "corr_heatmap", "correlation_matrix", "grouped_correlation_matrix",
                       "umap", "manifold", "network", "pca", "rda"}
        for i, t in enumerate(panel_types):
            if any(dt in t.lower().replace(" ", "_") for dt in dense_types):
                return i
        return 0

    # "auto": infer archetype from panel type diversity
    unique_families = len({t.split("_")[0] for t in panel_types})
    if unique_families <= 1:
        return None  # all same type → symmetric
    if any(t in ("heatmap", "corr_heatmap", "correlation_matrix", "grouped_correlation_matrix",
                 "pca", "rda", "umap", "network")
           for t in [pt.lower().replace(" ", "_") for pt in panel_types]):
        # One dense overview panel → makes it the hero
        for i, t in enumerate(panel_types):
            if t.lower().replace(" ", "_") in ("heatmap", "corr_heatmap", "correlation_matrix",
                                                "grouped_correlation_matrix", "pca", "rda"):
                return i
        return 0
    return None  # default: symmetric
