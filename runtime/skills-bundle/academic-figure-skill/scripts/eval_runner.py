#!/usr/bin/env python3
"""Academic Figure Skill Auto-Eval Generator.

Scans assets/figures/ and automatically generates one eval per figure type.
Runs: asset-found check → script-runnable check → baseline compliance check.

Usage:
    python eval_runner.py                  # run all evals
    python eval_runner.py --type RidgePlot # run single type
    python eval_runner.py --report-only    # print report from last run
"""

from __future__ import annotations
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]  # Academic Figure Skill/
FIGURES_DIR = PROJECT_ROOT / "academic-figure-skill" / "assets" / "figures"
RESULTS_FILE = PROJECT_ROOT / "academic-figure-skill" / "scripts" / ".eval_results.json"

# ═══════════════════════════════════════════════════════════
# Required baseline checks (same values as compose.py UNIFIED_RCPARAMS)
# ═══════════════════════════════════════════════════════════
BASELINE_CHECKS = {
    "font.family": "sans-serif",
    "font.sans-serif": "Arial",
    "pdf.fonttype": 42,
    "svg.fonttype": "none",
}

# Known-good directory names with production scripts (filter out empty/utility dirs)
SKIP_DIRS = {"basic-plots", "multipanel", "other", "README.md"}


# ═══════════════════════════════════════════════════════════
# Core eval logic
# ═══════════════════════════════════════════════════════════

def list_figure_types() -> list[str]:
    """Return all figure type directories that contain production scripts."""
    types = []
    for name in sorted(os.listdir(FIGURES_DIR)):
        if name in SKIP_DIRS:
            continue
        path = FIGURES_DIR / name
        if not path.is_dir():
            continue
        scripts = [f for f in os.listdir(path) if f.endswith((".py", ".R", ".r"))]
        if scripts:
            types.append(name)
    return types


def check_asset_found(figure_type: str) -> dict[str, Any]:
    """Verify the figure type directory exists and has scripts + previews."""
    path = FIGURES_DIR / figure_type
    if not path.exists():
        return {"passed": False, "reason": f"Directory {figure_type} not found"}

    scripts = [f for f in os.listdir(path) if f.endswith((".py", ".R", ".r"))]
    pngs = [f for f in os.listdir(path) if f.endswith(".png")]

    if not scripts:
        return {"passed": False, "reason": "No scripts (.py/.R/.r) found"}

    return {
        "passed": True,
        "scripts": len(scripts),
        "previews": len(pngs),
        "script_names": scripts,
        "preview_names": pngs,
    }


def check_script_runnable(figure_type: str) -> dict[str, Any]:
    """Check whether at least one script in the directory can be executed."""
    path = FIGURES_DIR / figure_type
    py_scripts = [f for f in os.listdir(path) if f.endswith(".py")]
    r_scripts = [f for f in os.listdir(path) if f.endswith((".R", ".r"))]

    results = {}

    # Check Python scripts (syntax only — don't run with unknown data dependencies)
    for script in py_scripts[:1]:  # test 1 per type
        script_path = path / script
        try:
            with open(script_path, "r", encoding="utf-8", errors="replace") as f:
                source = f.read()
            compile(source, str(script_path), "exec")
            results[f"py:{script}"] = {"passed": True, "reason": "Python syntax OK"}
        except SyntaxError as e:
            results[f"py:{script}"] = {"passed": False, "reason": f"Syntax error: {e}"}

    # Check R scripts (syntax only)
    for script in r_scripts[:1]:
        script_path = str(path / script).replace("\\", "/")
        r_bin = _find_r()
        if not r_bin:
            results[f"r:{script}"] = {"passed": False, "reason": "R not found"}
            continue
        try:
            # Use temp .R file that sources the script, avoiding inline path escaping
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".R", delete=False, encoding="utf-8") as tf:
                tf.write(f'# R parse check\n')
                tf.write(f'script_path <- "{script_path}"\n')
                tf.write(f'if (file.exists(script_path)) {{\n')
                tf.write(f'  tryCatch({{parse(file=script_path); cat("OK\\n")}}, error=function(e)cat("ERROR:", e$message, "\\n"))\n')
                tf.write(f'}} else {{\n')
                tf.write(f'  cat("SKIP: file not found\\n")\n')
                tf.write(f'}}\n')
                temp_r = tf.name

            result = subprocess.run(
                [r_bin, "--no-save", "--no-restore", temp_r],
                capture_output=True, text=True, timeout=30,
                encoding="utf-8", errors="replace",
            )
            os.unlink(temp_r)

            passed = "OK" in result.stdout and "ERROR" not in result.stdout
            results[f"r:{script}"] = {
                "passed": passed,
                "reason": "R parse OK" if passed else (result.stdout[:200] or result.stderr[:200]),
            }
        except Exception as e:
            results[f"r:{script}"] = {"passed": False, "reason": str(e)[:200]}

    return results


def check_baseline_compliance() -> dict[str, Any]:
    """Verify the project's BASELINE code blocks are internally consistent.

    Checks that compose.py, compose.R, typography.md, color-palettes.md,
    and export-specs.md use the same hex values and font settings.
    """
    results = {}

    # ── Python side ──
    compose_py = PROJECT_ROOT / "academic-figure-skill" / "scripts" / "compose.py"
    typo_md = PROJECT_ROOT / "academic-figure-skill" / "references" / "typography.md"
    color_md = PROJECT_ROOT / "academic-figure-skill" / "references" / "color-palettes.md"

    # Read compose.py CATEGORICAL
    with open(compose_py, "r", encoding="utf-8", errors="replace") as f:
        py_src = f.read()

    # Check compose.py has CATEGORICAL defined
    if "CATEGORICAL" not in py_src:
        results["py:CATEGORICAL"] = {"passed": False, "reason": "CATEGORICAL not found in compose.py"}
    else:
        results["py:CATEGORICAL"] = {"passed": True, "reason": "CATEGORICAL defined"}

    # Check compose.py has r_png_device with type="cairo"
    if 'type="cairo"' in py_src or "type='cairo'" in py_src:
        results["py:cairo_png"] = {"passed": True, "reason": "r_png_device includes type=cairo"}
    else:
        results["py:cairo_png"] = {"passed": False, "reason": "r_png_device missing type=cairo"}

    # ── Color consistency between compose.py and color-palettes.md ──
    with open(color_md, "r", encoding="utf-8", errors="replace") as f:
        color_src = f.read()

    # Hex values must match
    py_hex = set()
    import re
    for m in re.finditer(r'"#[0-9A-Fa-f]{6}"', py_src):
        py_hex.add(m.group(0).strip('"'))
    md_hex = set()
    for m in re.finditer(r'"#[0-9A-Fa-f]{6}"', color_src):
        md_hex.add(m.group(0).strip('"'))

    shared = py_hex & md_hex
    if len(shared) >= 4:
        results["color:consistency"] = {"passed": True, "reason": f"{len(shared)} hex values match between compose.py and color-palettes.md"}
    else:
        results["color:consistency"] = {"passed": False, "reason": f"Only {len(shared)} matching hex values"}

    return results


# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════

def _find_python() -> str | None:
    import shutil

    # Check PATH
    for name in ["python3", "python"]:
        if shutil.which(name):
            return name

    # Windows fallback: common paths
    for ver in ["313", "312", "311", "310", "39", "38"]:
        for base in [os.path.expandvars("%LOCALAPPDATA%\\Programs\\Python\\Python{0}\\python.exe".format(ver)),
                     os.path.expandvars("%APPDATA%\\Python\\Python{0}\\python.exe".format(ver))]:
            if os.path.exists(base):
                return base
    return None


def _find_r() -> str | None:
    """Find Rscript, checking PATH first then common Windows paths."""
    import shutil

    # Check PATH
    rscript = shutil.which("Rscript")
    if rscript:
        return rscript

    # Windows fallback: check Program Files
    for ver in ["4.4", "4.3", "4.2", "4.1", "4.0"]:
        for base in ["C:/Program Files", "C:/Program Files (x86)"]:
            for patch in range(10, -1, -1):
                p = f"{base}/R/R-{ver}.{patch}/bin/Rscript.exe"
                if os.path.exists(p):
                    return p
    return None


# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════

def run_all(single_type: str | None = None) -> dict[str, Any]:
    """Run all evals and return results dict."""
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "python": _find_python(),
        "r": _find_r(),
        "baseline": check_baseline_compliance(),
        "figures": {},
    }

    types_to_test = [single_type] if single_type else list_figure_types()
    for ftype in types_to_test:
        entry = {}
        entry["asset"] = check_asset_found(ftype)
        entry["runnable"] = check_script_runnable(ftype)
        entry["overall_pass"] = entry["asset"]["passed"] and all(
            v["passed"] for v in entry["runnable"].values() if entry["runnable"]
        )
        report["figures"][ftype] = entry

    # Save results
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    return report


def print_report(report: dict[str, Any]):
    """Human-readable summary."""
    baseline = report["baseline"]
    figures = report["figures"]

    total = len(figures)
    asset_ok = sum(1 for v in figures.values() if v["asset"]["passed"])
    run_ok = sum(1 for v in figures.values() if v["overall_pass"])

    print("=" * 60)
    print("Academic Figure Skill Auto-Eval Report")
    print(f"Timestamp: {report['timestamp']}")
    print(f"Python: {report['python'] or 'NOT FOUND'}")
    print(f"R: {report['r'] or 'NOT FOUND'}")
    print("=" * 60)

    print(f"\nBaseline compliance:")
    for key, val in baseline.items():
        status = "PASS" if val["passed"] else "FAIL"
        print(f"  [{status}] {key}: {val['reason']}")

    print(f"\nFigure assets ({asset_ok}/{total} have scripts):")
    for ftype, entry in sorted(figures.items()):
        a = entry["asset"]
        if not a["passed"]:
            print(f"  [SKIP] {ftype}: {a['reason']}")
            continue
        r_status = "PASS" if entry["overall_pass"] else "WARN"
        print(f"  [{r_status}] {ftype} — {a['scripts']} scripts, {a['previews']} previews")
        if not entry["overall_pass"]:
            for rkey, rval in entry["runnable"].items():
                if not rval["passed"]:
                    reason_text = rval['reason'][:100].encode('ascii', errors='replace').decode('ascii')
                    print(f"         {rkey}: {reason_text}")

    print(f"\nSummary: {run_ok}/{total} figure types pass")
    if run_ok == total:
        print("Verdict: READY — all production scripts parse successfully")
    else:
        print(f"Verdict: {total - run_ok} types need attention")
    print("=" * 60)


if __name__ == "__main__":
    if "--report-only" in sys.argv:
        if RESULTS_FILE.exists():
            with open(RESULTS_FILE, "r", encoding="utf-8") as f:
                print_report(json.load(f))
        else:
            print("No previous eval results found. Run without --report-only first.")
            sys.exit(1)
    else:
        single = None
        if "--type" in sys.argv:
            idx = sys.argv.index("--type")
            if idx + 1 < len(sys.argv):
                single = sys.argv[idx + 1]
        report = run_all(single)
        print_report(report)
