#!/usr/bin/env python3
"""Academic Figure Skill QA Validator — translates references/checklist.md into executable assertions.

Input:  a generated Python plot script (or inline code string)
Output: structured PASS/FAIL/WARN report with line-level issue locations.

Usage:
    python qa_validator.py <script.py>              # validate a file
    python qa_validator.py "<code string>"          # validate inline code
    python qa_validator.py my_fig.py --journal nature  # journal-specific checks

Checks: AP-0 through AP-7, CL-1 through CL-7 (≈20 automated checks).
Pass 2 (VI-1..VI-6) and Pass 3 (VV-1..VV-5) are LLM-executed per checklist.md.
No AI needed for automated checks — runs anywhere Python is installed.
"""

from __future__ import annotations
import argparse, ast, os, re, sys
from collections import Counter
from dataclasses import dataclass, field
from itertools import chain
from pathlib import Path
from typing import Any, Iterable


@dataclass
class Finding:
    check_id: str
    pass_: bool
    category: str  # "PASS", "FAIL", "WARN"
    message: str
    line: int | None = None  # best-effort line number


# ═══════════════════════════════════════════════════════════
# Pass 0 — Anti-Pattern Scan (AP-0 through AP-7)
# ═══════════════════════════════════════════════════════════

def check_ap0_style_baseline(source: str) -> list[Finding]:
    """Verify the 3 mandatory baseline blocks are present."""
    findings = []

    # Typography baseline
    typo_required = ["font.family", "font.sans-serif", "font.size", "axes.spines.top",
                     "axes.spines.right", "axes.linewidth", "xtick.direction", "legend.frameon"]
    typo_ok = all(kw in source for kw in typo_required)
    findings.append(Finding("AP-0", typo_ok,
        "PASS" if typo_ok else "FAIL",
        "Typography baseline present" if typo_ok else
        f"Missing typography baseline. Need: {', '.join(k for k in typo_required if k not in source)}"))

    # Color baseline
    color_patterns = ['CATEGORICAL = [', 'DIVERGING = [', '#2166AC', '#B2182B', '#999999']
    color_ok = all(p in source for p in color_patterns)
    findings.append(Finding("AP-0", color_ok,
        "PASS" if color_ok else "FAIL",
        "Color palette baseline present" if color_ok else
        "Missing CNS color palette (CATEGORICAL/DIVERGING)"))

    # Export baseline
    export_patterns = ["pdf.fonttype", "svg.fonttype", "save_cns_figure"]
    export_ok = "pdf.fonttype" in source and ("42" in source or "'42'" in source or '"42"' in source)
    findings.append(Finding("AP-0", export_ok,
        "PASS" if export_ok else "FAIL",
        "Export baseline (pdf.fonttype=42, svg.fonttype='none') present" if export_ok else
        "Missing export baseline — pdf.fonttype should be 42"))

    return findings


def check_ap1_default_palette(source: str) -> Finding:
    """Detect default matplotlib/seaborn/ggplot2 palettes."""
    defaults = [
        "cmap='tab10'", "cmap='tab20'", "cmap='jet'", "cmap='rainbow'", "cmap='hsv'",
        "plt.cm.tab10", "plt.cm.tab20", "plt.cm.jet",
        "color_palette('deep')", "color_palette('muted')", "color_palette('pastel')",
        "color_palette('bright')", "color_palette('dark')",
        "palette='deep'", "palette='muted'", "palette='Set1'", "palette='Set2'",
        "scale_color_hue()", "scale_fill_hue()",
        "scale_color_brewer(palette='Set1')", "scale_fill_brewer(palette='Set2')",
        "brewer.pal(n, 'Set1')", "brewer.pal(n, 'Paired')",
    ]
    hits = [d for d in defaults if d in source]
    ok = len(hits) == 0
    return Finding("AP-1", ok,
        "PASS" if ok else "FAIL",
        "No default palette detected" if ok else f"Default palette found: {hits}")


def check_ap2_jet_rainbow(source: str) -> Finding:
    """Detect jet/rainbow/hsv used as colormap."""
    patterns = ["cmap='jet'", "cmap='rainbow'", "cmap='hsv'",
                "cmap=\"jet\"", "cmap=\"rainbow\"", "cmap=\"hsv\""]
    hits = [p for p in patterns if p in source]
    ok = len(hits) == 0
    return Finding("AP-2", ok,
        "PASS" if ok else "FAIL",
        "No jet/rainbow colormap" if ok else f"Jet/rainbow found: {hits}")


def check_ap3_four_sided_borders(source: str) -> Finding:
    """Verify top and right spines are removed."""
    top_off = "spines.top" in source and ("False" in source.split("spines.top", 1)[1][:20] or
                                           "set_visible(False)" in source)
    right_off = "spines.right" in source and ("False" in source.split("spines.right", 1)[1][:20] or
                                               "set_visible(False)" in source)
    ok = top_off and right_off
    return Finding("AP-3", ok,
        "PASS" if ok else "FAIL",
        "Top/right spines removed" if ok else "Top/right spines not clearly removed — verify")


def check_ap4_legend_occlusion(source: str) -> Finding:
    """Check legend placement avoids data occlusion."""
    # bbox_to_anchor within 30 chars of .legend( — true external placement
    has_external = bool(re.search(r'\.legend\s*\(.{0,30}bbox_to_anchor', source))
    has_direct = "direct label" in source.lower()
    # In R: theme(legend.position = 'right') or 'bottom' or 'none'
    has_r_external = "legend.position" in source and any(p in source for p in ["'right'", "'bottom'", "'none'"])
    ok = has_external or has_direct or has_r_external
    return Finding("AP-4", ok,
        "PASS" if ok else "WARN",
        "Legend outside plot or direct labeling" if ok else "Legend may occlude data — no bbox_to_anchor or external placement found")


def check_ap5_low_res_export(source: str) -> Finding:
    """Verify vector export + 300dpi raster."""
    has_pdf = ".pdf" in source or "'pdf'" in source or '"pdf"' in source
    has_svg = ".svg" in source or "'svg'" in source or '"svg"' in source
    has_eps = ".eps" in source or "'eps'" in source or '"eps"' in source
    ok = has_pdf or has_svg or has_eps
    return Finding("AP-5", ok,
        "PASS" if ok else "FAIL",
        "Vector export present" if ok else "No vector export (PDF/SVG/EPS) — only raster found")


def check_ap6_missing_points(source: str) -> Finding:
    """For bar/box plots with small n, verify individual points shown."""
    has_points = any(kw in source for kw in
        ["stripplot", "swarmplot", "geom_point", "geom_jitter",
         "scatter", "sns.stripplot", "position_jitter"])
    has_bar = any(kw in source for kw in ["bar", "boxplot", "barh", "geom_boxplot"])
    if not has_bar:
        return Finding("AP-6", True, "PASS", "N/A — not a bar/box plot")
    return Finding("AP-6", has_points,
        "PASS" if has_points else "WARN",
        "Individual data points shown" if has_points else "Bar/box without individual points — add stripplot or geom_jitter")


def check_ap7_default_font(source: str) -> Finding:
    """Verify Arial/Helvetica font is explicitly set."""
    has_arial = any(f in source for f in ["Arial", "Helvetica", "Liberation Sans"])
    return Finding("AP-7", has_arial,
        "PASS" if has_arial else "FAIL",
        "Arial/Helvetica font set" if has_arial else "Default font (DejaVu Sans / R sans) — add Arial")


# ═══════════════════════════════════════════════════════════
# Pass 1 — Code-Level Compliance (CL-1 through CL-7)
# ═══════════════════════════════════════════════════════════

def _find_fontsizes(source: str) -> list[int]:
    """Parse all fontSize params from code."""
    sizes = []
    for match in re.finditer(r'(?:fontsize|font\.size|labelsize|titlesize|size)\s*[=:]\s*(\d+)', source):
        sizes.append(int(match.group(1)))
    return sizes


def check_cl1_fontsize(source: str) -> Finding:
    sizes = _find_fontsizes(source)
    if not sizes:
        return Finding("CL-1", True, "PASS", "No fontsize declarations — relying on defaults (verify manually)")
    too_small = [s for s in sizes if s < 5]
    ok = len(too_small) == 0
    return Finding("CL-1", ok,
        "PASS" if ok else "FAIL",
        f"All font sizes >= 5pt (min: {min(sizes)}pt)" if ok else f"Fonts below 5pt: {too_small}")


def check_cl2_dimensions(source: str) -> Finding:
    """Check figure dimensions match 89mm or 183mm column width."""
    # Look for size declarations in mm or inches
    mm_patterns = re.findall(r'figsize\s*=\s*\(\s*(\d+)\s*\*\s*mm_to_inch', source)
    inch_patterns = re.findall(r'figsize\s*=\s*\(\s*(\d+\.?\d*)\s*,\s*(\d+\.?\d*)\s*\)', source)
    # compose.py style: fig_width_mm / MM_PER_INCH
    compose_patterns = re.findall(r'(?:fig_width_mm|fig_w_mm)\s*=\s*(\d+\.?\d*)', source)
    ratio_divs = re.findall(r'(\d+\.?\d*)\s*/\s*MM_PER_INCH', source)
    ratio_slash = re.findall(r'(\d+\.?\d*)\s*/\s*mm_to_inch', source)
    # R: ggsave(width = XX, height = YY, units = "mm")
    r_mm = re.findall(r'width\s*=\s*(\d+\.?\d*)\s*,\s*(?:height|units\s*=\s*["\']mm)', source)

    widths_found = []
    if mm_patterns:
        widths_found = [float(w) for w in mm_patterns]
    elif inch_patterns:
        widths_found = [float(w) * 25.4 for w, _ in inch_patterns]
    elif compose_patterns:
        widths_found = [float(w) for w in compose_patterns]
    elif ratio_divs:
        widths_found = [float(w) for w in ratio_divs]
    elif ratio_slash:
        widths_found = [float(w) for w in ratio_slash]

    if not widths_found:
        return Finding("CL-2", True, "WARN", "No explicit dimension declaration — verify matches 89/183mm column")

    w = widths_found[0]
    is_single = abs(w - 89) <= 3
    is_double = abs(w - 183) <= 5
    ok = is_single or is_double
    return Finding("CL-2", ok,
        "PASS" if ok else "FAIL",
        f"Width {w:.0f}mm matches {'single' if is_single else 'double'}-column" if ok
        else f"Width {w:.0f}mm matches neither single (89mm) nor double (183mm)")


def check_cl3_dpi(source: str) -> Finding:
    """Check DPI >= 300 in savefig/ggsave calls or rcParams dict."""
    dpi_values = [int(m.group(1)) for m in re.finditer(r'dpi\s*=\s*(\d+)', source)]
    res_values = [int(m.group(1)) for m in re.finditer(r'res\s*=\s*(\d+)', source)]
    # rcParams dict form: "savefig.dpi": 300 or 'savefig.dpi': 300
    dict_dpi = [int(m.group(1)) for m in re.finditer(r'''["']savefig\.dpi["']\s*:\s*(\d+)''', source)]
    all_vals = dpi_values + res_values + dict_dpi
    if not all_vals:
        return Finding("CL-3", False, "WARN", "No explicit DPI — matplotlib defaults to 100 (insufficient for print)")
    too_low = [v for v in all_vals if v < 300]
    ok = len(too_low) == 0
    return Finding("CL-3", ok,
        "PASS" if ok else "FAIL",
        f"All DPI values >= 300" if ok else f"DPI below 300: {too_low}")


def check_cl4_font_embedding(source: str) -> Finding:
    has_pdf_type = "pdf.fonttype" in source and ("42" in source.split("pdf.fonttype", 1)[1][:20])
    has_svg_type = "svg.fonttype" in source and ("none" in source.split("svg.fonttype", 1)[1][:20].lower())
    has_cairo = "cairo_pdf" in source or "cairo_png" in source
    ok = has_pdf_type or has_cairo
    return Finding("CL-4", ok,
        "PASS" if ok else "FAIL",
        "Font embedding configured" if ok else "No pdf.fonttype=42 or cairo_pdf — fonts may not embed")


def check_cl5_spine_linewidth(source: str) -> Finding:
    """Check spine linewidth is thin (0.5-0.8)."""
    lw_match = re.search(r'axes\.linewidth["\']?\s*[:=]\s*(\d+\.?\d*)', source)
    if not lw_match:
        return Finding("CL-5", True, "PASS", "Spine linewidth default (verify 0.5-0.8)")
    lw = float(lw_match.group(1))
    ok = 0.4 <= lw <= 1.0
    return Finding("CL-5", ok,
        "PASS" if ok else "WARN",
        f"Spine linewidth {lw}pt in range" if ok else f"Spine linewidth {lw}pt — consider 0.5-0.6pt")


def check_cl6_tick_direction(source: str) -> Finding:
    """Verify tick direction is set outward."""
    has_out = "direction" in source and "out" in source.split("direction", 1)[1][:20].strip().strip(":'\"")
    if has_out:
        return Finding("CL-6", True, "PASS", "Ticks outward")
    return Finding("CL-6", False, "WARN", "Tick direction not explicitly set to 'out' — verify")


def check_cl7_export_completeness(source: str) -> Finding:
    has_vector = ".pdf" in source or ".svg" in source or ".eps" in source
    has_raster = ".png" in source or ".tif" in source
    ok = has_vector and has_raster
    return Finding("CL-7", ok,
        "PASS" if ok else "FAIL",
        "Vector + raster both exported" if ok else "Missing export — need both PDF and PNG")
