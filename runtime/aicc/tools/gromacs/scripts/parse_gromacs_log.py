#!/usr/bin/env python3
"""Parse a GROMACS mdrun log for technical completion and stability warnings.

The parser reports only evidence in the log. It cannot establish equilibration,
adequate sampling, or force-field validity.

Exit codes: 0 clean technical completion, 1 review, 2 fatal/incomplete/unstable.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

FATAL = [r"Fatal error", r"Segmentation fault", r"MPI_ABORT", r"Particle coordinate is nan", r"non-finite force"]
STABILITY = [
    (r"LINCS WARNING", "LINCS constraint warning"),
    (r"Too many LINCS warnings", "too many LINCS warnings"),
    (r"SETTLE.*(?:error|failed|cannot)", "SETTLE water-constraint failure"),
    (r"Constraint error", "constraint error"),
    (r"Pressure scaling more than", "large pressure/box scaling"),
    (r"\bnan\b", "NaN detected"),
]
CONTROLLED_STOP = [r"Received the (?:TERM|INT) signal", r"stopping at the next NS step", r"maximum allowed run time.*(?:reached|exceeded)", r"stopping the (?:simulation|run)"]
CHECKPOINT = [r"Writing checkpoint", r"Time for writing the checkpoint"]


def add_unique(xs: list[str], x: str) -> None:
    if x not in xs:
        xs.append(x)


def infer_stage(text: str, requested: str) -> str:
    if requested != "auto":
        return requested
    if re.search(r"Steepest Descents|Conjugate Gradients|L-BFGS", text, re.I):
        return "em"
    return "dynamics"


def last_step_time(lines: list[str]) -> tuple[int | None, float | None]:
    step = None
    time = None
    for i, line in enumerate(lines[:-1]):
        if re.match(r"^\s*Step\s+Time\s*$", line):
            m = re.match(r"^\s*(-?\d+)\s+([-+0-9.eE]+)", lines[i + 1])
            if m:
                step = int(m.group(1))
                time = float(m.group(2))
    return step, time


def parse_energy_blocks(lines: list[str]) -> dict[str, float]:
    wanted = {"Potential", "Kinetic En.", "Total Energy", "Conserved En.", "Temperature", "Pressure", "Density", "Volume", "Box-X", "Box-Y", "Box-Z"}
    last: dict[str, float] = {}
    current: dict[str, float] = {}
    in_block = False
    for i, line in enumerate(lines[:-1]):
        if "Energies (" in line:
            current = {}
            in_block = True
            continue
        if not in_block:
            continue
        if not line.strip():
            if current:
                last = current.copy()
            in_block = False
            continue
        labels = [p.strip() for p in re.split(r"\s{2,}", line.strip()) if p.strip()]
        values_text = [p.strip() for p in re.split(r"\s+", lines[i + 1].strip()) if p.strip()]
        if labels and len(labels) == len(values_text) and not all(re.fullmatch(r"[-+0-9.eE]+", x) for x in labels):
            try:
                vals = [float(x) for x in values_text]
            except ValueError:
                continue
            for label, val in zip(labels, vals):
                if label in wanted and math.isfinite(val):
                    current[label] = val
    if current:
        last = current
    return last


def parse_min(text: str, notes: list[str], warnings: list[str]) -> tuple[bool | None, float | None, float | None]:
    converged = None
    fmax = None
    target = None
    m = re.search(r"converged to Fmax\s*<\s*([-+0-9.eE]+).*?in\s+(\d+)\s+steps", text, re.I | re.S)
    if m:
        converged = True
        target = float(m.group(1))
        notes.append(f"minimizer reported convergence in {m.group(2)} steps")
    m = re.search(r"did not converge to Fmax\s*<\s*([-+0-9.eE]+)", text, re.I)
    if m:
        converged = False
        target = float(m.group(1))
        warnings.append("energy minimization did not reach declared Fmax target")
    ms = re.findall(r"Maximum force\s*=\s*([-+0-9.eE]+)|Fmax\s*=\s*([-+0-9.eE]+)", text, re.I)
    if ms:
        value = next(v for v in ms[-1] if v)
        fmax = float(value)
    return converged, fmax, target


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("log", nargs="?", type=Path, default=Path("md.log"))
    ap.add_argument("--stage", default="auto", choices=["auto", "em", "equilibration", "production", "nve"])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if not args.log.is_file():
        print(f"ERROR: log file does not exist: {args.log}", file=sys.stderr)
        return 2

    text = args.log.read_text(errors="replace")
    lines = text.splitlines()
    stage = infer_stage(text, args.stage)
    warnings: list[str] = []
    errors: list[str] = []
    notes: list[str] = []

    completed = bool(re.search(r"Finished mdrun", text, re.I) or re.search(r"Writing final coordinates", text, re.I))
    controlled = any(re.search(p, text, re.I) for p in CONTROLLED_STOP)
    checkpoint = any(re.search(p, text, re.I) for p in CHECKPOINT)
    resumable = controlled or (not completed and checkpoint)
    if completed and controlled:
        warnings.append("controlled/early-stop marker detected; verify requested final step/time was reached")

    for pat in FATAL:
        if re.search(pat, text, re.I):
            add_unique(errors, f"fatal pattern: {pat}")
    for pat, desc in STABILITY:
        if re.search(pat, text, re.I):
            add_unique(errors, desc)
    for line in lines:
        if re.search(r"\bWARNING\b", line, re.I) and "LINCS WARNING" not in line.upper():
            add_unique(warnings, line.strip())
            if len(warnings) >= 10:
                break

    step, time_ps = last_step_time(lines)
    obs = parse_energy_blocks(lines)
    perf = None
    p = re.findall(r"Performance:\s+([-+0-9.eE]+)", text)
    if p:
        perf = float(p[-1])
    min_conv = fmax = ftarget = None
    if stage == "em":
        min_conv, fmax, ftarget = parse_min(text, notes, warnings)
        if min_conv is None:
            warnings.append("minimization convergence statement not found")

    if not completed:
        if resumable:
            notes.append("run appears to have stopped in a checkpoint/resumable path; verify the .cpt file")
        elif not errors:
            errors.append("normal mdrun completion marker not found")
    else:
        notes.append("technical completion only; equilibration and sampling require energy/trajectory analysis")
    if step is not None:
        notes.append(f"last logged state: step {step}, time {time_ps} ps")

    status = "FAIL" if errors else ("REVIEW" if warnings or not completed else "PASS")
    result = {
        "status": status,
        "stage": stage,
        "completed": completed,
        "resumable_stop": resumable,
        "checkpoint_write_seen": checkpoint,
        "last_step": step,
        "last_time_ps": time_ps,
        "minimization_converged": min_conv,
        "fmax_kj_mol_nm": fmax,
        "fmax_target_kj_mol_nm": ftarget,
        "performance_ns_day": perf,
        "last_observables": obs,
        "notes": notes,
        "warnings": warnings,
        "errors": errors,
    }
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"GROMACS log: {status} ({args.log})")
        for m in notes:
            print(f"NOTE: {m}")
        for m in warnings:
            print(f"WARNING: {m}")
        for m in errors:
            print(f"ERROR: {m}")
        print("Reminder: a clean log does not prove equilibration, sampling, or scientific validity.")
    return 2 if errors else (1 if warnings or not completed else 0)


if __name__ == "__main__":
    sys.exit(main())
