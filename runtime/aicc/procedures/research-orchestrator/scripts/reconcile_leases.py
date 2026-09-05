#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Report or mark stale active leases."""

from __future__ import annotations

import argparse
import sys

from lease_utils import (
    active_leases,
    append_event,
    fail_if_invalid,
    iso,
    lease_path,
    load_tasks,
    now_local,
    parse_time,
    resolve,
    write_json_atomic,
    write_task,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("--mark-stale", action="store_true", help="Mark expired active leases stale and block tasks")
    parser.add_argument("--now", help="ISO timestamp for deterministic tests")
    args = parser.parse_args()

    research_dir, _project_root = resolve(args.path)
    fail_if_invalid(research_dir)
    now = parse_time(args.now) if args.now else now_local()
    tasks = load_tasks(research_dir)
    stale_count = 0
    active_count = 0
    for _path, lease in active_leases(research_dir):
        active_count += 1
        expires_at = parse_time(lease.get("expires_at"))
        is_stale = expires_at < now
        state = "STALE" if is_stale else "ACTIVE"
        print(f"{state} {lease.get('task_id')} {lease.get('lease_id')} expires_at={lease.get('expires_at')}")
        if not is_stale:
            continue
        stale_count += 1
        if not args.mark_stale:
            continue
        task_id = lease.get("task_id")
        task = tasks.get(task_id)
        lease["status"] = "stale"
        lease["released_at"] = iso(now)
        write_json_atomic(lease_path(research_dir, str(task_id)), lease)
        append_event(
            research_dir,
            {
                "event": "lease_stale",
                "task_id": task_id,
                "lease_id": lease.get("lease_id"),
                "owner_id": lease.get("owner_id"),
                "created_at": iso(now),
            },
        )
        if task is not None:
            old_status = task.get("status")
            task["status"] = "blocked"
            write_task(research_dir, task)
            append_event(
                research_dir,
                {
                    "event": "status_changed",
                    "task_id": task_id,
                    "from": old_status,
                    "to": "blocked",
                    "lease_id": lease.get("lease_id"),
                    "created_at": iso(now),
                },
            )
    if args.mark_stale:
        fail_if_invalid(research_dir)
    print(f"active={active_count} stale={stale_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
