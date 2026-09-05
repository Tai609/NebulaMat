#!/usr/bin/env python3
"""Thin ARIS adapter around the installed deepxiv CLI."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from typing import Sequence


INSTALL_MESSAGE = "deepxiv CLI not found. Install it with: pip install deepxiv-sdk"


def ensure_deepxiv_installed() -> dict[str, object]:
    """Check whether the deepxiv CLI is available on PATH."""
    binary = shutil.which("deepxiv")
    if binary:
        return {"ok": True, "binary": binary, "message": ""}
    return {"ok": False, "binary": None, "message": INSTALL_MESSAGE}


def _run_cli(args: Sequence[str]) -> subprocess.CompletedProcess[str]:
    install = ensure_deepxiv_installed()
    if not install["ok"]:
        raise RuntimeError(str(install["message"]))

    return subprocess.run(
        [str(install["binary"]), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def _raise_for_failed_process(proc: subprocess.CompletedProcess[str]) -> None:
    if proc.returncode == 0:
        return
    message = (proc.stderr or proc.stdout or "deepxiv command failed").strip()
    raise RuntimeError(message)


def run_cli_json(args: Sequence[str]) -> dict | list:
    """Run the deepxiv CLI and decode stdout as JSON."""
    proc = _run_cli(args)
    _raise_for_failed_process(proc)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("deepxiv returned invalid JSON output") from exc


def run_cli_text(args: Sequence[str]) -> str:
    """Run the deepxiv CLI and return trimmed stdout."""
    proc = _run_cli(args)
    _raise_for_failed_process(proc)
    return proc.stdout.strip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ARIS wrapper around the installed deepxiv CLI."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="Search papers through DeepXiv.")
    search.add_argument("query")
    search.add_argument("--max", type=int, default=10, dest="max_results")
    search.add_argument(
        "--mode",
        default="hybrid",
        choices=("bm25", "vector", "hybrid"),
    )
    search.add_argument("--categories")
    search.add_argument("--min-citations", type=int, dest="min_citations")
    search.add_argument("--date-from", dest="date_from")
    search.add_argument("--date-to", dest="date_to")

    brief = subparsers.add_parser(
        "paper-brief",
        help="Fetch brief paper metadata and TLDR.",
    )
    brief.add_argument("arxiv_id")

    head = subparsers.add_parser(
        "paper-head",
        help="Fetch paper metadata and section overview.",
    )
    head.add_argument("arxiv_id")

    section = subparsers.add_parser(
        "paper-section",
        help="Fetch one paper section.",
    )
    section.add_argument("arxiv_id")
    section.add_argument("section_name")

    trending = subparsers.add_parser(
        "trending",
        help="Fetch trending papers.",
    )
    trending.add_argument("--days", default="7", choices=("7", "14", "30"))
    trending.add_argument("--max", type=int, default=10, dest="max_results")

    wsearch = subparsers.add_parser(
        "wsearch",
        help="Search the web through DeepXiv.",
    )
    wsearch.add_argument("query")

    sc = subparsers.add_parser(
        "sc",
        help="Fetch Semantic Scholar metadata by ID.",
    )
    sc.add_argument("semantic_scholar_id")

    health = subparsers.add_parser(
        "health",
        help="Run DeepXiv health check.",
    )
    health.add_argument("--json", action="store_true", help="Return JSON wrapper.")

    return parser


def _dispatch_json(args: argparse.Namespace) -> dict | list:
    if args.command == "search":
        cli_args = [
            "search",
            args.query,
            "--limit",
            str(args.max_results),
            "--mode",
            args.mode,
            "--format",
            "json",
        ]
        if args.categories:
            cli_args.extend(["--categories", args.categories])
        if args.min_citations is not None:
            cli_args.extend(["--min-citations", str(args.min_citations)])
        if args.date_from:
            cli_args.extend(["--date-from", args.date_from])
        if args.date_to:
            cli_args.extend(["--date-to", args.date_to])
        return run_cli_json(cli_args)

    if args.command == "paper-brief":
        return run_cli_json(["paper", args.arxiv_id, "--brief", "--format", "json"])

    if args.command == "paper-head":
        return run_cli_json(["paper", args.arxiv_id, "--head", "--format", "json"])

    if args.command == "paper-section":
        return run_cli_json(
            [
                "paper",
                args.arxiv_id,
                "--section",
                args.section_name,
                "--format",
                "json",
            ]
        )

    if args.command == "trending":
        return run_cli_json(
            [
                "trending",
                "--days",
                str(args.days),
                "--limit",
                str(args.max_results),
                "--output",
                "json",
            ]
        )

    if args.command == "wsearch":
        return run_cli_json(["wsearch", args.query, "--output", "json"])

    if args.command == "sc":
        return run_cli_json(["sc", args.semantic_scholar_id, "--output", "json"])

    if args.command == "health":
        text = run_cli_text(["health"])
        return {"ok": True, "output": text}

    raise RuntimeError(f"Unsupported command: {args.command}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        payload = _dispatch_json(args)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.command == "health" and not args.json:
        print(payload["output"])
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
