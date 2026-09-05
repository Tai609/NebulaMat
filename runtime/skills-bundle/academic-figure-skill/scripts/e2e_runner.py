#!/usr/bin/env python3
"""Academic Figure Skill E2E Integration Test Runner.

Validates generated figure scripts against the A/B test scenario criteria from
ab_test.py. Post-generation structural checks — no Claude needed.

Each scenario defines a set of MUST_HAVE (required patterns) and MUST_NOT
(forbidden patterns) checks. The runner scores pass/fail per scenario.

Usage:
    py e2e_runner.py <generated_script.py>              # score one script
    py e2e_runner.py --dir <output_dir/>                # score all scripts in dir
    py e2e_runner.py --scenario S1_pca --stdin          # read script from stdin
    py e2e_runner.py --list                             # list all scenarios
"""

from __future__ import annotations
import json, os, re, sys
from pathlib import Path
from dataclasses import dataclass, field

PROJECT = Path(__file__).resolve().parents[2]


@dataclass
class Check:
    name: str
    pattern: str | None = None   # regex to search for (MUST_HAVE)
    anti_pattern: str | None = None  # regex that must NOT appear (MUST_NOT)
    human_check: str = ""        # non-automatable check description


@dataclass
class Scenario:
    id: str
    name: str
    prompt: str
    checks: list[Check]
    pass_threshold: float = 0.80  # 80% of checks must pass


SCENARIOS = [
    Scenario(
        id="S1_pca",
        name="PCA from real data",
        prompt="对 simulated_data.csv 做 PCA 分析并可视化",
        checks=[
            # Asset usage
            Check("R script used", pattern=r"subprocess\.run.*\.R"),
            Check("Cairo PNG device", pattern=r'type\s*=\s*["\']cairo["\']'),
            Check("showtext disabled before png", pattern=r"showtext_auto\s*\(\s*FALSE\s*\)"),
            # Typography
            Check("Arial font", pattern=r"Arial|Helvetica"),
            Check("font.size >= 8", pattern=r'font\.size["\']?\s*[:=]\s*[89]\d*'),
            # Palette
            Check("CNS CATEGORICAL palette", pattern=r"#2166AC.*#B2182B.*#1B7837"),
            Check("Not ggplot2 default", anti_pattern=r"scale_color_hue\(\)|scale_fill_hue\(\)"),
            # Export
            Check("cairo_pdf export", pattern=r"cairo_pdf|device\s*=\s*cairo_pdf"),
            Check("300 dpi", pattern=r"dpi\s*=\s*300|res\s*=\s*300"),
            Check("Vector PDF output", pattern=r"\.pdf"),
        ],
    ),
    Scenario(
        id="S2_multipanel",
        name="Multi-panel mixed Python+R figure",
        prompt="画雷达图、小提琴图、分组柱状图、PCA图，组合成一张",
        checks=[
            # Asset Confirmation Table
            Check("Asset Confirmation Table", pattern=r"Asset Confirmation"),
            Check("Panel (a) declared", pattern=r"\(a\).*→"),
            Check("Panel (b) declared", pattern=r"\(b\).*→"),
            Check("Panel (c) declared", pattern=r"\(c\).*→"),
            Check("Panel (d) declared", pattern=r"\(d\).*→"),
            # COPY-FIRST compliance
            Check("No draw function for native-run panel",
                  anti_pattern=r"def\s+(?:draw_|plot_|make_)\w*\s*\(.*\)\s*:.*?\b(?:native.run|production)\b"),
            # Layout
            Check("compose_figure called", pattern=r"compose_figure\s*\("),
            Check("panel_labels parameter", pattern=r"panel_labels"),
            Check("Grid >= 2x2 or 4 columns", pattern=r"(?:cols|ncol|n_cols?)\s*[=:]\s*[2-4]"),
            # Baseline injection
            Check("Typography baseline", pattern=r"font\.family.*sans-serif"),
            Check("Color baseline", pattern=r"CATEGORICAL\s*=\s*\[.*#2166AC"),
            Check("Export baseline", pattern=r"pdf\.fonttype.*42"),
        ],
    ),
    Scenario(
        id="S3_heatmap_nature",
        name="Nature Genetics style heatmap",
        prompt="画一个 Nature Genetics 风格的差异基因表达热图",
        checks=[
            Check("Journal palette reference", pattern=r"journal_palette|Nature"),
            Check("Diverging colormap, not jet", pattern=r"DIVERGING|RdBu|diverging"),
            Check("No jet/rainbow", anti_pattern=r"cmap\s*=\s*['\"]jet['\"]|cmap\s*=\s*['\"]rainbow['\"]"),
            Check("ComplexHeatmap or seaborn clustermap", pattern=r"ComplexHeatmap|clustermap|heatmap"),
            Check("Arial font", pattern=r"Arial|Helvetica"),
            Check("Vector PDF + PNG", pattern=r"\.pdf.*\.png|\.png.*\.pdf"),
            Check("300 dpi", pattern=r"dpi\s*=\s*300|res\s*=\s*300"),
        ],
    ),
    Scenario(
        id="S4_unknown_chart",
        name="Unknown chart type — chord diagram",
        prompt="画一个弦图展示六个群组之间的流动",
        checks=[
            Check("Cross-type inheritance mentioned", pattern=r"cross.type|cross_type|inherit"),
            Check("CNS color palette", pattern=r"#2166AC|CATEGORICAL"),
            Check("Arial font", pattern=r"Arial|Helvetica"),
            Check("No error or refusal", anti_pattern=r"(?:cannot|can't|unable|don't support|not supported)"),
            Check("Script is executable", pattern=r"plt\.|ggplot|plot\("),
        ],
    ),
    Scenario(
        id="S5_vague_request",
        name="Vague request — no auto-generation",
        prompt="分析 simulated_data.csv 并可视化",
        checks=[
            Check("Step -1 question asked",
                  pattern=r"(?:What are you|问题|question|trying to learn|想了解|想看)"),
            Check("No 4-panel template auto-generated",
                  anti_pattern=r"(?:4.panel|four.panel|template|standard.panel)"),
        ],
    ),
]


def score_script(source: str, scenario: Scenario) -> dict:
    """Score one script against one scenario's checks."""
    results = []
    for check in scenario.checks:
        if check.pattern:
            found = bool(re.search(check.pattern, source, re.IGNORECASE | re.DOTALL))
            results.append({"check": check.name, "passed": found, "type": "MUST_HAVE"})
        elif check.anti_pattern:
            found = bool(re.search(check.anti_pattern, source, re.IGNORECASE | re.DOTALL))
            results.append({"check": check.name, "passed": not found, "type": "MUST_NOT"})
        else:
            results.append({"check": check.name, "passed": None, "type": "HUMAN"})

    auto_checks = [r for r in results if r["type"] != "HUMAN"]
    passed = sum(1 for r in auto_checks if r["passed"])
    total = len(auto_checks)
    rate = passed / total if total > 0 else 0

    return {
        "scenario": scenario.id,
        "name": scenario.name,
        "passed": passed,
        "total": total,
        "pass_rate": round(rate, 3),
        "meets_threshold": rate >= scenario.pass_threshold,
        "checks": results,
        "human_checks": [r["check"] for r in results if r["type"] == "HUMAN"],
    }


def score_against_all(source: str) -> dict:
    """Score one script against all 5 scenarios."""
    scores = {}
    for s in SCENARIOS:
        scores[s.id] = score_script(source, s)
    overall = sum(1 for v in scores.values() if v["meets_threshold"])
    scores["_overall"] = {
        "scenarios_pass": overall,
        "scenarios_total": len(SCENARIOS),
        "pass_rate": round(overall / len(SCENARIOS), 3) if SCENARIOS else 0,
    }
    return scores


def print_score(report: dict):
    s = report
    print(f"  Scenario: {s.get('scenario', 'N/A')} — {s.get('name', '')}")
    print(f"  Score: {s.get('passed', 0)}/{s.get('total', 0)} ({s.get('pass_rate', 0):.0%})")
    print(f"  Threshold met: {'YES' if s.get('meets_threshold') else 'NO'}")
    for c in s.get("checks", []):
        if c["type"] == "HUMAN":
            print(f"    [????] {c['check']} (manual check)")
        elif c["passed"]:
            print(f"    [PASS] {c['check']}")
        else:
            print(f"    [FAIL] {c['check']}")
    print()


if __name__ == "__main__":
    if "--list" in sys.argv:
        for s in SCENARIOS:
            auto = sum(1 for c in s.checks if c.pattern or c.anti_pattern)
            human = sum(1 for c in s.checks if c.human_check)
            print(f"  {s.id}: {s.name} ({auto} auto + {human} human checks)")
        sys.exit(0)

    source = None
    label = ""

    if "--dir" in sys.argv:
        idx = sys.argv.index("--dir")
        dirpath = Path(sys.argv[idx + 1])
        if not dirpath.is_dir():
            print(f"Not a directory: {dirpath}")
            sys.exit(1)
        py_files = list(dirpath.glob("*.py")) + list(dirpath.glob("*.R"))
        if not py_files:
            print(f"No .py/.R files in {dirpath}")
            sys.exit(1)
        reports = []
        for f in sorted(py_files):
            source = f.read_text(encoding="utf-8", errors="replace")
            report = score_against_all(source)
            print(f"\n{'='*60}")
            print(f"File: {f.name}")
            print(f"{'='*60}")
            for sid in [s.id for s in SCENARIOS]:
                print_score(report[sid])
            reports.append({"file": str(f), "scores": report})
        print(f"\nSummary: scored {len(reports)} file(s)")
        sys.exit(0)

    if "--scenario" in sys.argv:
        idx = sys.argv.index("--scenario")
        target_id = sys.argv[idx + 1]
        scenario = next((s for s in SCENARIOS if s.id == target_id), None)
        if not scenario:
            print(f"Unknown scenario: {target_id}. Use --list to see options.")
            sys.exit(1)
        if "--stdin" in sys.argv:
            source = sys.stdin.read()
            label = "stdin"
        elif len(sys.argv) > idx + 2:
            fpath = Path(sys.argv[idx + 2])
            source = fpath.read_text(encoding="utf-8", errors="replace")
            label = fpath.name
        else:
            print("Usage: py e2e_runner.py --scenario S1_pca <script.py>")
            sys.exit(1)
        report = score_script(source, scenario)
        print(f"File: {label}")
        print_score(report)
        sys.exit(0)

    # Default: score a single file against all scenarios
    if len(sys.argv) > 1:
        fpath = Path(sys.argv[1])
        if fpath.exists():
            source = fpath.read_text(encoding="utf-8", errors="replace")
            label = fpath.name
    if not source:
        print("Usage: py e2e_runner.py <script.py>")
        print("       py e2e_runner.py --dir <output_dir/>")
        print("       py e2e_runner.py --scenario S1_pca <script.py>")
        print("       py e2e_runner.py --list")
        sys.exit(1)

    report = score_against_all(source)
    print(f"File: {label}")
    print(f"{'='*60}")
    for sid in [s.id for s in SCENARIOS]:
        print_score(report[sid])
    ov = report["_overall"]
    print(f"Overall: {ov['scenarios_pass']}/{ov['scenarios_total']} scenarios pass threshold")
