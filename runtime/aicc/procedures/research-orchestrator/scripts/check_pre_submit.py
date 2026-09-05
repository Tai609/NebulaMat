#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Block engine/HPC submission unless pre-submit gates and site evidence passed."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from gate_hook_utils import artifact_path, load_state, require_passing_gate, task_input_artifact_ids


STRUCTURE_GATE_PRODUCER_ROLES = {"structure-critic", "surface-literature-reviewer"}
CLUSTER_GUIDE_READ_TYPE = "cluster-guide-read"
CLUSTER_GUIDE_PATH_TOKEN = ".cluster-agents.md"


def require_structure_gate_reviewer(row: dict, tasks: dict[str, dict]) -> None:
    artifact_id = row.get("artifact_id")
    produced_by = row.get("produced_by")
    task = tasks.get(produced_by) if isinstance(produced_by, str) else None
    role = task.get("role") if task is not None else None
    if role not in STRUCTURE_GATE_PRODUCER_ROLES:
        raise SystemExit(
            "pre_submit blocked: structure_gate artifact "
            f"`{artifact_id}` must be produced by an independent reviewer role "
            f"{sorted(STRUCTURE_GATE_PRODUCER_ROLES)}, not `{role or produced_by}`"
        )


def normalize_evidence_key(key: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(key).strip().lower()).strip("_")


def flatten_mapping(prefix: str, value: Any, out: dict[str, Any]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            key_token = normalize_evidence_key(key)
            next_prefix = f"{prefix}_{key_token}" if prefix else key_token
            flatten_mapping(next_prefix, nested, out)
    elif prefix:
        out[prefix] = value


def load_cluster_guide_evidence(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    fields: dict[str, Any] = {}
    stripped = text.lstrip()
    parsed: Any = None
    if stripped.startswith("{"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
    if isinstance(parsed, dict):
        flatten_mapping("", parsed, fields)

    # Also support lightweight Markdown/key-value evidence files.
    for line in text.splitlines():
        match = re.match(r"\s*(?:[-*]\s*)?([^:#][^:]{1,80}):\s*(.+?)\s*$", line)
        if not match:
            continue
        key = normalize_evidence_key(match.group(1))
        fields.setdefault(key, match.group(2).strip())
    return fields


def first_field(fields: dict[str, Any], *names: str) -> Any:
    for name in names:
        key = normalize_evidence_key(name)
        if key in fields and fields[key] not in (None, ""):
            return fields[key]
    return None


def parse_positive_int(value: Any) -> int | None:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def parse_float(value: Any) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def evidence_is_remote(fields: dict[str, Any], guide_path: str) -> bool:
    context = str(first_field(fields, "target_context") or "").lower()
    path_lower = guide_path.lower()
    return "remote" in context or path_lower.startswith(("remote:", "ssh:"))


def local_guide_path(project_root: Path, guide_path: str) -> Path:
    token = re.sub(r"^(remote|ssh):", "", guide_path, flags=re.IGNORECASE)
    expanded = Path(os.path.expanduser(token))
    if expanded.is_absolute():
        return expanded
    return (project_root / expanded).resolve()


def require_cluster_guide_evidence_content(path: Path, project_root: Path) -> None:
    fields = load_cluster_guide_evidence(path)
    problems: list[str] = []

    guide_path_value = first_field(fields, "guide_path", "guide_path_read", "guide")
    guide_path = str(guide_path_value).strip() if guide_path_value is not None else ""
    if not guide_path:
        problems.append("missing `guide_path`")
    elif CLUSTER_GUIDE_PATH_TOKEN not in guide_path:
        problems.append(f"`guide_path` must name `{CLUSTER_GUIDE_PATH_TOKEN}`")

    if first_field(fields, "read_timestamp", "read_time", "timestamp") is None:
        problems.append("missing `read_timestamp`")

    guide_size = parse_positive_int(
        first_field(
            fields,
            "guide_size_bytes",
            "guide_stat_size_bytes",
            "guide_file_size_bytes",
            "size_bytes",
        )
    )
    if guide_size is None:
        problems.append("missing positive integer `guide_size_bytes`")

    if guide_path and guide_size is not None and not evidence_is_remote(fields, guide_path):
        resolved = local_guide_path(project_root, guide_path)
        if not resolved.is_file():
            problems.append(f"`guide_path` is not readable on this host: {guide_path}")
        else:
            actual_size = resolved.stat().st_size
            if actual_size != guide_size:
                problems.append(
                    f"`guide_size_bytes` mismatch for {guide_path}: "
                    f"evidence={guide_size}, actual={actual_size}"
                )
            mtime_value = parse_float(
                first_field(fields, "guide_mtime_epoch", "guide_stat_mtime_epoch", "mtime_epoch")
            )
            if mtime_value is not None and abs(resolved.stat().st_mtime - mtime_value) > 2.0:
                problems.append(f"`guide_mtime_epoch` does not match current {guide_path}")

    if problems:
        raise SystemExit(
            "pre_submit blocked: invalid `cluster-guide-read` evidence "
            f"{path.relative_to(project_root).as_posix()}: " + "; ".join(problems)
        )


def require_cluster_guide_read(
    artifacts: dict[str, dict],
    project_root: Path,
    candidate_ids: set[str],
) -> tuple[dict, Path]:
    problems: list[str] = []
    for artifact_id in sorted(candidate_ids):
        row = artifacts.get(artifact_id)
        if row is None:
            continue
        if row.get("type") != CLUSTER_GUIDE_READ_TYPE:
            continue
        if row.get("status") != "accepted":
            problems.append(f"{artifact_id} is {row.get('status')}, needs accepted")
            continue
        path = artifact_path(row, project_root)
        try:
            path.relative_to(project_root.resolve())
        except ValueError:
            problems.append(f"{artifact_id} path escapes project root")
            continue
        if not path.is_file():
            problems.append(f"{artifact_id} path does not exist: {row.get('path')}")
            continue
        try:
            require_cluster_guide_evidence_content(path, project_root)
        except SystemExit as exc:
            problems.append(str(exc))
            continue
        return row, path
    detail = f" Problems: {'; '.join(problems)}" if problems else ""
    raise SystemExit(
        "pre_submit blocked: no accepted `cluster-guide-read` artifact found in "
        "the task inputs. Before preparing or submitting a Slurm/PBS/local batch job, "
        "read the target `~/.cluster-agents.md` (local when already on the cluster, "
        "remote after login otherwise) and register a short evidence file that records "
        "the guide path, target host/context, read timestamp, `guide_size_bytes`, "
        "and the site settings used for this task. Do not copy private guide contents "
        "into the artifact."
        f"{detail}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("task_id", help="Engine/HPC task ID")
    args = parser.parse_args()

    research_dir, project_root, tasks, artifacts = load_state(Path(args.path))
    task = tasks.get(args.task_id)
    if task is None:
        print(f"pre_submit blocked: task not found: {args.task_id}", file=sys.stderr)
        return 1
    candidate_ids = task_input_artifact_ids(task)
    if not candidate_ids:
        print(
            f"pre_submit blocked: task {args.task_id} declares no artifact inputs. "
            "Engine/HPC tasks should consume an accepted structure gate and an accepted cluster-guide-read artifact; "
            "structure inspection or model-building tasks should not call this hook.",
            file=sys.stderr,
        )
        return 1

    try:
        row, path, _gate = require_passing_gate(
            artifacts,
            project_root,
            research_dir,
            "structure_gate",
            candidate_ids=candidate_ids,
            context="pre_submit",
        )
        require_structure_gate_reviewer(row, tasks)
        guide_row, guide_path = require_cluster_guide_read(artifacts, project_root, candidate_ids)
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 1

    print(
        "pre_submit: passed via "
        f"{row.get('artifact_id')} ({path.relative_to(project_root).as_posix()}) "
        "and "
        f"{guide_row.get('artifact_id')} ({guide_path.relative_to(project_root).as_posix()})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
