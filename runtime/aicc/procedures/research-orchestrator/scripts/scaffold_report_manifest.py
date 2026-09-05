#!/usr/bin/env python3
"""Scaffold a report-builder manifest from accepted `.research` artifacts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from lease_utils import fail_if_invalid, resolve
from validate_state import load_jsonl, load_yaml


def include_artifact(row: dict[str, Any], include_draft: bool, include_rejected: bool) -> bool:
    status = row.get("status")
    if status == "accepted":
        return True
    if status == "draft" and include_draft:
        return True
    if status == "rejected" and include_rejected:
        return True
    return False


def claim_rows(artifacts: list[dict[str, Any]], include_draft: bool, include_rejected: bool) -> list[dict[str, Any]]:
    rows = [
        row
        for row in artifacts
        if row.get("type") == "scientific-claim" and include_artifact(row, include_draft, include_rejected)
    ]
    return sorted(rows, key=lambda row: str(row.get("artifact_id", "")))


def artifact_index_rows(artifacts: list[dict[str, Any]]) -> list[list[str]]:
    active = [row for row in artifacts if row.get("status") != "superseded"]
    active.sort(key=lambda row: str(row.get("artifact_id", "")))
    return [
        [
            str(row.get("artifact_id", "")),
            str(row.get("type", "")),
            str(row.get("status", "")),
            str(row.get("path", "")),
            ", ".join(str(item) for item in row.get("provenance", [])),
        ]
        for row in active
    ]


def make_manifest(
    project: dict[str, Any],
    artifacts: list[dict[str, Any]],
    include_draft: bool,
    include_rejected: bool,
) -> dict[str, Any]:
    claims = claim_rows(artifacts, include_draft, include_rejected)
    title = f"Research report: {project.get('title', project.get('project_id', 'project'))}"
    sections: list[dict[str, Any]] = [
        {
            "heading": "Summary",
            "level": 1,
            "paragraphs": [
                f"Objective: {project.get('objective', '')}",
                "This manifest was scaffolded from .research artifacts. Treat the generated docx as a draft for human review.",
            ],
            "tables": [
                {
                    "caption": "Scientific claims available for report synthesis.",
                    "columns": ["Artifact", "Outcome", "Status", "Path", "Accepted/Classified by"],
                    "rows": [
                        [
                            str(row.get("artifact_id", "")),
                            str(row.get("claim_outcome", "")),
                            str(row.get("status", "")),
                            str(row.get("path", "")),
                            str(row.get("accepted_by") or row.get("classified_by") or ""),
                        ]
                        for row in claims
                    ],
                }
            ],
        }
    ]
    for row in claims:
        summary = row.get("summary") or f"Claim artifact path: {row.get('path', '')}"
        outcome = row.get("claim_outcome") or "unclassified"
        sections.append(
            {
                "heading": f"Claim: {row.get('artifact_id', '')}",
                "level": 1,
                "paragraphs": [
                    f"Outcome: {outcome}.",
                    str(summary),
                    "Limitations and manuscript/report wording should be checked by the scientific owner before submission.",
                ],
            }
        )
    sections.append(
        {
            "heading": "Calculation Directory Index",
            "level": 1,
            "paragraphs": [
                "This table maps registered artifacts to project paths and provenance for audit and archival."
            ],
            "tables": [
                {
                    "caption": "Registered active artifacts and provenance.",
                    "columns": ["Artifact", "Type", "Status", "Path", "Provenance"],
                    "rows": artifact_index_rows(artifacts),
                }
            ],
        }
    )
    return {
        "title": title,
        "subtitle": "Scaffolded from .research; draft for human editing",
        "sections": sections,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("-o", "--out", default="work/report-manifest.json")
    parser.add_argument("--include-draft", action="store_true", help="Include draft scientific claims")
    parser.add_argument("--include-rejected", action="store_true", help="Include rejected scientific claims")
    args = parser.parse_args()

    research_dir, project_root = resolve(args.path)
    fail_if_invalid(research_dir)
    project = load_yaml(research_dir / "project.yaml", [], research_dir)
    artifacts = load_jsonl(research_dir / "artifacts.jsonl", [], research_dir)
    manifest = make_manifest(project, artifacts, args.include_draft, args.include_rejected)
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = project_root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
