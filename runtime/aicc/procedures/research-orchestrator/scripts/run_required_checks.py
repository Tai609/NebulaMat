#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Run a task's declared required_checks from the project root."""

from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

from lease_utils import append_event, fail_if_invalid, iso, now_local, parse_time, resolve
from validate_state import load_yaml, rel


UNSUPPORTED_SHELL_TOKENS = {"&&", "||", ";", "|", ">", ">>", "<", "2>", "2>>"}
REPO_ROOT = Path(__file__).resolve().parents[3]


def task_path(research_dir: Path, task_id: str) -> Path:
    return research_dir / "tasks" / f"{task_id}.yaml"


def load_task(research_dir: Path, task_id: str) -> dict[str, Any]:
    path = task_path(research_dir, task_id)
    if not path.is_file():
        raise SystemExit(f"task not found: {rel(path, research_dir)}")
    return load_yaml(path, [], research_dir)


def command_tokens(raw: Any, project_root: Path) -> list[str]:
    if isinstance(raw, str):
        tokens = shlex.split(raw)
    elif isinstance(raw, list) and all(isinstance(item, str) for item in raw):
        tokens = list(raw)
    else:
        raise SystemExit("required_checks entries must be strings or lists of strings")
    if not tokens:
        raise SystemExit("required_checks entry is empty")
    if any(token in UNSUPPORTED_SHELL_TOKENS for token in tokens):
        raise SystemExit(
            "required_checks do not run through a shell; put compound logic in a script "
            "instead of using shell metacharacters"
        )
    replacements = {
        "{repo_root}": REPO_ROOT.as_posix(),
        "{project_root}": project_root.as_posix(),
    }
    expanded: list[str] = []
    for token in tokens:
        for old, new in replacements.items():
            token = token.replace(old, new)
        expanded.append(token)
    return expanded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("task_id", help="Task ID whose required_checks should run")
    parser.add_argument("--dry-run", action="store_true", help="Print commands without running them")
    parser.add_argument("--now", help="ISO timestamp for recorded events; defaults to current local time")
    args = parser.parse_args()

    research_dir, project_root = resolve(args.path)
    fail_if_invalid(research_dir)
    task = load_task(research_dir, args.task_id)
    checks = task.get("required_checks") or []
    if not isinstance(checks, list):
        raise SystemExit("`required_checks` must be a list")
    if not checks:
        print(f"{args.task_id}: no required_checks declared")
        return 0

    now = iso(parse_time(args.now) if args.now is not None else now_local())

    for idx, raw in enumerate(checks, 1):
        tokens = command_tokens(raw, project_root)
        printable = shlex.join(tokens)
        print(f"CHECK {idx}/{len(checks)} {args.task_id}: {printable}")
        if args.dry_run:
            continue
        result = subprocess.run(tokens, cwd=project_root, text=True, capture_output=True)
        event = {
            "task_id": args.task_id,
            "event": "required_check_passed" if result.returncode == 0 else "required_check_failed",
            "created_at": now,
            "command": printable,
            "exit_status": result.returncode,
        }
        append_event(research_dir, event)
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        if result.returncode != 0:
            print(f"FAIL required_check {idx}: exit {result.returncode}", file=sys.stderr)
            return result.returncode
        print(f"PASS required_check {idx}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
