#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Initialize a minimal `.research/` project state directory."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from validate_state import validate


DEFAULT_APPROVALS = [
    "expensive_hpc_submission",
    "scientific_model_choice",
    "overwrite_existing_data",
    "promote_claim_to_report",
]


def now_local() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()


def write_yaml(path: Path, obj: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(obj, sort_keys=False, allow_unicode=False), encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def default_project(args: argparse.Namespace, created_at: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "project_id": args.project_id,
        "title": args.title,
        "mode": args.mode,
        "created_at": created_at,
        "objective": args.objective,
        "success_criteria": [args.success_criterion],
        "default_policy": {
            "approval_required_for": DEFAULT_APPROVALS,
        },
    }


def default_task(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "id": "T001",
        "title": "Define computational scope and success criteria",
        "role": "research-orchestrator",
        "role_contract": "procedures/research-orchestrator/references/roles.md#research-orchestrator",
        "skill": "comp-chem-workflow",
        "status": "proposed",
        "depends_on": [],
        "approval": "none",
        "inputs": [],
        "can_read": [],
        "can_write": [
            {"artifact_type": "task-plan"},
            {"artifact_type": "decision-record"},
        ],
        "cannot": [
            "submit HPC jobs",
            "invent scientific parameters",
        ],
        "outputs_expected": [
            {
                "artifact_id": "initial-task-plan",
                "type": "task-plan",
                "path": "work/initial-task-plan.md",
            }
        ],
        "success_criteria": [
            "objective is concrete",
            "approval gates are explicit",
            "next executable task is represented in .research/tasks",
        ],
        "knowledge_required": [],
        "required_refs": [
            "procedures/comp-chem-workflow/SKILL.md",
            "procedures/research-orchestrator/SKILL.md",
        ],
        "required_checks": [],
        "release_gates": [],
        "execution_policy": {
            "mode": "single_owner",
            "allow_parallel_subagents": False,
        },
        "assumptions": [],
        "provenance": [],
    }


def write_workflow(project_root: Path, args: argparse.Namespace) -> None:
    workflow = project_root / "workflow.md"
    if workflow.exists() and not args.with_workflow:
        return
    workflow.write_text(
        "\n".join(
            [
                f"# workflow: {args.title}",
                "",
                f"- project_id: {args.project_id}",
                f"- mode: {args.mode}",
                f"- objective: {args.objective}",
                f"- success criteria: {args.success_criterion}",
                "- state: .research/",
                "",
                "## Current state",
                "",
                "| task | status | next |",
                "|---|---|---|",
                "| T001 | proposed | define scope and downstream tasks |",
                "",
            ]
        ),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Project root to initialize")
    parser.add_argument("--project-id", required=True, help="Stable project ID")
    parser.add_argument("--title", required=True, help="Human-readable title")
    parser.add_argument("--objective", required=True, help="Scientific or workflow objective")
    parser.add_argument("--success-criterion", default="initial .research state validates")
    parser.add_argument("--mode", choices=["semi-automatic", "autonomous"], default="semi-automatic")
    parser.add_argument("--created-at", help="ISO timestamp; defaults to local current time")
    parser.add_argument("--without-initial-task", action="store_true", help="Create no T001 task")
    parser.add_argument("--with-workflow", action="store_true", help="Also create/update workflow.md")
    args = parser.parse_args()

    project_root = Path(args.path).resolve()
    research_dir = project_root / ".research"
    if research_dir.exists():
        print(f"refusing to overwrite existing state: {research_dir}", file=sys.stderr)
        return 1

    project_root.mkdir(parents=True, exist_ok=True)
    (research_dir / "tasks").mkdir(parents=True)
    (research_dir / "leases").mkdir()
    (project_root / "work").mkdir(exist_ok=True)

    created_at = args.created_at or now_local()
    write_yaml(research_dir / "project.yaml", default_project(args, created_at))
    if not args.without_initial_task:
        write_yaml(research_dir / "tasks" / "T001.yaml", default_task(args))
    write_jsonl(research_dir / "artifacts.jsonl", [])
    write_jsonl(research_dir / "decisions.jsonl", [])
    write_jsonl(research_dir / "events.jsonl", [])
    if args.with_workflow:
        write_workflow(project_root, args)

    findings = validate(research_dir)
    failures = [finding for finding in findings if finding.level == "FAIL"]
    if failures:
        for finding in findings:
            print(f"{finding.level}  {finding.path}  {finding.message}")
        return 1
    print(f"initialized {research_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
