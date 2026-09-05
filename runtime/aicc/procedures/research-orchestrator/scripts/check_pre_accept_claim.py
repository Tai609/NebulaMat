#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Block scientific-claim acceptance unless the result gate supports the outcome."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from gate_hook_utils import load_state, matching_gate_artifacts, require_passing_gate


OUTCOMES = {"addresses", "contradicts", "inconclusive", "needs-follow-up"}


def gate_scope_mentions_claim(gate: dict[str, object], claim_id: str) -> bool:
    scope = gate.get("scope")
    if not isinstance(scope, dict):
        return False
    for key in ["claims", "artifacts", "artifact_ids"]:
        value = scope.get(key)
        if isinstance(value, list) and claim_id in value:
            return True
        if isinstance(value, str) and claim_id == value:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("claim_id", help="Scientific-claim artifact ID")
    parser.add_argument("--outcome", required=True, choices=sorted(OUTCOMES), help="Outcome to classify/accept")
    parser.add_argument(
        "--gate-artifact",
        help="Specific result gate artifact ID. Defaults to any accepted result_gate whose scope names the claim.",
    )
    args = parser.parse_args()

    research_dir, project_root, _tasks, artifacts = load_state(Path(args.path))
    claim = artifacts.get(args.claim_id)
    if claim is None:
        print(f"pre_accept_claim blocked: claim artifact not found: {args.claim_id}", file=sys.stderr)
        return 1
    if claim.get("type") != "scientific-claim":
        print(f"pre_accept_claim blocked: artifact is not scientific-claim: {claim.get('type')}", file=sys.stderr)
        return 1

    if args.gate_artifact:
        candidate_ids = {args.gate_artifact}
    else:
        scoped_matches = [
            row.get("artifact_id")
            for row, _path, gate in matching_gate_artifacts(artifacts, project_root, "result_gate")
            if isinstance(row.get("artifact_id"), str) and gate_scope_mentions_claim(gate, args.claim_id)
        ]
        candidate_ids = set(scoped_matches)
        if not candidate_ids:
            print(f"pre_accept_claim blocked: no result_gate scope names claim {args.claim_id}", file=sys.stderr)
            return 1
    try:
        row, path, gate = require_passing_gate(
            artifacts,
            project_root,
            research_dir,
            "result_gate",
            candidate_ids=candidate_ids,
            context="pre_accept_claim",
        )
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 1

    if not gate_scope_mentions_claim(gate, args.claim_id):
        print(f"pre_accept_claim blocked: result_gate scope does not name claim {args.claim_id}", file=sys.stderr)
        return 1

    gate_outcome = gate.get("claim_outcome")
    if gate_outcome != args.outcome:
        print(
            f"pre_accept_claim blocked: gate supports `{gate_outcome}`, requested `{args.outcome}`",
            file=sys.stderr,
        )
        return 1

    if args.outcome == "needs-follow-up":
        print("pre_accept_claim blocked: `needs-follow-up` is not an accepted reportable claim", file=sys.stderr)
        return 1

    print(f"pre_accept_claim: passed via {row.get('artifact_id')} ({path.relative_to(project_root).as_posix()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
