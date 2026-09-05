#!/usr/bin/env python3
"""
Academic Figure Skill Font Size Compliance Checker.

Checks scientific figure code for font size violations (minimum 5pt at print
dimensions) and DejaVu Sans / generic font family usage. Supports Python
(matplotlib) and R (ggplot2, ComplexHeatmap).

Usage:
    python check_fontsize.py <target>
    python check_fontsize.py <target> --journal nature-genetics

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


# Minimum allowed font size in points
MIN_FONT_SIZE = 5

# ---------------------------------------------------------------------------
# Font size detection patterns
# ---------------------------------------------------------------------------

# Matplotlib rcParams font size settings
_RE_MATPLOTLIB_FONTSIZES = [
    # rcParams dict style: "font.size": 7, "axes.titlesize": 8, etc.
    re.compile(
        r"""["'](?P<key>(?:font|axes|xtick|ytick|legend|figure)\.(?:size|titlesize|labelsize|fontsize))["']\s*:\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
    # mpl.rcParams.update({...}) or mpl.rc(...)
    re.compile(
        r"""mpl\.rc(?:Params)?(?:\[['"](?P<key2>(?:font|axes|xtick|ytick|legend|figure)\.(?:size|titlesize|labelsize|fontsize))['"]\])?\s*[=\(]\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
    # mpl.rc('font', size=7)
    re.compile(
        r"""mpl\.rc\s*\(\s*['"]font['"]\s*,\s*size\s*=\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
    # fontsize=7 keyword in function calls
    re.compile(
        r"""(?:fontsize|font_size|font\.size)\s*=\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
]

# R ggplot2 base_size in theme
_RE_GGPLOT2_FONTSIZES = [
    # theme_bw(base_size=7), theme_minimal(base_size=7), etc.
    re.compile(
        r"""theme_\w+\s*\(\s*base_size\s*=\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
    # element_text(size=X)
    re.compile(
        r"""element_text\s*\([^)]*size\s*=\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
    # axis.title = element_text(size=X)
    re.compile(
        r"""axis\.(?:title|text)\s*=\s*element_text\s*\([^)]*size\s*=\s*(?P<value>\d+(?:\.\d+)?)[^)]*\)""",
        re.IGNORECASE,
    ),
    # legend.text = element_text(size=X)
    re.compile(
        r"""legend\.(?:title|text)\s*=\s*element_text\s*\([^)]*size\s*=\s*(?P<value>\d+(?:\.\d+)?)[^)]*\)""",
        re.IGNORECASE,
    ),
    # strip.text = element_text(size=X)
    re.compile(
        r"""strip\.text\s*=\s*element_text\s*\([^)]*size\s*=\s*(?P<value>\d+(?:\.\d+)?)[^)]*\)""",
        re.IGNORECASE,
    ),
]

# R ComplexHeatmap gpar fontsize
_RE_COMPLEXHEATMAP_FONTSIZES = [
    # gpar(fontsize=X) or gpar(..., fontsize=X, ...)
    re.compile(
        r"""gpar\s*\([^)]*fontsize\s*=\s*(?P<value>\d+(?:\.\d+)?)""",
        re.IGNORECASE,
    ),
    # heatmap_column_names_gp = gpar(fontsize=X)
    re.compile(
        r"""heatmap_\w+_gp\s*=\s*gpar\s*\([^)]*fontsize\s*=\s*(?P<value>\d+(?:\.\d+)?)[^)]*\)""",
        re.IGNORECASE,
    ),
]


# ---------------------------------------------------------------------------
# Generic / DejaVu Sans font family detection
# ---------------------------------------------------------------------------

_RE_DEJAVU_SANS = re.compile(r"""['"]DejaVu\s*Sans['"]""", re.IGNORECASE)
_RE_GENERIC_SANS = re.compile(r"""['"]sans-serif['"]""", re.IGNORECASE)

# Matplotlib font.family setting that explicitly uses DejaVu Sans
_RE_MPL_FONT_FAMILY_DEJAVU = re.compile(
    r"""['"]font\.(?:family|sans-serif)['"]\s*:\s*\[?[^]]*['"]DejaVu\s*Sans['"]""",
    re.IGNORECASE,
)

# R base_family = "DejaVu Sans" or similar
_RE_R_FONT_FAMILY_DEJAVU = re.compile(
    r"""base_family\s*=\s*['"]DejaVu\s*Sans['"]""",
    re.IGNORECASE,
)

# R showtext font_add for non-Arial/Helvetica fonts
_RE_R_FONT_ADD = re.compile(
    r"""font_add\s*\(\s*['"](?P<font>[^'"]+)['"]""",
    re.IGNORECASE,
)

# Preferred font families
_ACCEPTABLE_FONTS = {"arial", "helvetica", "liberation sans", "sans-serif"}


def _parse_font_size(value_str):
    """Parse a font size string to float."""
    try:
        return float(value_str)
    except (ValueError, TypeError):
        return None


def _check_font_sizes(code):
    """Check all detected font sizes against the 5pt minimum."""
    messages = []
    all_patterns = (
        _RE_MATPLOTLIB_FONTSIZES
        + _RE_GGPLOT2_FONTSIZES
        + _RE_COMPLEXHEATMAP_FONTSIZES
    )

    found_any = False
    for pattern in all_patterns:
        for match in pattern.finditer(code):
            found_any = True
            value_str = match.group("value")
            size = _parse_font_size(value_str)
            if size is not None and size < MIN_FONT_SIZE:
                context = match.group(0).strip()
                # Truncate long contexts
                if len(context) > 80:
                    context = context[:77] + "..."
                messages.append(
                    f"  - Font size {size}pt is below {MIN_FONT_SIZE}pt minimum "
                    f"(found: {context})"
                )

    if not found_any:
        messages.append(
            "  - No explicit font size declarations found. "
            "Verify that all text will be >=5pt at print dimensions."
        )

    return messages


def _check_font_family(code):
    """Check for DejaVu Sans and generic font usage."""
    messages = []

    # Check matplotlib font family
    if _RE_MPL_FONT_FAMILY_DEJAVU.search(code):
        messages.append(
            "  - DejaVu Sans detected in matplotlib font.family. "
            "Use Arial, Helvetica, or Liberation Sans instead."
        )
    elif _RE_DEJAVU_SANS.search(code):
        messages.append(
            "  - DejaVu Sans font referenced. "
            "Preferred: Arial, Helvetica, or Liberation Sans."
        )

    # Check R font family
    if _RE_R_FONT_FAMILY_DEJAVU.search(code):
        messages.append(
            "  - DejaVu Sans used as R base_family. "
            "Use Arial, Helvetica, or Liberation Sans instead."
        )

    # Check for generic "sans-serif" without specifying a concrete font stack
    # This is a soft warning — sans-serif without a stack may fall back to DejaVu
    no_explicit_font = (
        not re.search(r"""['"]Arial['"]""", code, re.IGNORECASE)
        and not re.search(r"""['"]Helvetica['"]""", code, re.IGNORECASE)
        and not re.search(r"""['"]Liberation\s*Sans['"]""", code, re.IGNORECASE)
    )

    has_rcparams_font = _RE_GENERIC_SANS.search(code) or re.search(
        r"""font\.(?:family|sans-serif)""", code, re.IGNORECASE
    )

    if has_rcparams_font and no_explicit_font:
        messages.append(
            "  - Font family set to generic 'sans-serif' without an explicit "
            "Arial/Helvetica font stack. The system default (often DejaVu Sans) "
            "may be used. Add: font.sans-serif: ['Arial', 'Helvetica', 'Liberation Sans']"
        )

    return messages


def check(target, journal="nature-genetics"):
    """
    Check a figure target for font size and family compliance.

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
    name = "Font Size & Family"
    try:
        code = _resolve_target(target)
    except Exception as exc:
        return name, False, [f"  - ERROR: Could not read target: {exc}"]

    if not code.strip():
        return name, True, ["  - No code content to check."]

    messages = []
    messages += _check_font_sizes(code)
    messages += _check_font_family(code)

    # Count violations (messages that don't start with informational tone)
    violations = [m for m in messages if "No explicit" not in m]
    passed = len(violations) == 0

    return name, passed, messages


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Academic Figure Skill Font Size & Family Checker"
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
