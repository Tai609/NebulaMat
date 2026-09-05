#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Validate a machine-readable plan/structure/result/report gate verdict."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - reached only outside uv/pep723
    raise SystemExit(
        "PyYAML is required. Run with: uv run "
        "procedures/research-orchestrator/scripts/validate_gate.py GATE.yaml"
    ) from exc

from validate_state import Finding, load_jsonl, rel, resolve_research_dir


GATE_STATUSES = {"pass", "request_revision", "block", "waived"}
PASSING_GATE_STATUSES = {"pass", "waived"}
CHECK_STATUSES = {"pass", "warn", "not_applicable", "request_revision", "block", "waived"}
BLOCKING_CHECK_STATUSES = {"request_revision", "block"}
STRUCTURE_REVISION_CHECK_STATUSES = {"request_revision", "block", "waived"}
CLAIM_OUTCOMES = {"addresses", "contradicts", "inconclusive", "needs-follow-up"}
CANONICAL_GATES = {"plan_gate", "structure_gate", "result_gate", "report_gate"}
GATE_ALIASES = {
    "model-observable": "plan_gate",
    "model_observable": "plan_gate",
    "model-structure-review": "structure_gate",
    "model_structure_review": "structure_gate",
    "structure-release": "structure_gate",
    "structure_release": "structure_gate",
    "critic-acceptance": "result_gate",
    "critic_acceptance": "result_gate",
    "report-readiness": "report_gate",
    "report_readiness": "report_gate",
}
WAIVER_APPROVAL_TYPES = {"gate-waiver", "gate_waiver"}


def normalize_gate(gate: Any) -> str:
    if not isinstance(gate, str):
        return ""
    return GATE_ALIASES.get(gate, gate)


def load_gate(path: Path, findings: list[Finding] | None = None) -> dict[str, Any]:
    local_findings = findings if findings is not None else []
    try:
        obj = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - report parser detail
        local_findings.append(Finding("FAIL", path.as_posix(), f"YAML parse failed: {exc}"))
        return {}
    if obj is None:
        local_findings.append(Finding("FAIL", path.as_posix(), "YAML file is empty"))
        return {}
    if not isinstance(obj, dict):
        local_findings.append(Finding("FAIL", path.as_posix(), "YAML root must be a mapping"))
        return {}
    return obj


def list_like_present(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value)
    return False


def waiver_decision_valid(research_dir: Path, decision_id: str, gate: str) -> bool:
    decisions = load_jsonl(research_dir / "decisions.jsonl", [], research_dir)
    acceptable_approval_types = set(WAIVER_APPROVAL_TYPES)
    acceptable_approval_types.add(f"{gate}_waiver")
    acceptable_approval_types.add(gate)
    for decision in decisions:
        if decision.get("decision_id") != decision_id:
            continue
        if decision.get("decision") not in {"approved", "accepted"}:
            return False
        if decision.get("kind") == "gate-waiver":
            return True
        if decision.get("kind") == "approval" and decision.get("approval_type") in acceptable_approval_types:
            return True
        return False
    return False


def numeric(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def validate_structure_metric_invariants(
    gate_name: str,
    gate_status: Any,
    check: dict[str, Any],
    check_where: str,
    findings: list[Finding],
) -> None:
    if gate_name != "structure_gate":
        return
    metrics = check.get("metrics")
    if metrics is None:
        return
    if not isinstance(metrics, dict):
        findings.append(Finding("FAIL", check_where, "`metrics` must be a mapping when present"))
        return

    metric_pairs = [
        ("min_adsorbate_image_A", "target_min_adsorbate_image_A"),
        ("min_periodic_image_separation_A", "target_min_periodic_image_separation_A"),
        ("min_cluster_image_A", "target_min_cluster_image_A"),
        ("min_defect_image_A", "target_min_defect_image_A"),
    ]
    for observed_key, target_key in metric_pairs:
        observed = numeric(metrics.get(observed_key))
        target = numeric(metrics.get(target_key))
        if observed is None or target is None or observed >= target:
            continue

        check_status = check.get("status")
        if check_status not in STRUCTURE_REVISION_CHECK_STATUSES:
            findings.append(
                Finding(
                    "FAIL",
                    check_where,
                    f"`{observed_key}` ({observed:g} A) is below `{target_key}` "
                    f"({target:g} A); the check must be request_revision, block, "
                    "or waived, not pass/warn/not_applicable",
                )
            )
        elif check_status == "waived" and gate_status != "waived":
            findings.append(
                Finding(
                    "FAIL",
                    check_where,
                    f"`{observed_key}` ({observed:g} A) is below `{target_key}` "
                    f"({target:g} A); continuing by waiver requires top-level "
                    "`status: waived` with a valid `waiver.decision_id`",
                )
            )


def validate_gate_obj(
    gate: dict[str, Any],
    where: str,
    findings: list[Finding],
    *,
    research_dir: Path | None = None,
    target_gate: str | None = None,
    require_passing: bool = False,
) -> None:
    if gate.get("schema_version") != 1:
        findings.append(Finding("FAIL", where, "`schema_version` must be 1"))

    raw_gate_name = gate.get("gate")
    gate_name = normalize_gate(raw_gate_name)
    if gate_name not in CANONICAL_GATES:
        findings.append(
            Finding(
                "FAIL",
                where,
                f"`gate` must be one of {sorted(CANONICAL_GATES)} or a documented alias",
            )
        )
    if target_gate and gate_name != normalize_gate(target_gate):
        findings.append(Finding("FAIL", where, f"gate is `{raw_gate_name}`, expected `{target_gate}`"))

    status = gate.get("status")
    if status not in GATE_STATUSES:
        findings.append(Finding("FAIL", where, f"`status` must be one of {sorted(GATE_STATUSES)}"))
    elif require_passing and status not in PASSING_GATE_STATUSES:
        findings.append(Finding("FAIL", where, f"gate status `{status}` does not allow downstream work"))

    scope = gate.get("scope")
    if not isinstance(scope, dict) or not scope:
        findings.append(Finding("FAIL", where, "`scope` must be a non-empty mapping"))

    checks = gate.get("checks")
    if not isinstance(checks, list) or not checks:
        findings.append(Finding("FAIL", where, "`checks` must be a non-empty list"))
    else:
        for idx, check in enumerate(checks, 1):
            check_where = f"{where}:checks[{idx}]"
            if not isinstance(check, dict):
                findings.append(Finding("FAIL", check_where, "check entry must be a mapping"))
                continue
            if not isinstance(check.get("id"), str) or not check.get("id"):
                findings.append(Finding("FAIL", check_where, "`id` must be a non-empty string"))
            check_status = check.get("status")
            if check_status not in CHECK_STATUSES:
                findings.append(Finding("FAIL", check_where, f"`status` must be one of {sorted(CHECK_STATUSES)}"))
            if check_status in BLOCKING_CHECK_STATUSES and status in PASSING_GATE_STATUSES:
                findings.append(
                    Finding("FAIL", check_where, f"blocking check status `{check_status}` conflicts with gate `{status}`")
                )
            validate_structure_metric_invariants(gate_name, status, check, check_where, findings)

    blocking_issues = gate.get("blocking_issues", [])
    if not isinstance(blocking_issues, list):
        findings.append(Finding("FAIL", where, "`blocking_issues` must be a list"))
    elif status == "pass" and blocking_issues:
        findings.append(Finding("FAIL", where, "`status: pass` cannot carry blocking issues"))
    elif status in {"request_revision", "block"} and not blocking_issues:
        findings.append(Finding("FAIL", where, f"`status: {status}` requires `blocking_issues`"))

    required_fix = gate.get("required_fix", [])
    if not isinstance(required_fix, (list, str)):
        findings.append(Finding("FAIL", where, "`required_fix` must be a list or string"))
    elif status in {"request_revision", "block"} and not list_like_present(required_fix):
        findings.append(Finding("FAIL", where, f"`status: {status}` requires `required_fix`"))

    claim_outcome = gate.get("claim_outcome")
    if claim_outcome is not None and claim_outcome not in CLAIM_OUTCOMES:
        findings.append(Finding("FAIL", where, f"`claim_outcome` must be one of {sorted(CLAIM_OUTCOMES)}"))

    waiver = gate.get("waiver")
    if status == "waived":
        if not isinstance(waiver, dict):
            findings.append(Finding("FAIL", where, "`status: waived` requires `waiver` mapping"))
            return
        decision_id = waiver.get("decision_id")
        if not isinstance(decision_id, str) or not decision_id:
            findings.append(Finding("FAIL", where, "`waiver.decision_id` must be a non-empty string"))
            return
        if research_dir is None:
            findings.append(Finding("FAIL", where, "`status: waived` requires `--research` for waiver provenance"))
            return
        if not waiver_decision_valid(research_dir, decision_id, gate_name):
            findings.append(Finding("FAIL", where, f"`waiver.decision_id` is not an approved gate waiver: {decision_id}"))
    elif waiver is not None and not isinstance(waiver, dict):
        findings.append(Finding("FAIL", where, "`waiver` must be a mapping when present"))


def validate_gate_file(
    gate_path: Path,
    *,
    research_dir: Path | None = None,
    target_gate: str | None = None,
    require_passing: bool = False,
) -> list[Finding]:
    findings: list[Finding] = []
    gate = load_gate(gate_path, findings)
    if not gate:
        return findings
    root = research_dir if research_dir is not None else gate_path.parent
    validate_gate_obj(
        gate,
        rel(gate_path.resolve(), root.resolve()) if root.exists() else gate_path.as_posix(),
        findings,
        research_dir=research_dir,
        target_gate=target_gate,
        require_passing=require_passing,
    )
    return findings


def gate_is_passing(gate: dict[str, Any]) -> bool:
    return gate.get("status") in PASSING_GATE_STATUSES


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gate", help="Path to gate YAML")
    parser.add_argument("--research", help="Path to .research directory or project root for waiver validation")
    parser.add_argument("--target-gate", choices=sorted(CANONICAL_GATES), help="Require this canonical gate")
    parser.add_argument("--require-passing", action="store_true", help="Fail unless status is pass or validly waived")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable findings")
    args = parser.parse_args()

    research_dir = None
    if args.research:
        research_dir, _project_root = resolve_research_dir(Path(args.research))
    findings = validate_gate_file(
        Path(args.gate),
        research_dir=research_dir,
        target_gate=args.target_gate,
        require_passing=args.require_passing,
    )
    failures = [finding for finding in findings if finding.level == "FAIL"]

    if args.json:
        print(json.dumps([finding.__dict__ for finding in findings], indent=2, sort_keys=True))
    else:
        for finding in findings:
            print(f"{finding.level}  {finding.path}  {finding.message}")
        if failures:
            print(f"\n== validate_gate: {len(failures)} failure(s) ==")
        else:
            print("\n== validate_gate: clean ==")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
