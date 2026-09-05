#!/usr/bin/env python3
"""
Academic Figure Skill Color Compliance Checker.

Checks scientific figure code for default color palettes and red-green
accessibility issues. Supports Python (matplotlib/seaborn), R (ggplot2/
RColorBrewer), and inline hex declarations.

Usage:
    python check_colors.py <target>
    python check_colors.py <target> --journal nature-genetics

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
# Color palette patterns
# ---------------------------------------------------------------------------

# Matplotlib default palettes (tab10, tab20, tab20b, tab20c)
_RE_MATPLOTLIB_DEFAULTS = [
    (re.compile(r"""['"]tab10['"]"""), "matplotlib tab10 default palette"),
    (re.compile(r"""['"]tab20['"]"""), "matplotlib tab20 default palette"),
    (re.compile(r"""['"]tab20b['"]"""), "matplotlib tab20b default palette"),
    (re.compile(r"""['"]tab20c['"]"""), "matplotlib tab20c default palette"),
    (re.compile(r"""cmap\s*=\s*['"]tab10['"]""", re.IGNORECASE), "matplotlib tab10 colormap"),
    (re.compile(r"""cmap\s*=\s*['"]tab20['"]""", re.IGNORECASE), "matplotlib tab20 colormap"),
]

# Seaborn default palettes
_RE_SEABORN_DEFAULTS = [
    (re.compile(r"""palette\s*=\s*['"]deep['"]"""), "seaborn 'deep' default palette"),
    (re.compile(r"""palette\s*=\s*['"]muted['"]"""), "seaborn 'muted' default palette"),
    (re.compile(r"""palette\s*=\s*['"]pastel['"]"""), "seaborn 'pastel' default palette"),
    (re.compile(r"""palette\s*=\s*['"]bright['"]"""), "seaborn 'bright' default palette"),
    (re.compile(r"""palette\s*=\s*['"]dark['"]"""), "seaborn 'dark' default palette"),
    (re.compile(r"""palette\s*=\s*['"]colorblind['"]"""), "seaborn 'colorblind' default palette"),
    (re.compile(r"""sns\.set_palette\s*\(\s*['"]deep['"]\s*\)"""), "seaborn set_palette('deep') default"),
    (re.compile(r"""sns\.set_palette\s*\(\s*['"]muted['"]\s*\)"""), "seaborn set_palette('muted') default"),
    (re.compile(r"""sns\.color_palette\s*\(\s*['"]deep['"]\s*\)"""), "seaborn color_palette('deep') default"),
    (re.compile(r"""sns\.color_palette\s*\(\s*['"]muted['"]\s*\)"""), "seaborn color_palette('muted') default"),
]

# Jet / rainbow colormaps (all variants)
_RE_JET_RAINBOW = [
    (re.compile(r"""['"]jet['"]"""), "jet colormap (perceptually non-uniform)"),
    (re.compile(r"""cmap\s*=\s*['"]jet['"]""", re.IGNORECASE), "jet colormap via cmap="),
    (re.compile(r"""['"]rainbow['"]"""), "rainbow colormap (perceptually non-uniform)"),
    (re.compile(r"""cmap\s*=\s*['"]rainbow['"]""", re.IGNORECASE), "rainbow colormap via cmap="),
    (re.compile(r"""scale_fill_gradientn\s*\(\s*colours\s*=\s*rainbow"""), "R rainbow() gradient fill"),
    (re.compile(r"""scale_colour_gradientn\s*\(\s*colours\s*=\s*rainbow"""), "R rainbow() gradient colour"),
    (re.compile(r"""scale_color_gradientn\s*\(\s*colors\s*=\s*rainbow"""), "R rainbow() gradient color"),
    (re.compile(r"""col\s*=\s*rainbow\("""), "R rainbow() for point/line color"),
    (re.compile(r"""fill\s*=\s*rainbow\("""), "R rainbow() for fill color"),
]

# R ggplot2 default hue palette detection
_RE_GGPLOT2_DEFAULTS = [
    (re.compile(r"""scale_colour_hue\("""), "ggplot2 scale_colour_hue (default palette)"),
    (re.compile(r"""scale_color_hue\("""), "ggplot2 scale_color_hue (default palette)"),
    (re.compile(r"""scale_fill_hue\("""), "ggplot2 scale_fill_hue (default palette)"),
    (re.compile(r"""hue_pal\("""), "ggplot2 hue_pal (default palette)"),
]

# RColorBrewer qualitative palettes (Set1, Set2, Set3, Paired, Accent, Pastel1, Pastel2)
_RE_RCOLORBREWER = [
    (re.compile(r"""brewer\.pal\s*\(.*['"](Set1|Set2|Set3|Paired|Accent|Pastel1|Pastel2)['"]"""),
     r"RColorBrewer \1 qualitative palette (can look like defaults)"),
    (re.compile(r"""scale_fill_brewer\s*\(.*['"](Set1|Set2|Set3|Paired|Accent|Pastel1|Pastel2)['"]"""),
     r"ggplot2 scale_fill_brewer(\1)"),
    (re.compile(r"""scale_colour_brewer\s*\(.*['"](Set1|Set2|Set3|Paired|Accent|Pastel1|Pastel2)['"]"""),
     r"ggplot2 scale_colour_brewer(\1)"),
    (re.compile(r"""scale_color_brewer\s*\(.*['"](Set1|Set2|Set3|Paired|Accent|Pastel1|Pastel2)['"]"""),
     r"ggplot2 scale_color_brewer(\1)"),
]

# ---------------------------------------------------------------------------
# Red-green colorblind accessibility
# ---------------------------------------------------------------------------

# Detect red/green used exclusively as the only two colors in a palette list
_RE_RED_HEX = re.compile(r'#[89A-Ba-b][0-9A-Fa-f]{4}')  # hex in red range
_RE_GREEN_HEX = re.compile(r'#[0-9A-Fa-f]{2}[89A-Ba-b][0-9A-Fa-f]{2}')  # hex in green range

# Common red/green color names used together
_RE_RED_NAME = re.compile(r"""['"]#?(red|darkred|firebrick|crimson|indianred|lightcoral)['"]""", re.IGNORECASE)
_RE_GREEN_NAME = re.compile(r"""['"]#?(green|darkgreen|forestgreen|limegreen|seagreen|mediumseagreen)['"]""", re.IGNORECASE)

# Explicit "red" and "green" together in a color vector, palette, or list
_RE_RED_GREEN_PAIR = re.compile(
    r'(\[|\(|c\()\s*["\'](?:red|\#(?:FF0000|[89A-Ba-b][0-9A-Fa-f]{4}))["\'].*?'
    r'["\'](?:green|\#(?:00FF00|00[89A-Ba-b]00))["\'].*?(\]|\)|\))',
    re.IGNORECASE | re.DOTALL
)

# R's color brewer paired palette (alternating red/green by default)
_RE_PAIRED_PALETTE = re.compile(r"""brewer\.pal\s*\(.*['"]Paired['"]""")
_RE_DARK2_PALETTE = re.compile(r"""brewer\.pal\s*\(.*['"]Dark2['"]""")


def _check_default_palettes(code):
    """Return messages for detected default/inappropriate palettes."""
    messages = []
    checks = (
        _RE_MATPLOTLIB_DEFAULTS
        + _RE_SEABORN_DEFAULTS
        + _RE_JET_RAINBOW
        + _RE_GGPLOT2_DEFAULTS
        + _RE_RCOLORBREWER
    )
    for pattern, label in checks:
        matches = pattern.findall(code)
        for m in matches if isinstance(matches, list) and matches else ([label] if pattern.search(code) else []):
            if isinstance(m, tuple) and m:
                # RColorBrewer patterns with capturing groups
                msg = label
                for g in m:
                    if g:
                        msg = msg.replace(r"\1", g)
                messages.append(f"  - Default palette detected: {msg}")
            elif pattern.search(code):
                messages.append(f"  - Default palette detected: {label}")
    # Deduplicate
    seen = set()
    unique = []
    for m in messages:
        if m not in seen:
            seen.add(m)
            unique.append(m)
    return unique


def _check_red_green_only(code):
    """Detect red-green used as the only distinguishing color pair."""
    messages = []

    # Check for explicit "red" + "green" pairs in color assignments
    red_names = _RE_RED_NAME.findall(code)
    green_names = _RE_GREEN_NAME.findall(code)

    if red_names and green_names:
        # Check if they appear in the same color list/vector
        if _RE_RED_GREEN_PAIR.search(code):
            messages.append(
                "  - Red-green color pair used as sole distinguishing colors "
                "(inaccessible to ~8% of males with color blindness). "
                "Consider blue-orange or blue-purple instead."
            )

    # Check for paired palette
    if _RE_PAIRED_PALETTE.search(code):
        messages.append(
            "  - RColorBrewer 'Paired' palette alternates red/green by default. "
            "Consider 'Dark2' or custom hex codes instead."
        )

    return messages


def check(target, journal="nature-genetics"):
    """
    Check a figure target for color compliance issues.

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
    name = "Color Palette & Accessibility"
    try:
        code = _resolve_target(target)
    except Exception as exc:
        return name, False, [f"  - ERROR: Could not read target: {exc}"]

    if not code.strip():
        return name, True, ["  - No code content to check."]

    messages = []
    messages += _check_default_palettes(code)
    messages += _check_red_green_only(code)

    passed = len(messages) == 0
    if passed:
        messages.append("  - No default palettes or red-green issues detected.")

    return name, passed, messages


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Academic Figure Skill Color Compliance Checker"
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
