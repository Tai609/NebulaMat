#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Classify a scientific-claim artifact and record the critic decision."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from lease_utils import append_decision, append_event, fail_if_invalid, iso, now_local, parse_time, resolve
from validate_state import load_jsonl


OUTCOMES = {"addresses", "contradicts", "inconclusive", "needs-follow-up"}
STATUSES = {"draft", "accepted", "rejected"}


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


def default_status(outcome: str) -> str:
    if outcome in {"addresses", "contradicts"}:
        return "accepted"
    return "draft"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("artifact_id", help="Scientific-claim artifact ID")
    parser.add_argument("--outcome", required=True, choices=sorted(OUTCOMES))
    parser.add_argument("--status", choices=sorted(STATUSES), help="Artifact status; defaults from outcome")
    parser.add_argument("--by", default="critic", help="Decision author")
    parser.add_argument("--reason", required=True, help="Reason for the classification")
    parser.add_argument("--evidence", action="append", default=[], help="Evidence artifact, path, or decision ID")
    parser.add_argument("--now", help="ISO timestamp for deterministic tests")
    args = parser.parse_args()

    research_dir, _project_root = resolve(args.path)
    fail_if_invalid(research_dir)
    artifacts_path = research_dir / "artifacts.jsonl"
    rows = load_jsonl(artifacts_path, [], research_dir)
    idx = active_artifact_index(rows, args.artifact_id)
    artifact = rows[idx]
    if artifact.get("type") != "scientific-claim":
        print(f"artifact is not type scientific-claim: {artifact.get('type')}", file=sys.stderr)
        return 1
    old_status = artifact.get("status")
    status = args.status or default_status(args.outcome)
    now = parse_time(args.now) if args.now else now_local()
    decision_id = append_decision(
        research_dir,
        {
            "kind": "claim-classification",
            "decision": args.outcome,
            "by": args.by,
            "artifact_id": args.artifact_id,
            "reason": args.reason,
            "evidence": args.evidence,
            "created_at": iso(now),
        },
    )
    artifact["claim_outcome"] = args.outcome
    artifact["classified_by"] = decision_id
    artifact["status"] = status
    if status == "accepted":
        artifact["accepted_by"] = decision_id
    elif status == "rejected":
        artifact["rejected_by"] = decision_id
    rows[idx] = artifact
    write_jsonl(artifacts_path, rows)
    append_event(
        research_dir,
        {
            "event": "claim_classified",
            "artifact_id": args.artifact_id,
            "decision_id": decision_id,
            "outcome": args.outcome,
            "created_at": iso(now),
        },
    )
    if old_status != status:
        append_event(
            research_dir,
            {
                "event": "status_changed",
                "artifact_id": args.artifact_id,
                "from": old_status,
                "to": status,
                "decision_id": decision_id,
                "created_at": iso(now),
            },
        )
    fail_if_invalid(research_dir)
    print(f"{args.artifact_id}: {args.outcome}, status {old_status} -> {status} ({decision_id})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
