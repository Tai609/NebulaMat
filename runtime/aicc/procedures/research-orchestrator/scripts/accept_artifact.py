#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Record validation, acceptance, or rejection for a registered artifact."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from lease_utils import append_decision, append_event, fail_if_invalid, iso, now_local, parse_time, resolve
from validate_state import load_jsonl


ALLOWED_STATUS = {"validated", "accepted", "rejected"}


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def active_artifact_index(rows: list[dict[str, Any]], artifact_id: str) -> int:
    matches = [
        idx
        for idx, row in enumerate(rows)
        if row.get("artifact_id") == artifact_id and row.get("status") != "superseded"
    ]
    if not matches:
        raise SystemExit(f"active artifact not found: {artifact_id}")
    if len(matches) > 1:
        raise SystemExit(f"multiple active artifact rows found: {artifact_id}")
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("artifact_id", help="Artifact ID to update")
    parser.add_argument("--status", required=True, choices=sorted(ALLOWED_STATUS))
    parser.add_argument("--by", default="orchestrator", help="Decision author")
    parser.add_argument("--reason", required=True, help="Reason for the status change")
    parser.add_argument("--evidence", action="append", default=[], help="Evidence path, command, task, or decision ID")
    parser.add_argument("--now", help="ISO timestamp for deterministic tests")
    args = parser.parse_args()

    research_dir, _project_root = resolve(args.path)
    fail_if_invalid(research_dir)
    artifacts_path = research_dir / "artifacts.jsonl"
    rows = load_jsonl(artifacts_path, [], research_dir)
    idx = active_artifact_index(rows, args.artifact_id)
    artifact = rows[idx]
    old_status = artifact.get("status")
    now = parse_time(args.now) if args.now else now_local()
    kind = {
        "validated": "validation",
        "accepted": "acceptance",
        "rejected": "rejection",
    }[args.status]
    decision_id = append_decision(
        research_dir,
        {
            "kind": kind,
            "decision": args.status,
            "by": args.by,
            "artifact_id": args.artifact_id,
            "reason": args.reason,
            "evidence": args.evidence,
            "created_at": iso(now),
        },
    )
    artifact["status"] = args.status
    if args.status == "validated":
        validated_by = artifact.get("validated_by")
        if not isinstance(validated_by, list):
            validated_by = []
        validated_by.append(decision_id)
        artifact["validated_by"] = validated_by
    elif args.status == "accepted":
        artifact["accepted_by"] = decision_id
    elif args.status == "rejected":
        artifact["rejected_by"] = decision_id
    rows[idx] = artifact
    write_jsonl(artifacts_path, rows)
    append_event(
        research_dir,
        {
            "event": "status_changed",
            "artifact_id": args.artifact_id,
            "from": old_status,
            "to": args.status,
            "decision_id": decision_id,
            "created_at": iso(now),
        },
    )
    fail_if_invalid(research_dir)
    print(f"{args.artifact_id}: {old_status} -> {args.status} ({decision_id})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
