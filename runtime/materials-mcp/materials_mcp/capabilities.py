"""Capability registry used by the agent-planned materials workflow.

Capabilities describe what a module can do and the evidence contract it must
return. They do not prescribe a universal sequence; the agent submits the
nodes and dependencies needed for the current question.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


class CapabilityError(ValueError):
    """Raised when an agent submits an invalid capability plan."""


_CAPABILITY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
_TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
_RISK_RANK = {"low": 0, "medium": 1, "high": 2}


def _catalog_path(workspace_root: str | Path | None = None) -> Path:
    if workspace_root is not None:
        return Path(workspace_root).resolve() / "materials" / "capabilities.json"
    # Keep the source checkout usable when the MCP is launched from a dated
    # workspace that has not copied the public capability catalog yet.
    return Path(__file__).resolve().parents[3] / "materials" / "capabilities.json"


def load_capabilities(workspace_root: str | Path | None = None) -> list[dict[str, Any]]:
    path = _catalog_path(workspace_root)
    if not path.is_file() and workspace_root is not None:
        path = _catalog_path(None)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CapabilityError(f"capability catalog is unreadable: {path}: {exc}") from exc
    rows = payload.get("capabilities") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise CapabilityError(f"capability catalog must contain a capabilities list: {path}")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise CapabilityError("capability entries must be objects")
        capability_id = str(row.get("id") or "").strip()
        if not _CAPABILITY_ID.fullmatch(capability_id):
            raise CapabilityError(f"invalid capability id: {capability_id!r}")
        if capability_id in seen:
            raise CapabilityError(f"duplicate capability id: {capability_id}")
        owner = str(row.get("owner") or "").strip()
        summary = str(row.get("summary") or "").strip()
        if not owner or not summary:
            raise CapabilityError(f"capability {capability_id} requires owner and summary")
        risk = str(row.get("risk") or "medium").strip().lower()
        if risk not in _RISK_RANK:
            raise CapabilityError(f"capability {capability_id} has unsupported risk {risk!r}")
        normalized = dict(row)
        normalized["id"] = capability_id
        normalized["owner"] = owner
        normalized["risk"] = risk
        normalized["inputs"] = [str(value) for value in row.get("inputs", [])]
        normalized["outputs"] = [str(value) for value in row.get("outputs", [])]
        normalized["parallelizable"] = bool(row.get("parallelizable", False))
        result.append(normalized)
        seen.add(capability_id)
    return result


def capability_catalog(workspace_root: str | Path | None = None) -> dict[str, Any]:
    rows = load_capabilities(workspace_root)
    return {
        "schema_version": 1,
        "capabilities": rows,
        "planning_contract": {
            "node_fields": ["task_id", "capability", "depends_on", "parameters", "objective"],
            "dependencies_are_explicit": True,
            "unknown_capabilities_rejected": True,
            "cycles_rejected": True,
            "high_risk_capabilities_require_high_risk_route": True,
        },
    }


def _by_id(workspace_root: str | Path | None = None) -> dict[str, dict[str, Any]]:
    return {row["id"]: row for row in load_capabilities(workspace_root)}


def capability_plan_tasks(
    plan: list[dict[str, Any] | str],
    workspace_root: str | Path | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate an agent plan and return task records plus normalized nodes."""
    if not isinstance(plan, list) or not plan:
        raise CapabilityError("capability_plan must be a non-empty list")
    catalog = _by_id(workspace_root)
    normalized: list[dict[str, Any]] = []
    capability_to_task: dict[str, str] = {}
    task_ids: set[str] = set()
    for index, item in enumerate(plan):
        node = {"capability": item} if isinstance(item, str) else dict(item) if isinstance(item, dict) else None
        if node is None:
            raise CapabilityError(f"capability plan node {index} must be a string or object")
        capability_id = str(node.get("capability") or node.get("capability_id") or "").strip()
        if capability_id not in catalog:
            raise CapabilityError(f"unknown capability: {capability_id}")
        task_id = str(node.get("task_id") or capability_id.replace(".", "-")).strip()
        if not _TASK_ID.fullmatch(task_id) or ".." in task_id or "/" in task_id or "\\" in task_id:
            raise CapabilityError(f"invalid task_id: {task_id!r}")
        if task_id in task_ids:
            raise CapabilityError(f"duplicate task_id: {task_id}")
        task_ids.add(task_id)
        if capability_id in capability_to_task and not node.get("task_id"):
            raise CapabilityError(f"capability {capability_id} appears more than once; provide unique task_id values")
        capability_to_task[capability_id] = task_id
        parameters = node.get("parameters", {})
        if not isinstance(parameters, dict):
            raise CapabilityError(f"parameters for {task_id} must be an object")
        depends_on = node.get("depends_on", [])
        if not isinstance(depends_on, list):
            raise CapabilityError(f"depends_on for {task_id} must be a list")
        normalized.append({
            "task_id": task_id,
            "capability": capability_id,
            "depends_on": [str(value) for value in depends_on],
            "parameters": dict(parameters),
            "objective": str(node.get("objective") or catalog[capability_id]["summary"]),
        })

    tasks: list[dict[str, Any]] = []
    for node in normalized:
        cap = catalog[node["capability"]]
        dependencies: list[str] = []
        for dependency in node["depends_on"]:
            resolved = capability_to_task.get(dependency, dependency)
            if resolved not in task_ids:
                raise CapabilityError(f"task {node['task_id']} depends on unknown task {dependency}")
            if resolved == node["task_id"]:
                raise CapabilityError(f"task {node['task_id']} cannot depend on itself")
            if resolved not in dependencies:
                dependencies.append(resolved)
        tasks.append({
            "task_id": node["task_id"],
            "role": cap["owner"],
            "objective": node["objective"],
            "dependencies": dependencies,
            "acceptance_tests": ["capability_output_recorded", *[f"output:{value}" for value in cap["outputs"]]],
            "capability_id": cap["id"],
            "capability_tool": cap.get("tool"),
            "capability_executor": cap.get("executor"),
            "capability_parameters": node["parameters"],
            "capability_inputs": cap["inputs"],
            "capability_outputs": cap["outputs"],
            "capability_risk": cap["risk"],
            "capability_cost": cap.get("cost"),
            "parallelizable": cap["parallelizable"],
        })
    # Reject cycles before the executor sees the plan. Dependencies may be
    # submitted in any order, but the resulting graph must be acyclic.
    by_task = {task["task_id"]: task for task in tasks}
    indegree = {task_id: len(task["dependencies"]) for task_id, task in by_task.items()}
    downstream: dict[str, list[str]] = {task_id: [] for task_id in by_task}
    for task_id, task in by_task.items():
        for dependency in task["dependencies"]:
            downstream[dependency].append(task_id)
    queue = [task_id for task_id, degree in indegree.items() if degree == 0]
    visited_count = 0
    while queue:
        task_id = queue.pop()
        visited_count += 1
        for child in downstream[task_id]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    if visited_count != len(by_task):
        cyclic = next(task_id for task_id, degree in indegree.items() if degree > 0)
        raise CapabilityError(f"cyclic dependency involving task {cyclic}")
    return tasks, normalized


def plan_risk(plan: list[dict[str, Any] | str], workspace_root: str | Path | None = None) -> str:
    catalog = _by_id(workspace_root)
    ranks: list[int] = []
    for item in plan:
        raw_capability = (
            item
            if isinstance(item, str)
            else item.get("capability") or item.get("capability_id")
            if isinstance(item, dict)
            else ""
        )
        capability_id = str(raw_capability).strip()
        if capability_id not in catalog:
            raise CapabilityError(f"unknown capability: {capability_id}")
        ranks.append(_RISK_RANK[catalog[capability_id]["risk"]])

    highest = max(ranks, default=0)
    return next(name for name, rank in _RISK_RANK.items() if rank == highest)
