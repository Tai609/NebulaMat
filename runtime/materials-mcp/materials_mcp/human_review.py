"""Small desktop bridge for human-owned DFT review actions.

The MCP server is stdio-oriented, while the desktop review panel needs a
request/response boundary. This module deliberately exposes only the two
read/write operations required by that panel and delegates all validation to
the workflow coordinator.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .workflow import MaterialsDAGCoordinator


def _coordinator(workspace: str | None = None) -> MaterialsDAGCoordinator:
    return MaterialsDAGCoordinator(Path(workspace or Path.cwd()).resolve())


_COMMANDS = frozenset(("get", "claim", "list", "review"))


def _normalize_argv(argv: list[str] | None) -> list[str]:
    """Accept the legacy ``<workspace> <command> ...`` invocation too.

    Older desktop builds passed the scoped workspace as the first argument,
    while the current parser uses the explicit ``--workspace`` option.  Put
    the option in the canonical position before argparse sees the arguments so
    both builds can talk to the same bundled module.
    """
    raw = list(sys.argv[1:] if argv is None else argv)
    if raw and not raw[0].startswith("-") and raw[0] not in _COMMANDS:
        return ["--workspace", raw[0], *raw[1:]]
    return raw


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="materials-dft-human-review")
    parser.add_argument("--workspace", default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)

    get_parser = subparsers.add_parser("get")
    get_parser.add_argument("workflow_id")

    claim_parser = subparsers.add_parser("claim")
    claim_parser.add_argument("workflow_id")
    claim_parser.add_argument("task_id")
    claim_parser.add_argument("actor")

    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("--dft-only", action="store_true")

    review_parser = subparsers.add_parser("review")
    review_parser.add_argument("workflow_id")
    review_parser.add_argument("task_id")
    review_parser.add_argument("actor")
    review_parser.add_argument("decision", choices=("approved", "changes_requested", "rejected"))
    review_parser.add_argument("--note", default="")
    review_parser.add_argument("--requested-changes", default="[]")
    args = parser.parse_args(_normalize_argv(argv))

    try:
        coordinator = _coordinator(args.workspace)
        if args.command == "list":
            rows: list[dict[str, Any]] = []
            store = coordinator.store
            for path in sorted(store.glob("mw_*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if args.dft_only and not data.get("include_dft"):
                    continue
                if args.dft_only:
                    review_tasks = [
                        task for task in data.get("tasks", [])
                        if isinstance(task, dict)
                        and str(task.get("task_id", "")).startswith("dft:human-review")
                    ]
                    if not review_tasks or review_tasks[-1].get("status") not in {"pending", "running"}:
                        continue
                    latest_review = review_tasks[-1]
                    if latest_review.get("status") == "pending":
                        try:
                            ready_ids = {
                                str(task.get("task_id"))
                                for task in coordinator.ready_tasks(str(data.get("workflow_id")))
                            }
                        except Exception:
                            continue
                        if str(latest_review.get("task_id")) not in ready_ids:
                            continue
                rows.append({
                    "workflow_id": data.get("workflow_id"),
                    "goal": data.get("goal", ""),
                    "stage": data.get("stage"),
                    "status": data.get("status"),
                    "workflow_template": data.get("workflow_template"),
                    "task_count": len(data.get("tasks", [])) if isinstance(data.get("tasks", []), list) else 0,
                    "include_dft": bool(data.get("include_dft")),
                    "response_language": data.get("response_language", "en"),
                    "updated_at": data.get("updated_at"),
                })
            result = {"workflows": rows}
        elif args.command == "claim":
            result = coordinator.claim_task(args.workflow_id, args.task_id, args.actor)
        elif args.command == "get":
            result: dict[str, Any] = coordinator.get(args.workflow_id)
        else:
            try:
                requested_changes = json.loads(args.requested_changes)
            except json.JSONDecodeError as exc:
                raise ValueError("requested changes must be a JSON array") from exc
            if not isinstance(requested_changes, list):
                raise ValueError("requested changes must be a JSON array")
            result = coordinator.record_dft_human_review(
                args.workflow_id,
                args.task_id,
                args.actor,
                args.decision,
                args.note,
                [str(item) for item in requested_changes],
            )
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except Exception as exc:  # CLI boundary: return a readable, non-zero error.
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
