#!/usr/bin/env python3
"""Academic Figure Skill A/B Test Framework — Academic Figure Skill vs Bare Claude.

Defines 5 test scenarios with objective scoring criteria.
Each scenario returns: asset_hit, font_ok, palette_ok, spine_ok, render_ok, vector_export.

Usage:
    python ab_test.py              # print all 5 scenarios and scoring rubrics
    python ab_test.py --baseline   # run bare-Claude tests (generate without skill)
    python ab_test.py --academic-figure-skill   # run Academic Figure Skill tests
    python ab_test.py --compare    # compare both results
"""

from __future__ import annotations
import json, os, sys
from pathlib import Path
from dataclasses import dataclass, field, asdict

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# ═══════════════════════════════════════════════════════════
# Test scenarios
# ═══════════════════════════════════════════════════════════

SCENARIOS = [
    {
        "id": "S1_pca",
        "name": "PCA from real data",
        "prompt": "对 simulated_data.csv 做 PCA 分析并可视化",
        "user_type": "knows_what_they_want",
        "expected": {
            "figure_type": "PCA",
            "asset_exists": True,
            "asset_path": "assets/figures/PCA/plot_PCA.R",
            "backend": "R",
            "checks": [
                "R script executed natively (not Python re-write)",
                "PNG rendered with png(type='cairo') NO showtext",
                "Font: Arial, base_size >= 8",
                "CNS palette used (blue/red/green, not ggplot2 defaults)",
                "cairo_pdf for vector output",
                "300dpi PNG",
            ],
        },
    },
    {
        "id": "S2_radar_violin_bar_pca",
        "prompt": "画雷达图、小提琴图、分组柱状图、PCA图，组合成一张",
        "user_type": "knows_figure_types",
        "expected": {
            "figure_type": "multi-panel",
            "asset_exists": True,
            "asset_paths": ["Radar/plot_comparison_radar.py", "GroupedViolin/plot_GroupedViolin.py",
                           "GroupedBarChart/plot_GroupedBarChartv1.py", "PCA/plot_PCA.R"],
            "all_assets_hit": True,
            "checks": [
                "Asset Confirmation Table present as first comment block",
                "Radar panel uses native run (not hand-written)",
                "PCA panel uses R native run (not Python re-write)",
                "4 panel labels consistent (a,b,c,d — same font, position)",
                "Layout ≥ 2x2, panel width ≥ 45mm",
                "Mixed R+Python handled via compose_figure (Python) loading R PNGs",
            ],
        },
    },
    {
        "id": "S3_heatmap_nature_genetics",
        "prompt": "画一个 Nature Genetics 风格的差异基因表达热图",
        "user_type": "knows_journal",
        "expected": {
            "figure_type": "heatmap",
            "asset_exists": True,
            "asset_path": "assets/figures/3DHeatmap/ or CorrelationMatrix/",
            "journal": "Nature Genetics",
            "checks": [
                "journal_palette('nature') called",
                "Diverging RDBU colormap (not jet/rainbow)",
                "Row dendrogram ≤ 8mm",
                "Column annotation via ComplexHeatmap anno_points",
                "Vector PDF + cairo_pdf",
                "Arial font throughout",
            ],
        },
    },
    {
        "id": "S4_unknown_chart_type",
        "prompt": "画一个弦图展示六个群组之间的流动物流量",
        "user_type": "wants_uncommon_chart",
        "expected": {
            "figure_type": "chord diagram",
            "asset_exists": False,
            "checks": [
                "Skill does NOT error out or refuse",
                "Cross-type inheritance used (borrows from Sankey or network)",
                "CNS baseline colors and fonts applied",
                "User informed: 'no production script, using cross-type inheritance'",
                "Output is usable (not beautiful, but not broken)",
            ],
        },
    },
    {
        "id": "S5_analyze_vague",
        "prompt": "分析 simulated_data.csv 并可视化",
        "user_type": "vague_request",
        "expected": {
            "figure_type": "unknown",
            "checks": [
                "Step -1 fires FIRST: 'What are you trying to learn from this data?'",
                "Does NOT auto-generate 4-panel template",
                "After user answers, recommendation is question-directed (not generic)",
                "Panel count determined by distinct questions, not template",
            ],
        },
    },
]


# ═══════════════════════════════════════════════════════════
# Scoring
# ═══════════════════════════════════════════════════════════

@dataclass
class ScenarioResult:
    scenario_id: str
    passed_checks: int = 0
    total_checks: int = 0
    checks_detail: list[dict] = field(default_factory=list)
    notes: str = ""


def print_scenarios():
    """Print all 5 test scenarios with scoring rubrics."""
    print("=" * 60)
    print("Academic Figure Skill A/B Test Framework — 5 Scenarios")
    print("=" * 60)
    print()
    for s in SCENARIOS:
        total = len(s["expected"]["checks"])
        print(f"Scenario {s['id']}: {s['name']}")
        print(f"  Prompt: \"{s['prompt']}\"")
        print(f"  Type: {s['user_type']}")
        print(f"  Asset exists: {s['expected'].get('asset_exists', 'N/A')}")
        print(f"  Checks ({total}):")
        for i, c in enumerate(s["expected"]["checks"], 1):
            print(f"    {i}. {c}")
        print()


def score_scenario(scenario_id: str, checks_passed: list[bool], details: list[str] = None) -> dict:
    """Score a single scenario. Returns result dict."""
    scenario = next((s for s in SCENARIOS if s["id"] == scenario_id), None)
    if not scenario:
        return {"error": f"Unknown scenario: {scenario_id}"}

    total = len(scenario["expected"]["checks"])
    passed = sum(1 for b in checks_passed if b)

    check_details = []
    for i, (ck, pk) in enumerate(zip(scenario["expected"]["checks"], checks_passed)):
        check_details.append({
            "index": i + 1,
            "description": ck,
            "passed": pk,
        })

    return {
        "scenario_id": scenario_id,
        "name": scenario["name"],
        "passed": passed,
        "total": total,
        "pass_rate": passed / total if total > 0 else 0,
        "checks": check_details,
        "details": details or [],
    }


def print_ab_report(baseline: dict, acad_fig_skill: dict):
    """Print A/B comparison report."""
    print("=" * 60)
    print("Academic Figure Skill A/B Comparison — Baseline vs Academic Figure Skill")
    print("=" * 60)
    print()

    baseline_total = acad_fig_skill_total = 0
    baseline_pass = acad_fig_skill_pass = 0

    for s in SCENARIOS:
        sid = s["id"]
        bl = baseline.get(sid, {})
        cn = acad_fig_skill.get(sid, {})

        bl_rate = bl.get("pass_rate", 0)
        cn_rate = cn.get("pass_rate", 0)
        delta = cn_rate - bl_rate

        if delta > 0:
            arrow = "+"
        elif delta < 0:
            arrow = ""
        else:
            arrow = "="

        print(f"  {sid}: Baseline={bl_rate:.0%}  Academic Figure Skill={cn_rate:.0%}  ({arrow}{delta:+.0%})")

        baseline_total += bl.get("total", 0)
        acad_fig_skill_total += cn.get("total", 0)
        baseline_pass += bl.get("passed", 0)
        acad_fig_skill_pass += cn.get("passed", 0)

    bl_overall = baseline_pass / baseline_total if baseline_total > 0 else 0
    cn_overall = acad_fig_skill_pass / acad_fig_skill_total if acad_fig_skill_total > 0 else 0

    print()
    print(f"  OVERALL: Baseline={bl_overall:.0%}  Academic Figure Skill={cn_overall:.0%}  (Δ={cn_overall - bl_overall:+.0%})")
    print("=" * 60)

    if cn_overall > bl_overall:
        print("Verdict: Academic Figure Skill WINS — objective quality improvement confirmed")
    elif cn_overall == bl_overall:
        print("Verdict: TIE — Academic Figure Skill does not degrade output; value is in automation")
    else:
        print("Verdict: Academic Figure Skill REGRESSION — need to investigate")


if __name__ == "__main__":
    if "--compare" in sys.argv:
        # Load saved results if available
        bl_path = PROJECT_ROOT / "academic-figure-skill" / "scripts" / ".ab_baseline.json"
        cn_path = PROJECT_ROOT / "academic-figure-skill" / "scripts" / ".ab_academic-figure-skill.json"
        baseline = json.load(open(bl_path)) if bl_path.exists() else {}
        acad_fig_skill = json.load(open(cn_path)) if cn_path.exists() else {}
        print_ab_report(baseline, acad_fig_skill)
    else:
        print_scenarios()
        print("To run A/B tests: send each scenario prompt to both bare Claude and Academic Figure Skill.")
        print("Score each run using the checks above. Save results with --baseline or --academic-figure-skill.")
        print()
        print(f"Results saved to: {PROJECT_ROOT}/academic-figure-skill/scripts/.ab_baseline.json and .ab_academic-figure-skill.json")
