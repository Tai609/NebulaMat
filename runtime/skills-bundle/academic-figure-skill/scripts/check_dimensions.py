#!/usr/bin/env python3
"""
Academic Figure Skill Figure Dimension Compliance Checker.

Checks figure dimensions against journal column widths:
  - Single column: 89 mm (tolerance +/- 3 mm)
  - Double column: 183 mm (tolerance +/- 3 mm)
  - Max height: 247 mm

Supports Python (matplotlib figsize in inches and mm) and R (ggsave, pdf/png
device dimensions).

Usage:
    python check_dimensions.py <target>
    python check_dimensions.py <target> --journal nature-genetics

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
# Journal dimension specifications
# ---------------------------------------------------------------------------

SINGLE_COL_WIDTH_MM = 89.0
DOUBLE_COL_WIDTH_MM = 183.0
MAX_HEIGHT_MM = 247.0
TOLERANCE_MM = 3.0

MM_PER_INCH = 25.4


# ---------------------------------------------------------------------------
# Dimension detection patterns
# ---------------------------------------------------------------------------

# Matplotlib figsize: figsize=(width_inches, height_inches)
# Direct inches
_RE_MPL_FIGSIZE_INCHES = re.compile(
    r"""figsize\s*=\s*\(\s*(?P<width>[\d.]+)\s*,\s*(?P<height>[\d.]+)\s*\)""",
    re.IGNORECASE,
)

# Matplotlib figsize with mm_to_inch conversion:
# figsize=(89 * mm_to_inch, 70 * mm_to_inch) or figsize=(89/25.4, 70/25.4)
_RE_MPL_FIGSIZE_MM_CALC = re.compile(
    r"""figsize\s*=\s*\(\s*(?:[\d.]+\s*\*\s*mm_to_inch|(?P<width>[\d.]+)\s*(?:/\s*25\.4|\*\s*(?:1\s*/\s*25\.4|mm_to_inch)))\s*,\s*(?:[\d.]+\s*\*\s*mm_to_inch|(?P<height>[\d.]+)\s*(?:/\s*25\.4|\*\s*(?:1\s*/\s*25\.4|mm_to_inch)))\s*\)""",
    re.IGNORECASE,
)

# Matplotlib figsize with explicit mm unit comment:
# figsize=(6.93, 5.51)  # 176mm x 140mm or similar
_RE_MPL_FIGSIZE_WITH_MM_COMMENT = re.compile(
    r"""figsize\s*=\s*\(.*?\).*?#.*?(?P<width>[\d.]+)\s*mm\s*[xX\*]\s*(?P<height>[\d.]+)\s*mm""",
    re.IGNORECASE,
)

# plt.subplots with figsize
_RE_PLT_SUBPLOTS_FIGSIZE = re.compile(
    r"""plt\.subplots?\s*\(\s*(?:[^,]*,\s*)*figsize\s*=\s*\(\s*(?P<width>[\d.]+)\s*,\s*(?P<height>[\d.]+)\s*\)""",
    re.IGNORECASE,
)

# Matplotlib figure() with figsize
_RE_MPL_FIGURE = re.compile(
    r"""plt\.figure\s*\(\s*(?:[^,]*,\s*)*figsize\s*=\s*\(\s*(?P<width>[\d.]+)\s*,\s*(?P<height>[\d.]+)\s*\)""",
    re.IGNORECASE,
)

# R ggsave with mm units
_RE_GGSAVE_MM = re.compile(
    r"""ggsave\s*\([^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)\s*,[^)]*units\s*=\s*['"]mm['"]""",
    re.IGNORECASE,
)

# R ggsave with inches units
_RE_GGSAVE_INCHES = re.compile(
    r"""ggsave\s*\([^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)\s*,[^)]*units\s*=\s*['"]in(?:ch(?:es)?)?['"]""",
    re.IGNORECASE,
)

# R ggsave with no explicit units (defaults to inches in R)
_RE_GGSAVE_NOUNITS = re.compile(
    r"""ggsave\s*\([^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)""",
    re.IGNORECASE,
)

# R pdf() device
_RE_R_PDF = re.compile(
    r"""pdf\s*\(\s*[^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)""",
    re.IGNORECASE,
)

# R png() device with mm units
_RE_R_PNG_MM = re.compile(
    r"""png\s*\([^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)\s*,[^)]*units\s*=\s*['"]mm['"]""",
    re.IGNORECASE,
)

# R png() device with inches
_RE_R_PNG_INCHES = re.compile(
    r"""png\s*\([^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)\s*,[^)]*units\s*=\s*['"]in(?:ch(?:es)?)?['"]""",
    re.IGNORECASE,
)

# R cairo_pdf() device
_RE_R_CAIRO_PDF = re.compile(
    r"""cairo_pdf\s*\(\s*[^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)""",
    re.IGNORECASE,
)

# R svg() device
_RE_R_SVG = re.compile(
    r"""svg\s*\(\s*[^)]*width\s*=\s*(?P<width>[\d.]+)\s*,[^)]*height\s*=\s*(?P<height>[\d.]+)""",
    re.IGNORECASE,
)


def _parse_dim(value_str):
    """Parse a dimension string to float."""
    try:
        return float(value_str)
    except (ValueError, TypeError):
        return None


def _classify_width(width_mm):
    """
    Classify width as single-column, double-column, or neither.

    Returns (label, matches) where matches is True if within tolerance.
    """
    if abs(width_mm - SINGLE_COL_WIDTH_MM) <= TOLERANCE_MM:
        return "single-column (89 mm)", True
    if abs(width_mm - DOUBLE_COL_WIDTH_MM) <= TOLERANCE_MM:
        return "double-column (183 mm)", True
    return "unknown", False


def _extract_dimensions(code):
    """
    Extract all dimension declarations from code.

    Returns list of (width_mm, height_mm, context, source_type) tuples.
    source_type: "mpl_inches", "ggsave_mm", "ggsave_inches", "r_pdf_inches", etc.
    """
    dimensions = []

    # --- Matplotlib figsize in inches ---
    for pattern, source in [
        (_RE_MPL_FIGSIZE_INCHES, "matplotlib figsize (inches)"),
        (_RE_PLT_SUBPLOTS_FIGSIZE, "matplotlib subplots figsize (inches)"),
        (_RE_MPL_FIGURE, "matplotlib figure figsize (inches)"),
    ]:
        for match in pattern.finditer(code):
            w = _parse_dim(match.group("width"))
            h = _parse_dim(match.group("height"))
            if w is not None and h is not None:
                width_mm = w * MM_PER_INCH
                height_mm = h * MM_PER_INCH
                context = match.group(0).strip()
                if len(context) > 80:
                    context = context[:77] + "..."
                dimensions.append((width_mm, height_mm, context, source))

    # --- Matplotlib figsize with mm calculation ---
    for match in _RE_MPL_FIGSIZE_MM_CALC.finditer(code):
        w = _parse_dim(match.group("width"))
        h = _parse_dim(match.group("height"))
        if w is not None and h is not None:
            # The MM_CALC pattern captures raw mm values before the /25.4 conversion
            context = match.group(0).strip()
            if len(context) > 80:
                context = context[:77] + "..."
            dimensions.append((w, h, context, "matplotlib figsize (mm conversion)"))

    # --- Matplotlib figsize with mm comment ---
    for match in _RE_MPL_FIGSIZE_WITH_MM_COMMENT.finditer(code):
        w = _parse_dim(match.group("width"))
        h = _parse_dim(match.group("height"))
        if w is not None and h is not None:
            context = match.group(0).strip()
            if len(context) > 80:
                context = context[:77] + "..."
            dimensions.append((w, h, context, "comment-annotated dimensions (mm)"))

    # --- R ggsave with mm units ---
    for match in _RE_GGSAVE_MM.finditer(code):
        w = _parse_dim(match.group("width"))
        h = _parse_dim(match.group("height"))
        if w is not None and h is not None:
            context = match.group(0).strip()
            if len(context) > 80:
                context = context[:77] + "..."
            dimensions.append((w, h, context, "ggsave (mm)"))

    # --- R ggsave with inches units ---
    for match in _RE_GGSAVE_INCHES.finditer(code):
        w = _parse_dim(match.group("width"))
        h = _parse_dim(match.group("height"))
        if w is not None and h is not None:
            context = match.group(0).strip()
            if len(context) > 80:
                context = context[:77] + "..."
            dimensions.append((w * MM_PER_INCH, h * MM_PER_INCH, context, "ggsave (inches)"))

    # --- R pdf/png/cairo_pdf/svg devices (in inches by default) ---
    for pattern, source in [
        (_RE_R_PDF, "R pdf() device (inches)"),
        (_RE_R_CAIRO_PDF, "R cairo_pdf() device (inches)"),
        (_RE_R_SVG, "R svg() device (inches)"),
    ]:
        for match in pattern.finditer(code):
            w = _parse_dim(match.group("width"))
            h = _parse_dim(match.group("height"))
            if w is not None and h is not None:
                context = match.group(0).strip()
                if len(context) > 80:
                    context = context[:77] + "..."
                dimensions.append((w * MM_PER_INCH, h * MM_PER_INCH, context, source))

    # --- R png with mm units ---
    for match in _RE_R_PNG_MM.finditer(code):
        w = _parse_dim(match.group("width"))
        h = _parse_dim(match.group("height"))
        if w is not None and h is not None:
            context = match.group(0).strip()
            if len(context) > 80:
                context = context[:77] + "..."
            dimensions.append((w, h, context, "R png() device (mm)"))

    # --- R png with inches ---
    for match in _RE_R_PNG_INCHES.finditer(code):
        w = _parse_dim(match.group("width"))
        h = _parse_dim(match.group("height"))
        if w is not None and h is not None:
            context = match.group(0).strip()
            if len(context) > 80:
                context = context[:77] + "..."
            dimensions.append((w * MM_PER_INCH, h * MM_PER_INCH, context, "R png() device (inches)"))

    return dimensions


def check(target, journal="nature-genetics"):
    """
    Check a figure target for dimension compliance.

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
    name = "Figure Dimensions"
    try:
        code = _resolve_target(target)
    except Exception as exc:
        return name, False, [f"  - ERROR: Could not read target: {exc}"]

    if not code.strip():
        return name, True, ["  - No code content to check."]

    messages = []
    dimensions = _extract_dimensions(code)

    if not dimensions:
        messages.append(
            "  - No explicit figure dimension declarations found. "
            "Set dimensions to 89 mm (single-column) or 183 mm (double-column)."
        )
        return name, False, messages

    all_pass = True
    for width_mm, height_mm, context, source in dimensions:
        # Check width against column standards
        col_label, col_match = _classify_width(width_mm)

        # Check height against max
        height_ok = height_mm <= MAX_HEIGHT_MM

        msgs = []
        if col_match:
            msgs.append(f"Width {width_mm:.1f} mm matches {col_label}")
        else:
            all_pass = False
            single_diff = abs(width_mm - SINGLE_COL_WIDTH_MM)
            double_diff = abs(width_mm - DOUBLE_COL_WIDTH_MM)
            if single_diff < double_diff:
                msgs.append(
                    f"Width {width_mm:.1f} mm does not match single-column "
                    f"(89 mm, off by {single_diff:.1f} mm) or double-column "
                    f"(183 mm, off by {double_diff:.1f} mm)"
                )
            else:
                msgs.append(
                    f"Width {width_mm:.1f} mm does not match known column widths "
                    f"(89/183 mm). Closest: double-column ({double_diff:.1f} mm off)"
                )

        if height_ok:
            msgs.append(f"Height {height_mm:.1f} mm within {MAX_HEIGHT_MM:.0f} mm limit")
        else:
            all_pass = False
            msgs.append(
                f"Height {height_mm:.1f} mm exceeds {MAX_HEIGHT_MM:.0f} mm maximum"
            )

        # Format the message
        short_ctx = f"[{source}] {context}" if context else source
        messages.append(f"  {short_ctx}:")
        for m in msgs:
            messages.append(f"    {m}")

    return name, all_pass, messages


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Academic Figure Skill Figure Dimension Checker"
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
