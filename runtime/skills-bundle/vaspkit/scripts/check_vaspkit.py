#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Preflight checks for VASPKIT tasks."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys


CONFIG_KEYS = {
    "VASP5_SWITCH",
    "PBE_PATH",
    "GGA_PATH",
    "LDA_PATH",
    "POTCAR_TYPE",
    "PYTHON_BIN",
    "VASPKIT_UTILITIES_PATH",
    "PLOT_MATPLOTLIB",
}


def parse_config(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0] in CONFIG_KEYS:
            values[parts[0]] = parts[1]
    return values


def nonempty(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rundir", nargs="?", default=".", help="VASPKIT working directory")
    parser.add_argument("--require", action="append", default=[], help="Required file name; can be repeated")
    parser.add_argument("--no-config", action="store_true", help="Do not require ~/.vaspkit")
    args = parser.parse_args()

    rundir = Path(args.rundir).resolve()
    failures: list[str] = []
    warnings: list[str] = []

    if not rundir.is_dir():
        failures.append(f"not a directory: {rundir}")
    else:
        if not nonempty(rundir / "POSCAR") and not nonempty(rundir / "CONTCAR"):
            warnings.append("no POSCAR/CONTCAR found; some post-processing tasks do not need one")
        for name in args.require:
            if not nonempty(rundir / name):
                failures.append(f"missing required non-empty file: {rundir / name}")

    exe = shutil.which("vaspkit")
    if exe:
        print(f"vaspkit executable: {exe}")
    else:
        failures.append("vaspkit executable not found on PATH")

    config = Path(os.environ.get("VASPKIT_CONFIG", str(Path.home() / ".vaspkit"))).expanduser()
    if args.no_config:
        print("config check: skipped")
    elif config.exists():
        print(f"config: {config}")
        values = parse_config(config)
        for key in sorted(values):
            print(f"config {key}={values[key]}")
        if not values:
            warnings.append(f"{config} exists but no known VASPKIT keys were parsed")
        for key in ("PBE_PATH", "GGA_PATH", "LDA_PATH"):
            value = values.get(key)
            if value and not Path(value).expanduser().exists():
                warnings.append(f"{key} path does not exist from this shell: {value}")
    else:
        failures.append(f"VASPKIT config not found: {config}")

    if warnings:
        print("WARNINGS:")
        for item in warnings:
            print(f"  - {item}")

    if failures:
        print("FAILURES:")
        for item in failures:
            print(f"  - {item}")
        return 2

    print("VASPKIT preflight passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
