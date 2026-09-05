"""Shared helpers for research-orchestrator gate hook scripts."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from validate_gate import load_gate, normalize_gate, validate_gate_file
from validate_state import Finding, load_jsonl, load_yaml, rel, resolve_research_dir, validate


GATE_FILE_SUFFIXES = {".yaml", ".yml"}


def emit_findings(findings: list[Finding], *, stream: Any = sys.stderr) -> None:
    for finding in findings:
        print(f"{finding.level}  {finding.path}  {finding.message}", file=stream)


def fail_if_invalid(research_dir: Path) -> None:
    findings = validate(research_dir)
    failures = [finding for finding in findings if finding.level == "FAIL"]
    if failures:
        emit_findings(findings)
        raise SystemExit(f"state invalid: {len(failures)} failure(s)")


def load_state(path: Path) -> tuple[Path, Path, dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    research_dir, project_root = resolve_research_dir(path)
    fail_if_invalid(research_dir)
    tasks: dict[str, dict[str, Any]] = {}
    for task_file in sorted((research_dir / "tasks").glob("*.yaml")):
        task = load_yaml(task_file, [], research_dir)
        if isinstance(task.get("id"), str):
            tasks[task["id"]] = task
    artifacts = {
        row["artifact_id"]: row
        for row in load_jsonl(research_dir / "artifacts.jsonl", [], research_dir)
        if isinstance(row.get("artifact_id"), str) and row.get("status") != "superseded"
    }
    return research_dir, project_root, tasks, artifacts


def task_input_artifact_ids(task: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for inp in task.get("inputs") or []:
        if isinstance(inp, dict) and isinstance(inp.get("artifact_id"), str):
            ids.add(inp["artifact_id"])
    return ids


def artifact_path_candidates(row: dict[str, Any], project_root: Path) -> list[Path]:
    token = str(row.get("path", ""))
    path = Path(token)
    candidates = [(project_root / path).resolve()]
    if not path.is_absolute():
        parts = path.parts
        if parts and parts[0] == project_root.name and len(parts) > 1:
            candidates.append((project_root / Path(*parts[1:])).resolve())
    return candidates


def artifact_path(row: dict[str, Any], project_root: Path) -> Path:
    candidates = artifact_path_candidates(row, project_root)
    project_root = project_root.resolve()
    for candidate in candidates:
        try:
            candidate.relative_to(project_root)
        except ValueError:
            continue
        if candidate.exists():
            return candidate
    return candidates[0]


def is_yaml_gate_candidate(row: dict[str, Any], project_root: Path) -> bool:
    path = artifact_path(row, project_root)
    artifact_type = row.get("type")
    return artifact_type == "gate-verdict" or path.suffix.lower() in GATE_FILE_SUFFIXES


def matching_gate_artifacts(
    artifacts: dict[str, dict[str, Any]],
    project_root: Path,
    target_gate: str,
    *,
    candidate_ids: set[str] | None = None,
) -> list[tuple[dict[str, Any], Path, dict[str, Any]]]:
    matches: list[tuple[dict[str, Any], Path, dict[str, Any]]] = []
    for artifact_id, row in sorted(artifacts.items()):
        if candidate_ids is not None and artifact_id not in candidate_ids:
            continue
        if not is_yaml_gate_candidate(row, project_root):
            continue
        path = artifact_path(row, project_root)
        if not path.is_file():
            continue
        gate = load_gate(path, [])
        if normalize_gate(gate.get("gate")) == normalize_gate(target_gate):
            matches.append((row, path, gate))
    return matches


def require_passing_gate(
    artifacts: dict[str, dict[str, Any]],
    project_root: Path,
    research_dir: Path,
    target_gate: str,
    *,
    candidate_ids: set[str] | None = None,
    context: str,
) -> tuple[dict[str, Any], Path, dict[str, Any]]:
    matches = matching_gate_artifacts(artifacts, project_root, target_gate, candidate_ids=candidate_ids)
    if not matches:
        scope = "declared task inputs" if candidate_ids is not None else "registered artifacts"
        raise SystemExit(
            f"{context} blocked: no `{target_gate}` gate verdict found in {scope}. "
            "This blocks the downstream release action only; upstream planning, "
            "initial-structure inspection, self-building, or revision tasks should "
            "remain runnable until they produce the gate evidence."
        )
    problems: list[str] = []
    for row, path, gate in matches:
        artifact_id = row.get("artifact_id")
        if row.get("status") != "accepted":
            problems.append(f"{artifact_id} is {row.get('status')}, needs accepted")
            continue
        findings = validate_gate_file(
            path,
            research_dir=research_dir,
            target_gate=target_gate,
            require_passing=True,
        )
        failures = [finding for finding in findings if finding.level == "FAIL"]
        if failures:
            problems.extend(f"{rel(path, project_root)}: {finding.message}" for finding in failures)
            continue
        return row, path, gate
    detail = "; ".join(problems) if problems else "matching gate verdict did not pass"
    raise SystemExit(f"{context} blocked: {detail}")
