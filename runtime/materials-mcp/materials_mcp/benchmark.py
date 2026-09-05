"""Deterministic materials benchmark and workflow replay evaluation."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from .schemas import BenchmarkResult
from .validation import validate_payload


@dataclass
class BenchmarkCase:
    benchmark_id: str
    goal: str
    payload: dict[str, Any]
    expected: dict[str, Any]
    tags: list[str] = field(default_factory=list)


DEFAULT_CASES = [
    BenchmarkCase(
        benchmark_id="formula:neutral-fe2o3",
        goal="Accept a neutral Fe2O3 formula with declared oxidation states",
        payload={"formula": "Fe2O3", "oxidation_states": {"Fe": 3, "O": -2}},
        expected={"ok": True, "checks": {"charge_neutrality": "absent"}},
        tags=["formula", "charge"],
    ),
    BenchmarkCase(
        benchmark_id="formula:nonneutral-nacl",
        goal="Reject a non-neutral NaCl oxidation-state declaration",
        payload={"formula": "NaCl", "oxidation_states": {"Na": 2, "Cl": -1}},
        expected={"ok": False, "checks": {"charge_neutrality": "error"}},
        tags=["formula", "charge"],
    ),
    BenchmarkCase(
        benchmark_id="screen:missing-unit",
        goal="Surface a missing band-gap unit as a warning",
        payload={"formula": "LiFePO4", "units": {"band_gap": {"value": 1.5}}},
        expected={"ok": True, "checks": {"units": "warn"}},
        tags=["units", "review"],
    ),
    BenchmarkCase(
        benchmark_id="dft:missing-convergence",
        goal="Keep missing DFT convergence parameters visible",
        payload={"formula": "Si", "dft": {}},
        expected={"ok": True, "checks": {"dft_convergence": "warn"}},
        tags=["dft", "review"],
    ),
]


def _check_level(report: dict[str, Any], check: str, expected_level: str) -> bool:
    return any(item.get("check") == check and item.get("level") == expected_level for item in report.get("findings", []))


class BenchmarkRunner:
    def __init__(self, cases: Iterable[BenchmarkCase] | None = None) -> None:
        self.cases = list(cases or DEFAULT_CASES)

    def run(self, case_ids: Iterable[str] | None = None) -> dict[str, Any]:
        wanted = set(case_ids or [])
        selected = [case for case in self.cases if not wanted or case.benchmark_id in wanted]
        checks: list[dict[str, Any]] = []
        for case in selected:
            report = validate_payload(case.payload).to_dict()
            expected_ok = bool(case.expected.get("ok"))
            case_passed = report.get("ok") == expected_ok
            for check, expected_level in dict(case.expected.get("checks") or {}).items():
                if expected_level == "absent":
                    check_ok = not any(item.get("check") == check and item.get("level") == "error" for item in report.get("findings", []))
                else:
                    check_ok = _check_level(report, check, expected_level)
                case_passed = case_passed and check_ok
            checks.append({
                "benchmark_id": case.benchmark_id,
                "passed": case_passed,
                "expected": case.expected,
                "observed": {"ok": report.get("ok"), "findings": report.get("findings", [])},
            })
        passed_count = sum(1 for check in checks if check["passed"])
        result = BenchmarkResult(
            benchmark_id="materials-v1",
            passed=bool(checks) and passed_count == len(checks),
            checks=checks,
            metrics={"total": len(checks), "passed": passed_count, "accuracy": passed_count / len(checks) if checks else 0.0},
        )
        return result.to_dict()


class ReplayEvaluator:
    """Check an append-only workflow event stream for safe replay behavior."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()

    def _events(self) -> list[dict[str, Any]]:
        database = self.workspace / ".openscience" / "materials-workflows.sqlite3"
        if database.is_file():
            connection = sqlite3.connect(database)
            try:
                rows = connection.execute(
                    "SELECT event_json FROM workflow_events ORDER BY rowid"
                ).fetchall()
                events: list[dict[str, Any]] = []
                for row in rows:
                    try:
                        value = json.loads(str(row[0]))
                    except json.JSONDecodeError:
                        continue
                    if isinstance(value, dict):
                        events.append(value)
                return events
            except sqlite3.OperationalError:
                pass
            finally:
                connection.close()
        path = self.workspace / ".openscience" / "material-workflow-events.jsonl"
        if not path.is_file():
            return []
        rows: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                rows.append(value)
        return rows

    def run(self, workflow_id: str | None = None, rule: Callable[[dict[str, Any]], bool] | None = None) -> dict[str, Any]:
        events = [event for event in self._events() if not workflow_id or event.get("workflow_id") == workflow_id]
        invalid: list[dict[str, Any]] = []
        seen_event_ids: set[str] = set()
        claimed: set[tuple[str, str]] = set()
        for event in events:
            event_id = str(event.get("event_id", ""))
            if not event_id or event_id in seen_event_ids:
                invalid.append({"event": event, "reason": "missing_or_duplicate_event_id"})
            seen_event_ids.add(event_id)
            key = (str(event.get("workflow_id", "")), str(event.get("task_id", "")))
            if event.get("event") == "task_claimed":
                if key in claimed:
                    invalid.append({"event": event, "reason": "task_claimed_twice_without_completion"})
                claimed.add(key)
            elif event.get("event") == "task_completed":
                if key not in claimed:
                    invalid.append({"event": event, "reason": "task_completed_without_claim"})
                claimed.discard(key)
            elif event.get("event") == "review_vote" and key not in claimed:
                invalid.append({"event": event, "reason": "review_vote_without_claim"})
            elif event.get("event") == "expired_tasks_recovered":
                for task_id in list(event.get("recovered") or []) + list(event.get("dead_letter") or []):
                    claimed.discard((str(event.get("workflow_id", "")), str(task_id)))
            if rule is not None:
                try:
                    if not rule(event):
                        invalid.append({"event": event, "reason": "rule_rejected"})
                except Exception as exc:
                    invalid.append({"event": event, "reason": f"rule_error:{exc}"})
        return {
            "benchmark_id": "workflow-replay-v1",
            "passed": not invalid,
            "metrics": {"events": len(events), "invalid": len(invalid)},
            "invalid_events": invalid,
        }
