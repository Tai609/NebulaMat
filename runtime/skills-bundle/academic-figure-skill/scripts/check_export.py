#!/usr/bin/env python3
"""
Academic Figure Skill Export Format & Resolution Checker.

Checks scientific figure export settings for CNS journal compliance:
  - Vector export (PDF/SVG/EPS) for line art
  - Raster export (PNG/TIFF) resolution (>=300 dpi minimum)
  - Font embedding settings (pdf.fonttype=42, svg.fonttype=none)

Supports Python (matplotlib savefig, rcParams) and R (ggsave, cairo_pdf,
png/tiff devices).

Usage:
    python check_export.py <target>
    python check_export.py <target> --journal nature-genetics

The target may be a file path or an inline code string.
"""

import re
import sys
import os
import argparse


def _resolve_target(target):
    """If target is an existing file path, read its contents; otherwise return as-is."""
    if os.path.isfile(target):
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    return target


# ---------------------------------------------------------------------------
# Export format detection patterns
# ---------------------------------------------------------------------------

# Vector format extensions in savefig/ggsave
_RE_VECTOR_SAVE = re.compile(
    r"""(?:savefig|ggsave|dev\.off)\s*\([^)]*['\"](?P<filename>[^'\"]+\.(?P<ext>pdf|svg|eps))['\"]""",
    re.IGNORECASE,
)

# Raster format extensions in savefig/ggsave
_RE_RASTER_SAVE = re.compile(
    r"""(?:savefig|ggsave)\s*\([^)]*['\"](?P<filename>[^'\"]+\.(?P<ext>png|tiff?|jpe?g))['\"]""",
    re.IGNORECASE,
)

# R pdf/svg/cairo_pdf devices with filenames
_RE_R_VECTOR_DEVICE = re.compile(
    r"""(?:pdf|cairo_pdf|svg|postscript)\s*\(\s*['\"](?P<filename>[^'\"]+\.(?P<ext>pdf|svg|eps))['\"]""",
    re.IGNORECASE,
)

# R png/tiff/jpeg devices
_RE_R_RASTER_DEVICE = re.compile(
    r"""(?:png|tiff|jpeg)\s*\(\s*['\"](?P<filename>[^'\"]+\.(?P<ext>png|tiff?|jpe?g))['\"]""",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# DPI / Resolution detection patterns
# ---------------------------------------------------------------------------

# matplotlib savefig dpi
_RE_MPL_SAVEFIG_DPI = re.compile(
    r"""savefig\s*\([^)]*dpi\s*=\s*(?P<dpi>\d+)""",
    re.IGNORECASE,
)

# matplotlib rcParams DPI settings
_RE_MPL_RCPARAMS_DPI = re.compile(
    r"""["'](?:savefig\.dpi)['"]\s*:\s*(?P<dpi>\d+)""",
    re.IGNORECASE,
)

# ggsave dpi
_RE_GGSAVE_DPI = re.compile(
    r"""ggsave\s*\([^)]*dpi\s*=\s*(?P<dpi>\d+)""",
    re.IGNORECASE,
)

# R png device res parameter (resolution)
_RE_R_PNG_RES = re.compile(
    r"""png\s*\([^)]*res\s*=\s*(?P<dpi>\d+)""",
    re.IGNORECASE,
)

# R tiff device res parameter
_RE_R_TIFF_RES = re.compile(
    r"""tiff\s*\([^)]*res\s*=\s*(?P<dpi>\d+)""",
    re.IGNORECASE,
)

# figure.dpi rcParams
_RE_FIGURE_DPI = re.compile(
    r"""["']figure\.dpi['"]\s*:\s*(?P<dpi>\d+)""",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Font embedding detection patterns
# ---------------------------------------------------------------------------

# matplotlib pdf.fonttype
_RE_PDF_FONTTYPE = re.compile(
    r"""["']pdf\.fonttype['"]\s*:\s*(?P<value>\d+)""",
    re.IGNORECASE,
)

# matplotlib svg.fonttype
_RE_SVG_FONTTYPE = re.compile(
    r"""["']svg\.fonttype['"]\s*:\s*(?P<value>\w+)""",
    re.IGNORECASE,
)

# savefig keyword arguments with pdf.fonttype / svg.fonttype
_RE_SAVEFIG_PDF_FONTTYPE = re.compile(
    r"""savefig\s*\([^)]*pdf\.fonttype\s*=\s*(?P<value>\d+)""",
    re.IGNORECASE,
)

_RE_SAVEFIG_SVG_FONTTYPE = re.compile(
    r"""savefig\s*\([^)]*svg\.fonttype\s*=\s*['\"](?P<value>\w+)['\"]""",
    re.IGNORECASE,
)

# mpl.rcParams.update with fonttype settings
_RE_RCPARAMS_FONTTYPE = re.compile(
    r"""mpl\.rcParams\s*\.\s*update\s*\(""",
    re.IGNORECASE,
)

# R cairo_pdf (handles font embedding automatically)
_RE_R_CAIRO_PDF = re.compile(
    r"""cairo_pdf\s*\(""",
    re.IGNORECASE,
)

# R showtext for font embedding
_RE_R_SHOWTEXT = re.compile(
    r"""showtext_auto\s*\(|showtext\.begin|library\s*\(\s*showtext\s*\)""",
    re.IGNORECASE,
)


MIN_DPI = 300


def _parse_int(value_str):
    """Parse a string to int."""
    try:
        return int(value_str)
    except (ValueError, TypeError):
        return None


def _check_export_formats(code):
    """Check that vector formats are used appropriately."""
    messages = []

    vector_exports = _RE_VECTOR_SAVE.findall(code)
    raster_exports = _RE_RASTER_SAVE.findall(code)

    r_vector_devices = _RE_R_VECTOR_DEVICE.findall(code)
    r_raster_devices = _RE_R_RASTER_DEVICE.findall(code)

    vector_count = len(vector_exports) + len(r_vector_devices)
    raster_count = len(raster_exports) + len(r_raster_devices)

    # Check for vector output
    if vector_count == 0:
        # Check if the code has any save commands at all
        has_any_save = (
            re.search(r"""savefig|ggsave|pdf\s*\(|cairo_pdf\s*\(|svg\s*\(|png\s*\(|tiff\s*\(""", code)
            is not None
        )
        if has_any_save:
            if raster_count > 0:
                messages.append(
                    "  - Only raster format(s) found (PNG/TIFF/JPEG). "
                    "Vector format (PDF/SVG/EPS) should be the primary output "
                    "for line art, bar charts, scatter plots, etc."
                )
        else:
            messages.append(
                "  - No export command found. Always produce a vector master "
                "(PDF preferred) and a 300 dpi PNG preview."
            )
    else:
        # List what was found
        for filename, ext in vector_exports + r_vector_devices:
            messages.append(f"  - Vector export detected: {filename} ({ext.upper()})")
            break  # Just note the first one

    # Check for raster preview alongside vector
    if vector_count > 0 and raster_count == 0:
        messages.append(
            "  - Vector export found but no raster preview (PNG). "
            "Deliver both: vector master + 300 dpi PNG preview."
        )

    return messages


def _check_dpi(code):
    """Check DPI/resolution settings."""
    messages = []
    dpi_values = []

    # Check all DPI sources
    for pattern, label in [
        (_RE_MPL_SAVEFIG_DPI, "matplotlib savefig dpi"),
        (_RE_MPL_RCPARAMS_DPI, "matplotlib rcParams savefig.dpi"),
        (_RE_GGSAVE_DPI, "ggsave dpi"),
        (_RE_R_PNG_RES, "R png() res"),
        (_RE_R_TIFF_RES, "R tiff() res"),
        (_RE_FIGURE_DPI, "matplotlib rcParams figure.dpi"),
    ]:
        for match in pattern.finditer(code):
            dpi = _parse_int(match.group("dpi"))
            if dpi is not None:
                dpi_values.append((dpi, label))

    if not dpi_values:
        messages.append(
            "  - No explicit DPI/resolution setting found. "
            f"Set dpi >= {MIN_DPI} for raster output."
        )
    else:
        low_dpi = [(d, l) for d, l in dpi_values if d < MIN_DPI]
        for dpi, label in low_dpi:
            messages.append(
                f"  - Low DPI detected: {dpi} dpi in {label} "
                f"(minimum {MIN_DPI} dpi required)"
            )

        # Report passing values too for informational purposes
        ok_dpi = [d for d, _ in dpi_values if d >= MIN_DPI]
        if ok_dpi and not low_dpi:
            messages.append(
                f"  - DPI settings OK: {', '.join(str(d) for d in ok_dpi)} dpi "
                f"(minimum {MIN_DPI})"
            )

    return messages


def _check_font_embedding(code):
    """Check font embedding settings (pdf.fonttype, svg.fonttype)."""
    messages = []

    has_pdf_export = bool(
        _RE_VECTOR_SAVE.search(code)
        or _RE_R_VECTOR_DEVICE.search(code)
    )
    is_pdf_export = bool(
        re.search(r"""\.pdf['\"]""", code, re.IGNORECASE)
    )

    # Check pdf.fonttype = 42
    pdf_fonttype_match = _RE_PDF_FONTTYPE.search(code)
    savefig_pdf_match = _RE_SAVEFIG_PDF_FONTTYPE.search(code)

    if pdf_fonttype_match:
        value = _parse_int(pdf_fonttype_match.group("value"))
        if value == 42:
            messages.append(
                "  - pdf.fonttype=42 set correctly (TrueType font embedding)"
            )
        else:
            messages.append(
                f"  - pdf.fonttype={value} (should be 42 for TrueType embedding). "
                "Set pdf.fonttype=42 to embed fonts as text, not outlines."
            )
    elif savefig_pdf_match:
        value = _parse_int(savefig_pdf_match.group("value"))
        if value == 42:
            messages.append(
                "  - pdf.fonttype=42 set in savefig arguments"
            )
        else:
            messages.append(
                f"  - pdf.fonttype={value} in savefig (should be 42)"
            )
    elif has_pdf_export and is_pdf_export:
        messages.append(
            "  - PDF export detected but pdf.fonttype=42 not set. "
            "Add: mpl.rcParams['pdf.fonttype'] = 42"
        )

    # Check svg.fonttype = "none"
    svg_fonttype_match = _RE_SVG_FONTTYPE.search(code)
    savefig_svg_match = _RE_SAVEFIG_SVG_FONTTYPE.search(code)

    if svg_fonttype_match:
        value = svg_fonttype_match.group("value").strip("'\"")
        if value.lower() == "none":
            messages.append(
                "  - svg.fonttype='none' set correctly (editable text in SVG)"
            )
        else:
            messages.append(
                f"  - svg.fonttype='{value}' (should be 'none' for editable text). "
                "Set svg.fonttype='none' to keep text as text in SVG output."
            )
    elif savefig_svg_match:
        value = savefig_svg_match.group("value").strip("'\"")
        if value.lower() == "none":
            messages.append("  - svg.fonttype='none' set in savefig arguments")
        else:
            messages.append(
                f"  - svg.fonttype='{value}' in savefig (should be 'none')"
            )

    # Check for R cairo_pdf (handles embedding automatically -- good)
    if _RE_R_CAIRO_PDF.search(code):
        messages.append(
            "  - R cairo_pdf() device detected (handles font embedding automatically)"
        )

    # Check for R showtext package usage
    if _RE_R_SHOWTEXT.search(code):
        messages.append(
            "  - R showtext package detected (handles font registration for embedding)"
        )

    return messages


def check(target, journal="nature-genetics"):
    """
    Check a figure target for export format and resolution compliance.

    Parameters
    ----------
    target : str
        File path to code or inline code string.
    journal : str
        Target journal name (default: "nature-genetics").

    Returns
    -------
    tuple : (str name, bool passed, list messages)
    """
    name = "Export Format & Resolution"
    try:
        code = _resolve_target(target)
    except Exception as exc:
        return name, False, [f"  - ERROR: Could not read target: {exc}"]

    if not code.strip():
        return name, True, ["  - No code content to check."]

    messages = []
    messages += _check_export_formats(code)
    messages += _check_dpi(code)
    messages += _check_font_embedding(code)

    # Consider FAIL if there are actual violations (messages that are not informational)
    # Violation patterns: missing export, low DPI, wrong fonttype
    violations = [
        m for m in messages
        if any(phrase in m for phrase in [
            "No export command",
            "only raster format",
            "no raster preview",
            "No explicit DPI",
            "Low DPI",
            "should be 42",
            "should be 'none'",
            "not set",
        ])
    ]
    passed = len(violations) == 0

    return name, passed, messages


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Academic Figure Skill Export Format & Resolution Checker"
    )
    parser.add_argument(
        "target",
        help="File path to figure code or inline code string.",
    )
    parser.add_argument(
        "--journal",
        default="nature-genetics",
        help="Target journal (default: nature-genetics).",
    )
    args = parser.parse_args()

    name, passed, messages = check(args.target, journal=args.journal)

    print(f"\n{'=' * 60}")
    print(f"  {name}")
    print(f"{'=' * 60}")
    status = "PASS" if passed else "FAIL"
    print(f"  Status: {status}")
    for msg in messages:
        print(msg)
    print(f"{'=' * 60}\n")

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
