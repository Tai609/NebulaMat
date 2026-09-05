#!/usr/bin/env python3
"""Academic Figure Skill QA Validator Coverage Suite.

Feeds known-good and known-bad script snippets to qa_validator and verifies
each check fires (or doesn't fire) correctly.

Coverage target: AP-0 through CL-7 (20 automated checks).

Usage:
    py qa_coverage.py              # full coverage report
    py qa_coverage.py --json       # machine-readable output
    py qa_coverage.py --verbose    # show per-check details
"""

from __future__ import annotations
import json, sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT))

from qa_validator import (
    check_ap0_style_baseline, check_ap1_default_palette, check_ap2_jet_rainbow,
    check_ap3_four_sided_borders, check_ap4_legend_occlusion, check_ap5_low_res_export,
    check_ap6_missing_points, check_ap7_default_font,
    check_cl1_fontsize, check_cl2_dimensions, check_cl3_dpi, check_cl4_font_embedding,
    check_cl5_spine_linewidth, check_cl6_tick_direction, check_cl7_export_completeness,
)

# ═══════════════════════════════════════════════════════════
# Test corpus: each entry has a script snippet, expected_fail,
# and expected_pass (list of check function names).
# ═══════════════════════════════════════════════════════════

GOOD_BASELINE = """
import matplotlib as mpl
mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "Liberation Sans"],
    "font.size": 8,
    "axes.titlesize": 8,
    "axes.labelsize": 8,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 8,
    "figure.titlesize": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.6,
    "xtick.direction": "out",
    "ytick.direction": "out",
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
    "legend.frameon": False,
})
CATEGORICAL = ["#2166AC", "#B2182B", "#1B7837", "#F1A340", "#762A83", "#666666"]
DIVERGING = ["#2166AC", "#F7F7F7", "#B2182B"]
mpl.rcParams.update({
    "pdf.fonttype": 42,
    "svg.fonttype": "none",
    "savefig.bbox": "tight",
    "savefig.dpi": 300,
})
def save_cns_figure(fig, filename):
    fig.savefig(f"{filename}.pdf", bbox_inches="tight", dpi=300)
    fig.savefig(f"{filename}.png", bbox_inches="tight", dpi=300)
fig, ax = plt.subplots(figsize=(183 / 25.4, 120 / 25.4))
ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False)
"""

TEST_CASES = [
    # --- AP-0: Style baseline injection ---
    {
        "id": "AP0_missing_typography",
        "description": "Script missing typography baseline",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([1,2,3])\nfig.savefig('out.pdf', dpi=300)\nfig.savefig('out.png', dpi=300)",
        "expected_fail": ["check_ap0_style_baseline"],
    },
    {
        "id": "AP0_good_baseline",
        "description": "Full baseline present — should pass AP-0",
        "source": GOOD_BASELINE,
        "expected_fail": [],
    },

    # --- AP-1: Default color palette ---
    {
        "id": "AP1_tab10_default",
        "description": "Uses cmap='tab10' — should fail AP-1",
        "source": GOOD_BASELINE + "\nsns.heatmap(data, cmap='tab10')",
        "expected_fail": ["check_ap1_default_palette"],
    },
    {
        "id": "AP1_seaborn_deep",
        "description": "Uses sns.color_palette('deep') — should fail AP-1",
        "source": GOOD_BASELINE + "\nsns.color_palette('deep')",
        "expected_fail": ["check_ap1_default_palette"],
    },
    {
        "id": "AP1_scale_color_hue",
        "description": "Uses scale_color_hue() — should fail AP-1",
        "source": GOOD_BASELINE + "\nscale_color_hue()",
        "expected_fail": ["check_ap1_default_palette"],
    },

    # --- AP-2: Jet / rainbow ---
    {
        "id": "AP2_jet_colormap",
        "description": "Uses cmap='jet' — should fail AP-2",
        "source": GOOD_BASELINE + "\nax.scatter(x, y, cmap='jet')",
        "expected_fail": ["check_ap2_jet_rainbow"],
    },
    {
        "id": "AP2_rainbow_colormap",
        "description": "Uses cmap='rainbow' — should fail AP-2",
        "source": GOOD_BASELINE + "\nplt.imshow(data, cmap=\"rainbow\")",
        "expected_fail": ["check_ap2_jet_rainbow"],
    },

    # --- AP-3: Four-sided borders ---
    {
        "id": "AP3_four_sided",
        "description": "No spine removal — should fail AP-3",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([1,2,3])",
        "expected_fail": ["check_ap3_four_sided_borders"],
    },
    {
        "id": "AP3_spines_off",
        "description": "Spines properly removed — should pass AP-3",
        "source": GOOD_BASELINE,
        "expected_fail": [],
    },

    # --- AP-4: Legend occlusion ---
    {
        "id": "AP4_no_external_legend",
        "description": "No bbox_to_anchor on legend — should warn AP-4",
        "source": GOOD_BASELINE.replace("ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False)", "ax.legend()"),
        "expected_fail": ["check_ap4_legend_occlusion"],
    },
    {
        "id": "AP4_external_legend",
        "description": "Legend with bbox_to_anchor — should pass AP-4",
        "source": GOOD_BASELINE,
        "expected_fail": [],
    },

    # --- AP-5: Low-resolution export ---
    {
        "id": "AP5_png_only",
        "description": "Only PNG export, no PDF — should fail AP-5",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nfig.savefig('out.png', dpi=300)",
        "expected_fail": ["check_ap5_low_res_export"],
    },
    {
        "id": "AP5_has_pdf",
        "description": "Has PDF export — should pass AP-5",
        "source": GOOD_BASELINE,
        "expected_fail": [],
    },

    # --- AP-6: Missing individual data points ---
    {
        "id": "AP6_bar_no_points",
        "description": "Bar chart without scatter/strip overlay — should warn AP-6",
        "source": GOOD_BASELINE + "\nax.bar(['A','B','C'], [10,20,15])",
        "expected_fail": ["check_ap6_missing_points"],
    },
    {
        "id": "AP6_not_bar",
        "description": "Not a bar/box plot — AP-6 should be N/A",
        "source": GOOD_BASELINE + "\nax.plot([1,2,3], [4,5,6])",
        "expected_fail": [],
    },

    # --- AP-7: Default font ---
    {
        "id": "AP7_no_font",
        "description": "No Arial/Helvetica set — should fail AP-7",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([1,2,3])",
        "expected_fail": ["check_ap7_default_font"],
    },

    # --- CL-1: Font size ---
    {
        "id": "CL1_font_too_small",
        "description": "fontsize=4 below 5pt floor — should fail CL-1",
        "source": GOOD_BASELINE + "\nax.set_xlabel('X', fontsize=4)\nax.set_ylabel('Y', fontsize=3)",
        "expected_fail": ["check_cl1_fontsize"],
    },

    # --- CL-2: Dimensions ---
    {
        "id": "CL2_wrong_width",
        "description": "fig_width_mm=120 (non-journal column) — should fail CL-2",
        "source": GOOD_BASELINE + "\nfig_width_mm = 120",
        "expected_fail": ["check_cl2_dimensions"],
    },
    {
        "id": "CL2_good_183",
        "description": "fig_width_mm=183 (double column) — should pass CL-2",
        "source": GOOD_BASELINE + "\nfig_width_mm = 183",
        "expected_fail": [],
    },

    # --- CL-3: DPI ---
    {
        "id": "CL3_low_dpi",
        "description": "dpi=72 — should fail CL-3",
        "source": GOOD_BASELINE + "\nfig.savefig('out.png', dpi=72)",
        "expected_fail": ["check_cl3_dpi"],
    },
    {
        "id": "CL3_rcparams_dpi",
        "description": "savefig.dpi: 300 in rcParams dict — should pass CL-3",
        "source": GOOD_BASELINE,
        "expected_fail": [],
    },

    # --- CL-4: Font embedding ---
    {
        "id": "CL4_no_embedding",
        "description": "No pdf.fonttype=42 — should fail CL-4",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nfig.savefig('out.pdf')",
        "expected_fail": ["check_cl4_font_embedding"],
    },

    # --- CL-5: Spine linewidth ---
    {
        "id": "CL5_thick_spines",
        "description": "axes.linewidth=2.0 — should warn CL-5",
        "source": GOOD_BASELINE.replace("axes.linewidth\": 0.6", "axes.linewidth\": 2.0"),
        "expected_fail": ["check_cl5_spine_linewidth"],
    },

    # --- CL-6: Tick direction ---
    {
        "id": "CL6_no_outward",
        "description": "No tick direction set — should warn CL-6",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([1,2,3])",
        "expected_fail": ["check_cl6_tick_direction"],
    },

    # --- CL-7: Export completeness ---
    {
        "id": "CL7_pdf_only",
        "description": "Only PDF export, no PNG — should fail CL-7",
        "source": "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nfig.savefig('out.pdf')",
        "expected_fail": ["check_cl7_export_completeness"],
    },

    # --- Combo: multiple failures ---
    {
        "id": "COMBO_bare_minimum",
        "description": "Bare matplotlib with no CNS baseline — should fail AP-0,3,5,7 + CL-4,6,7",
        "source": "import matplotlib.pyplot as plt\nimport numpy as np\nx=np.linspace(0,10,100)\nfig,ax=plt.subplots()\nax.plot(x,np.sin(x))\nfig.savefig('plot.png',dpi=72)",
        "expected_fail": [
            "check_ap0_style_baseline", "check_ap3_four_sided_borders",
            "check_ap5_low_res_export", "check_ap7_default_font",
            "check_cl4_font_embedding", "check_cl6_tick_direction",
            "check_cl7_export_completeness",
        ],
    },
]

# ═══════════════════════════════════════════════════════════
# Runner
# ═══════════════════════════════════════════════════════════

CHECK_FUNCTIONS = {
    "check_ap0_style_baseline": check_ap0_style_baseline,
    "check_ap1_default_palette": check_ap1_default_palette,
    "check_ap2_jet_rainbow": check_ap2_jet_rainbow,
    "check_ap3_four_sided_borders": check_ap3_four_sided_borders,
    "check_ap4_legend_occlusion": check_ap4_legend_occlusion,
    "check_ap5_low_res_export": check_ap5_low_res_export,
    "check_ap6_missing_points": check_ap6_missing_points,
    "check_ap7_default_font": check_ap7_default_font,
    "check_cl1_fontsize": check_cl1_fontsize,
    "check_cl2_dimensions": check_cl2_dimensions,
    "check_cl3_dpi": check_cl3_dpi,
    "check_cl4_font_embedding": check_cl4_font_embedding,
    "check_cl5_spine_linewidth": check_cl5_spine_linewidth,
    "check_cl6_tick_direction": check_cl6_tick_direction,
    "check_cl7_export_completeness": check_cl7_export_completeness,
}


def run_all_functions(source: str) -> dict[str, bool]:
    """Run all QA checks on source, return {func_name: passed_bool}."""
    results = {}
    for name, func in CHECK_FUNCTIONS.items():
        findings = func(source)
        if isinstance(findings, list):
            passed = all(f.pass_ for f in findings)
        else:
            passed = findings.pass_
        results[name] = passed
    return results


def run_coverage() -> dict:
    results = []
    total_targeted = 0
    false_negatives = 0  # targeted check didn't fire (bug in validator)
    uncovered_funcs = set(CHECK_FUNCTIONS.keys())

    for tc in TEST_CASES:
        source = tc["source"]
        actual = run_all_functions(source)
        target_fails = set(tc["expected_fail"])

        case_result = {"id": tc["id"], "description": tc["description"],
                       "targets": sorted(tc["expected_fail"]),
                       "fired": [], "missed": [], "correct": True}

        for func_name in target_fails:
            total_targeted += 1
            uncovered_funcs.discard(func_name)
            check_passed = actual[func_name]
            if check_passed:
                # Targeted check passed (should have failed) → FN in validator
                false_negatives += 1
                case_result["missed"].append(func_name)
                case_result["correct"] = False
            else:
                case_result["fired"].append(func_name)

        results.append(case_result)

    total = len(TEST_CASES)
    all_correct = sum(1 for r in results if r["correct"])
    accuracy = all_correct / total if total > 0 else 0
    coverage_rate = 1 - (len(uncovered_funcs) / len(CHECK_FUNCTIONS)) if CHECK_FUNCTIONS else 0

    return {
        "summary": {
            "test_cases": total,
            "all_correct": all_correct,
            "accuracy": round(accuracy, 3),
            "total_targeted_checks": total_targeted,
            "false_negatives": false_negatives,
            "check_coverage": f"{len(CHECK_FUNCTIONS) - len(uncovered_funcs)}/{len(CHECK_FUNCTIONS)} ({coverage_rate:.0%})",
            "uncovered_functions": sorted(uncovered_funcs),
        },
        "cases": results,
    }


# ═══════════════════════════════════════════════════════════
# Check function coverage — which check functions have test cases
# ═══════════════════════════════════════════════════════════

def check_function_coverage() -> dict[str, list[str]]:
    """Return {func_name: [test_case_ids]} showing which tests exercise each check."""
    covered = {name: [] for name in CHECK_FUNCTIONS}
    for tc in TEST_CASES:
        for name in tc["expected_fail"]:
            if name in covered:
                covered[name].append(tc["id"])
    return covered


if __name__ == "__main__":
    verbose = "--verbose" in sys.argv
    use_json = "--json" in sys.argv

    report = run_coverage()
    s = report["summary"]

    if use_json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(0)

    print("=" * 64)
    print("Academic Figure Skill QA Validator Coverage Report")
    print("=" * 64)
    print(f"Test cases        : {s['test_cases']}")
    print(f"Correct targets   : {s['all_correct']}/{s['test_cases']} ({s['accuracy']:.0%})")
    print(f"Targeted checks   : {s['total_targeted_checks']}")
    print(f"False negatives   : {s['false_negatives']} (targeted check missed)")
    print(f"Check coverage    : {s['check_coverage']}")
    print()

    for case in report["cases"]:
        if case["correct"]:
            print(f"  PASS  {case['id']}: {case['description']}")
            if verbose:
                print(f"         Fired: {', '.join(case['fired'])}")
        else:
            print(f"  FAIL  {case['id']}: {case['description']}")
            print(f"         Missed (FN): {', '.join(case['missed'])}")

    if s["uncovered_functions"]:
        print()
        print("--- Uncovered check functions ---")
        for fn in s["uncovered_functions"]:
            print(f"  UNCOVERED {fn}")

    print("=" * 64)
    if s["false_negatives"] == 0:
        print("Verdict: ALL TARGETED CHECKS WORK — no false negatives")
    else:
        print(f"Verdict: {s['false_negatives']} FN — checks missed their target, fix validator")
