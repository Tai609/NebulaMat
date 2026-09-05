#!/usr/bin/env python3
"""
Academic Figure Skill Figure QA System -- Main Entry Point.

Orchestrates all compliance checks for scientific figures targeting CNS journals
(Nature/Cell/Science family). Automatically detects the target type and runs all
check modules, printing a structured PASS/FAIL report.

Checks performed:
  1. Color Palette & Accessibility    (check_colors.py)
  2. Font Size & Family               (check_fontsize.py)
  3. Figure Dimensions                (check_dimensions.py)
  4. Export Format & Resolution       (check_export.py)

Usage:
    python check_figure.py <figure_file_or_code> [--journal nature-genetics]
    python check_figure.py my_fig.py
    python check_figure.py my_fig.R --journal cell
    python check_figure.py "plt.savefig('out.pdf', dpi=300)" --journal science

Exit codes:
    0 -- All checks passed
    1 -- One or more checks failed
"""

import sys
import os
import argparse
import importlib
import traceback


# Ensure the scripts directory is on the path for module imports
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)


# ---------------------------------------------------------------------------
# Module registry -- all check modules must conform to:
#   check(target, journal) -> (name: str, passed: bool, messages: list[str])
# ---------------------------------------------------------------------------
CHECK_MODULES = [
    "check_colors",
    "check_fontsize",
    "check_dimensions",
    "check_export",
]


# ---------------------------------------------------------------------------
# Target type detection
# ---------------------------------------------------------------------------

def detect_target_type(target):
    """
    Detect the type of target.

    Returns one of: 'source_code', 'inline_code', 'unknown'
    """
    if os.path.isfile(target):
        ext = os.path.splitext(target)[1].lower()
        if ext in (".py", ".r", ".R", ".rmd", ".Rmd", ".qmd"):
            return "source_code"
        elif ext in (".pdf", ".svg", ".eps", ".png", ".tiff", ".tif", ".jpg", ".jpeg"):
            return "raster_output"
        else:
            return "source_code"  # treat unknown text files as source
    else:
        # Not a file path -- treat as inline code
        return "inline_code"


# ---------------------------------------------------------------------------
# Main check orchestration
# ---------------------------------------------------------------------------

def run_all_checks(target, journal="nature-genetics", modules=None):
    """
    Run all registered check modules against the target.

    Parameters
    ----------
    target : str
        File path or inline code string.
    journal : str
        Target journal identifier.
    modules : list or None
        List of module names to run. If None, runs all CHECK_MODULES.

    Returns
    -------
    list of (module_name, passed, messages) tuples
    """
    if modules is None:
        modules = CHECK_MODULES
    results = []

    for module_name in modules:
        try:
            mod = importlib.import_module(module_name)
            name, passed, messages = mod.check(target, journal=journal)
            results.append((name, passed, messages))
        except ImportError as exc:
            results.append((
                module_name,
                False,
                [f"  - ERROR: Could not import {module_name}: {exc}"]
            ))
        except AttributeError:
            results.append((
                module_name,
                False,
                [f"  - ERROR: {module_name} does not expose a check() function"]
            ))
        except Exception:
            tb = traceback.format_exc()
            results.append((
                module_name,
                False,
                [f"  - ERROR: {module_name} raised an exception:\n{tb}"]
            ))

    return results


def print_report(results, target, journal, target_type):
    """Print a structured PASS/FAIL report to stdout."""
    total = len(results)
    passed_count = sum(1 for _, p, _ in results if p)
    failed_count = total - passed_count

    print()
    print("=" * 68)
    print("  Academic Figure Skill Figure QA Report")
    print("=" * 68)
    print(f"  Target      : {target}")
    print(f"  Target type : {target_type}")
    print(f"  Journal     : {journal}")
    print(f"  Modules run : {total}")
    print(f"  Passed      : {passed_count}")
    print(f"  Failed      : {failed_count}")
    print("-" * 68)

    for name, passed, messages in results:
        status = "PASS" if passed else "FAIL"
        marker = "[OK]" if passed else "[!!]"
        print(f"\n  {marker} {status} -- {name}")
        for msg in messages:
            print(msg)

    print()
    print("-" * 68)
    if failed_count == 0:
        print("  OVERALL: ALL CHECKS PASSED")
    else:
        print(f"  OVERALL: {failed_count} CHECK(S) FAILED -- review above")
    print("=" * 68)
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Academic Figure Skill Figure QA System -- Validate figures for CNS journal compliance.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python check_figure.py figure_code.py
  python check_figure.py figure_code.R --journal cell
  python check_figure.py "plt.savefig('out.pdf', dpi=72)"
  python check_figure.py /path/to/figure_generator.py --journal science
  python check_figure.py --list-modules
        """,
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="File path to figure code, or inline code string.",
    )
    parser.add_argument(
        "--journal",
        default="nature-genetics",
        help="Target journal (default: nature-genetics). Options: nature-genetics, nature, cell, science",
    )
    parser.add_argument(
        "--list-modules",
        action="store_true",
        help="List all available check modules and exit.",
    )
    parser.add_argument(
        "--module",
        action="append",
        dest="modules",
        help="Run only the specified module(s). Can be repeated. Use module name without .py extension.",
    )

    args = parser.parse_args()

    # --list-modules
    if args.list_modules:
        print("\nAvailable check modules:")
        for m in CHECK_MODULES:
            print(f"  - {m}")
        print()
        sys.exit(0)

    # Require a target
    if not args.target:
        parser.print_help()
        print("\nError: target argument is required.\n")
        sys.exit(2)

    # Determine which modules to run
    if args.modules:
        # Validate module names
        invalid = [m for m in args.modules if m not in CHECK_MODULES]
        if invalid:
            print(f"\nError: Unknown module(s): {', '.join(invalid)}")
            print(f"Available modules: {', '.join(CHECK_MODULES)}\n")
            sys.exit(2)
        modules_to_run = args.modules
    else:
        modules_to_run = list(CHECK_MODULES)

    target = args.target
    journal = args.journal

    # Detect target type
    target_type = detect_target_type(target)

    # Run all checks
    results = run_all_checks(target, journal=journal, modules=modules_to_run)

    # Print report
    print_report(results, target, journal, target_type)

    # Exit code: 0 if all pass, 1 if any fail
    all_pass = all(p for _, p, _ in results)
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
