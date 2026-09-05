#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Create next-wave task YAML files from an accepted follow-up proposal artifact."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml

from lease_utils import append_event, fail_if_invalid, iso, now_local, parse_time, resolve
from validate_state import load_jsonl, load_yaml


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[2]
TASK_ID_RE = re.compile(r"^T(\d+)$")


ROLE_CONTRACTS = {
    "research-orchestrator": "procedures/research-orchestrator/references/roles.md#research-orchestrator",
    "literature-method": "procedures/research-orchestrator/references/roles.md#literature-method",
    "surface-literature-reviewer": "procedures/research-orchestrator/references/roles.md#surface-literature-reviewer",
    "structure-modeler": "procedures/research-orchestrator/references/roles.md#structure-modeler",
    "structure-critic": "procedures/research-orchestrator/references/roles.md#structure-critic",
    "engine-runner": "procedures/research-orchestrator/references/roles.md#engine-runner",
    "scientific-critic": "procedures/research-orchestrator/references/roles.md#scientific-critic",
    "synthesis-report": "procedures/research-orchestrator/references/roles.md#synthesis-report",
}


def write_yaml(path: Path, obj: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(obj, sort_keys=False, allow_unicode=False), encoding="utf-8")


def active_artifact(rows: list[dict[str, Any]], artifact_id: str) -> dict[str, Any]:
    matches = [row for row in rows if row.get("artifact_id") == artifact_id and row.get("status") != "superseded"]
    if not matches:
        raise SystemExit(f"active artifact not found: {artifact_id}")
    if len(matches) > 1:
        raise SystemExit(f"multiple active artifact rows found: {artifact_id}")
    return matches[0]


def artifact_path(row: dict[str, Any], project_root: Path) -> Path:
    token = row.get("path")
    if not isinstance(token, str) or not token:
        raise SystemExit(f"follow-up proposal has no usable path: {row.get('artifact_id')}")
    path = (project_root / token).resolve()
    try:
        path.relative_to(project_root)
    except ValueError as exc:
        raise SystemExit(f"follow-up proposal path escapes project root: {token}") from exc
    return path


def load_payload(row: dict[str, Any], project_root: Path) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    path = artifact_path(row, project_root)
    if path.suffix.lower() in {".yaml", ".yml"} and path.is_file():
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(data, dict):
            raise SystemExit(f"follow-up proposal YAML root must be a mapping: {path}")
        payload.update(data)
    elif path.suffix.lower() == ".json" and path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise SystemExit(f"follow-up proposal JSON root must be a mapping: {path}")
        payload.update(data)

    for key in ["recommended_tasks", "wave_id", "iteration", "source_claim_id", "resolves_claim"]:
        if key in row and key not in payload:
            payload[key] = row[key]
    return payload


def load_tasks(research_dir: Path) -> dict[str, dict[str, Any]]:
    tasks: dict[str, dict[str, Any]] = {}
    for task_file in sorted((research_dir / "tasks").glob("*.yaml")):
        task = load_yaml(task_file, [], research_dir)
        if isinstance(task.get("id"), str):
            tasks[task["id"]] = task
    return tasks


def existing_task_ids_for_proposal(tasks: dict[str, dict[str, Any]], proposal_id: str) -> list[str]:
    return sorted(
        task_id
        for task_id, task in tasks.items()
        if task.get("source_proposal") == proposal_id or task.get("resolves_follow_up") == proposal_id
    )


def next_task_ids(existing: set[str], count: int) -> list[str]:
    max_seen = 0
    for task_id in existing:
        match = TASK_ID_RE.match(task_id)
        if match:
            max_seen = max(max_seen, int(match.group(1)))
    ids: list[str] = []
    candidate = max_seen + 1
    while len(ids) < count:
        task_id = f"T{candidate:03d}"
        if task_id not in existing:
            ids.append(task_id)
            existing.add(task_id)
        candidate += 1
    return ids


def skill_ref(skill: str) -> list[str]:
    for root in ["procedures", "tools"]:
        candidate = REPO_ROOT / root / skill / "SKILL.md"
        if candidate.is_file():
            return [f"{root}/{skill}/SKILL.md"]
    return []


def default_approval(role: str) -> str:
    if role == "engine-runner":
        return "expensive_hpc_submission"
    if role in {"structure-modeler", "structure-critic", "scientific-critic", "synthesis-report"}:
        return "none"
    return "none"


def default_execution_policy(role: str) -> dict[str, Any]:
    return {
        "mode": "single_owner",
        "allow_parallel_subagents": role in {"scientific-critic", "structure-critic", "synthesis-report"},
    }


def list_value(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def default_can_write_entries(outputs: list[Any]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for output in outputs:
        if not isinstance(output, dict):
            continue
        artifact_type = output.get("type")
        artifact_id = output.get("artifact_id")
        if isinstance(artifact_type, str) and artifact_type:
            entries.append({"artifact_type": artifact_type})
        elif isinstance(artifact_id, str) and artifact_id:
            entries.append({"artifact_id": artifact_id})
    return entries


def compact_string_list(values: list[Any]) -> list[Any]:
    return [value for value in values if not (isinstance(value, str) and not value)]


def build_task(
    rec: dict[str, Any],
    task_id: str,
    proposal_id: str,
    proposal_row: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    role = str(rec.get("role") or "engine-runner")
    skill = rec.get("skill")
    if not isinstance(skill, str) or not skill:
        raise SystemExit(f"recommended task {task_id} must declare `skill`")
    outputs = rec.get("outputs_expected")
    if not isinstance(outputs, list) or not outputs:
        raise SystemExit(f"recommended task {task_id} must declare non-empty `outputs_expected`")

    producer = proposal_row.get("produced_by")
    depends_on = rec.get("depends_on")
    if depends_on is None:
        depends_on = [producer] if isinstance(producer, str) and producer != "external" else []

    inputs = rec.get("inputs")
    if inputs is None:
        inputs = [{"artifact_id": proposal_id, "min_status": "accepted"}]

    can_read = rec.get("can_read")
    if can_read is None:
        can_read = [{"artifact_id": proposal_id}]

    can_write = rec.get("can_write")
    if can_write is None:
        can_write = default_can_write_entries(outputs)

    provenance = compact_string_list(list_value(rec.get("provenance")))
    provenance.append(proposal_id)
    proposal_path = proposal_row.get("path")
    if isinstance(proposal_path, str) and proposal_path:
        provenance.append(proposal_path)

    task = {
        "schema_version": 1,
        "id": task_id,
        "title": rec.get("title") or f"Follow-up task from {proposal_id}",
        "role": role,
        "role_contract": rec.get("role_contract") or ROLE_CONTRACTS.get(role),
        "skill": skill,
        "status": rec.get("status") or "proposed",
        "stage": rec.get("stage") or "follow-up",
        "wave_id": rec.get("wave_id") or payload.get("wave_id") or f"follow-up-{proposal_id}",
        "iteration": rec.get("iteration") or payload.get("iteration"),
        "source_proposal": proposal_id,
        "follow_up_of": rec.get("follow_up_of")
        or payload.get("source_claim_id")
        or payload.get("resolves_claim")
        or proposal_row.get("source_claim_id")
        or proposal_row.get("resolves_claim"),
        "resolves_follow_up": proposal_id,
        "depends_on": depends_on,
        "approval": rec.get("approval") or default_approval(role),
        "inputs": inputs,
        "can_read": can_read,
        "can_write": can_write,
        "cannot": rec.get("cannot") or ["treat this scaffolded follow-up as resolved before acceptance"],
        "outputs_expected": outputs,
        "success_criteria": rec.get("success_criteria") or ["follow-up proposal is addressed by accepted evidence"],
        "knowledge_required": rec.get("knowledge_required") or [],
        "required_refs": rec.get("required_refs") or skill_ref(skill),
        "required_checks": rec.get("required_checks") or [],
        "release_gates": rec.get("release_gates") or [],
        "execution_policy": rec.get("execution_policy") or default_execution_policy(role),
        "assumptions": rec.get("assumptions") or [],
        "provenance": provenance,
    }
    if task["iteration"] is None:
        task.pop("iteration")
    if task["follow_up_of"] is None:
        task.pop("follow_up_of")
    if task["role_contract"] is None:
        task.pop("role_contract")
    return task


def scaffold_tasks_from_proposal(
    research_dir: Path,
    project_root: Path,
    proposal_id: str,
    *,
    allow_validated: bool = False,
    skip_existing: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    artifacts = load_jsonl(research_dir / "artifacts.jsonl", [], research_dir)
    proposal = active_artifact(artifacts, proposal_id)
    if proposal.get("type") != "follow-up-proposal":
        raise SystemExit(f"artifact is not type follow-up-proposal: {proposal.get('type')}")
    allowed_statuses = {"accepted", "validated"} if allow_validated else {"accepted"}
    if proposal.get("status") not in allowed_statuses:
        raise SystemExit(
            f"proposal {proposal_id} is {proposal.get('status')}, needs one of {sorted(allowed_statuses)}"
        )

    payload = load_payload(proposal, project_root)
    recommended = payload.get("recommended_tasks")
    if not isinstance(recommended, list) or not recommended:
        raise SystemExit(
            "follow-up proposal must provide structured `recommended_tasks` in the artifact row or YAML/JSON file"
        )
    for rec in recommended:
        if not isinstance(rec, dict):
            raise SystemExit("each recommended task must be a mapping")

    tasks = load_tasks(research_dir)
    if skip_existing:
        existing = existing_task_ids_for_proposal(tasks, proposal_id)
        if existing:
            return [], existing

    used_ids = set(tasks)
    missing_ids = [rec for rec in recommended if not isinstance(rec.get("id"), str)]
    generated_ids = iter(next_task_ids(used_ids, len(missing_ids)))
    new_tasks: list[dict[str, Any]] = []
    skipped: list[str] = []
    for rec in recommended:
        task_id = rec.get("id") if isinstance(rec.get("id"), str) else next(generated_ids)
        if task_id in tasks:
            if skip_existing:
                task = tasks[task_id]
                if task.get("source_proposal") == proposal_id or task.get("resolves_follow_up") == proposal_id:
                    skipped.append(task_id)
                    continue
            raise SystemExit(f"refusing to overwrite existing task: {task_id}")
        new_tasks.append(build_task(rec, task_id, proposal_id, proposal, payload))

    for task in new_tasks:
        write_yaml(research_dir / "tasks" / f"{task['id']}.yaml", task)
    return new_tasks, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("proposal_id", help="Accepted follow-up-proposal artifact ID")
    parser.add_argument("--allow-validated", action="store_true", help="Allow validated proposals, not only accepted ones")
    parser.add_argument("--now", help="ISO timestamp for deterministic tests")
    parser.add_argument("--dry-run", action="store_true", help="Print task YAML instead of writing files")
    args = parser.parse_args()

    research_dir, project_root = resolve(args.path)
    fail_if_invalid(research_dir)
    try:
        if args.dry_run:
            artifacts = load_jsonl(research_dir / "artifacts.jsonl", [], research_dir)
            proposal = active_artifact(artifacts, args.proposal_id)
            payload = load_payload(proposal, project_root)
            recommended = payload.get("recommended_tasks")
            if not isinstance(recommended, list) or not recommended:
                raise SystemExit(
                    "follow-up proposal must provide structured `recommended_tasks` in the artifact row or YAML/JSON file"
                )
            tasks = load_tasks(research_dir)
            used_ids = set(tasks)
            missing_ids = [rec for rec in recommended if isinstance(rec, dict) and not isinstance(rec.get("id"), str)]
            generated_ids = iter(next_task_ids(used_ids, len(missing_ids)))
            new_tasks = []
            for rec in recommended:
                if not isinstance(rec, dict):
                    raise SystemExit("each recommended task must be a mapping")
                task_id = rec.get("id") if isinstance(rec.get("id"), str) else next(generated_ids)
                if task_id in tasks:
                    raise SystemExit(f"refusing to overwrite existing task: {task_id}")
                new_tasks.append(build_task(rec, task_id, args.proposal_id, proposal, payload))
        else:
            new_tasks, _skipped = scaffold_tasks_from_proposal(
                research_dir,
                project_root,
                args.proposal_id,
                allow_validated=args.allow_validated,
            )
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 1

    if args.dry_run:
        for task in new_tasks:
            print("---")
            print(yaml.safe_dump(task, sort_keys=False, allow_unicode=False), end="")
        return 0

    now = parse_time(args.now) if args.now else now_local()
    append_event(
        research_dir,
        {
            "event": "follow_up_tasks_scaffolded",
            "artifact_id": args.proposal_id,
            "task_ids": [task["id"] for task in new_tasks],
            "created_at": iso(now),
        },
    )
    fail_if_invalid(research_dir)
    print("created follow-up task(s): " + ", ".join(task["id"] for task in new_tasks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
