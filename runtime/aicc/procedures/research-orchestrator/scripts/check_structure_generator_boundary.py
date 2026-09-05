#!/usr/bin/env python3
"""Check that structure-generation scripts do not cross into submission authority.

Use this for `structure-modeler` tasks before accepting generated candidate structures.
It catches the common failure mode where a script or helper such as `generate_case()`
mutates atom coordinates/counts and also writes VASP engine inputs or Slurm submit
scripts before a structure gate exists.

Exit 0: no forbidden tokens found.
Exit 1: forbidden generation/submission boundary crossing found.
Exit 2: usage or unreadable path.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SCRIPT_SUFFIXES = {".py", ".sh", ".bash", ".zsh"}

SUBMISSION_PATTERNS = {
    "submit-script": re.compile(r"submit\.sh|write_submit\b|submit_job\b"),
    "scheduler-command": re.compile(r"\b(sbatch|qsub|bsub)\b"),
}

ENGINE_INPUT_PATTERNS = {
    "vasp-incar": re.compile(r"\bINCAR\b|write_incar\b"),
    "vasp-kpoints": re.compile(r"\bKPOINTS\b|write_kpoints\b"),
    "vasp-potcar": re.compile(r"\bPOTCAR\b|write_potcar\b"),
}


def iter_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(p for p in path.rglob("*") if p.is_file() and p.suffix in SCRIPT_SUFFIXES)
        else:
            raise SystemExit(f"path not found: {path}")
    return sorted(dict.fromkeys(files))


def scan_file(path: Path, patterns: dict[str, re.Pattern[str]]) -> list[tuple[str, int, str]]:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception as exc:  # noqa: BLE001 - report path detail
        raise SystemExit(f"failed to read {path}: {exc}") from exc
    findings: list[tuple[str, int, str]] = []
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        for label, pattern in patterns.items():
            if pattern.search(line):
                findings.append((label, lineno, stripped[:220]))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="Script files or directories to scan")
    parser.add_argument(
        "--forbid-engine-inputs",
        action="store_true",
        help="Also forbid writing engine-specific files such as INCAR/KPOINTS/POTCAR. Use for structure-modeler tasks; split mixed generate_case-style helpers instead.",
    )
    args = parser.parse_args()

    patterns = dict(SUBMISSION_PATTERNS)
    if args.forbid_engine_inputs:
        patterns.update(ENGINE_INPUT_PATTERNS)

    findings: list[str] = []
    try:
        files = iter_files([Path(p) for p in args.paths])
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 2

    for path in files:
        try:
            file_findings = scan_file(path, patterns)
        except SystemExit as exc:
            print(exc, file=sys.stderr)
            return 2
        for label, lineno, line in file_findings:
            findings.append(f"{path}:{lineno}: {label}: {line}")

    if findings:
        print("structure generator boundary check failed:", file=sys.stderr)
        for finding in findings:
            print(f"  {finding}", file=sys.stderr)
        print(
            "\nStructure-modeler scripts may write candidate structures and validation/audit records, "
            "but must not write scheduler submit scripts or submit jobs. A function that mutates "
            "coordinates, lattice, periodicity, or atom count must not write engine inputs in the "
            "same call path. When --forbid-engine-inputs is used, leave INCAR/KPOINTS/POTCAR "
            "generation to a downstream engine-runner task after an accepted structure_gate.",
            file=sys.stderr,
        )
        return 1

    print(f"structure generator boundary check passed ({len(files)} file(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
