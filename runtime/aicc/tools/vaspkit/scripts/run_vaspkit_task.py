#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Run one VASPKIT task non-interactively after the menu sequence is known."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", help="First VASPKIT task ID to send, e.g. 103")
    parser.add_argument("--cwd", default=".", help="Working directory containing VASP files")
    parser.add_argument("--stdin-file", help="Additional menu answers, one per line")
    parser.add_argument("--log", default=None, help="Log file path; default vaspkit.<task>.log")
    parser.add_argument("--exe", default="vaspkit", help="VASPKIT executable name or path")
    args = parser.parse_args()

    exe = shutil.which(args.exe) or args.exe
    cwd = Path(args.cwd).resolve()
    if not cwd.is_dir():
        print(f"not a directory: {cwd}", file=sys.stderr)
        return 2

    answers = [str(args.task)]
    if args.stdin_file:
        stdin_path = Path(args.stdin_file)
        if not stdin_path.is_file():
            print(f"stdin file not found: {stdin_path}", file=sys.stderr)
            return 2
        answers.extend(stdin_path.read_text(errors="replace").splitlines())
    input_text = "\n".join(answers) + "\n"

    log_path = Path(args.log) if args.log else cwd / f"vaspkit.{args.task}.log"
    if not log_path.is_absolute():
        log_path = cwd / log_path

    proc = subprocess.run(
        [exe],
        cwd=str(cwd),
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    log_path.write_text(proc.stdout, errors="replace")
    print(f"log: {log_path}")
    if proc.returncode != 0:
        print(f"VASPKIT failed with exit code {proc.returncode}", file=sys.stderr)
        return proc.returncode
    print("VASPKIT task finished")
    return 0


if __name__ == "__main__":
    sys.exit(main())
