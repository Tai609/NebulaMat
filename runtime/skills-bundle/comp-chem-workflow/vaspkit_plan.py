#!/usr/bin/env python3
"""Create and validate the VASPKIT plan required by NebulaMat VASP runs."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable


TASK_FAMILIES: dict[str, dict[str, Any]] = {
    "kpoints": {
        "phase": "input_generation",
        "required_inputs": ["POSCAR"],
        "expected_outputs": ["KPOINTS", "vaspkit task log"],
        "reason": "Generate and record the reviewed reciprocal-space sampling.",
    },
    "band_path": {
        "phase": "input_generation",
        "required_inputs": ["POSCAR or CONTCAR"],
        "expected_outputs": ["KPATH.in", "KPOINTS", "vaspkit task log"],
        "reason": "Generate a symmetry-aware band path and labels.",
    },
    "dos_band": {
        "phase": "postprocessing",
        "required_inputs": ["converged DOSCAR/vasprun.xml or EIGENVAL/PROCAR"],
        "expected_outputs": ["DOS or band data", "vaspkit task log"],
        "reason": "Extract electronic-structure data with an explicit energy reference.",
    },
    "electronic_analysis": {
        "phase": "postprocessing",
        "required_inputs": ["converged LOCPOT/CHGCAR/WAVECAR and task-specific files"],
        "expected_outputs": ["task-specific electronic analysis files", "vaspkit task log"],
        "reason": "Derive charge, potential, work-function, or wavefunction evidence.",
    },
    "thermochemistry": {
        "phase": "postprocessing",
        "required_inputs": ["completed VASP frequency OUTCAR and declared reference states"],
        "expected_outputs": ["ZPE and thermal/free-energy correction record", "vaspkit task log"],
        "reason": "Resolve vibrational and thermochemical corrections used by the free-energy expression.",
    },
    "aimd": {
        "phase": "postprocessing",
        "required_inputs": ["validated XDATCAR/vasprun.xml, OUTCAR, and structure"],
        "expected_outputs": ["requested trajectory analysis", "vaspkit task log"],
        "reason": "Post-process the declared AIMD observable with recorded windows and timestep.",
    },
    "mechanical": {
        "phase": "postprocessing",
        "required_inputs": ["consistent completed EOS or elastic VASP runs"],
        "expected_outputs": ["EOS or elastic summary", "vaspkit task log"],
        "reason": "Summarize mechanical-property calculations with fit evidence.",
    },
}

PLAN_STATUSES = {"planned", "completed", "not_applicable", "blocked"}
TASK_STATUSES = {"planned", "completed", "not_applicable", "blocked"}


OBJECTIVE_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("thermochemistry", re.compile(r"(?:\bher\b|hydrogen evolution|delta\s*g[_\s-]*h|free[-\s]*energy|thermochem|frequency|vibrational|析氢|氢吸附自由能|自由能|振动频)", re.I)),
    ("dos_band", re.compile(r"(?:\bdos\b|\bpdos\b|band structure|d-band|density of states|能带|态密度|d带)", re.I)),
    ("electronic_analysis", re.compile(r"(?:work function|charge density|bader|spin density|partial charge|\belf\b|locpot|功函数|电荷密度|差分电荷|巴德|自旋密度)", re.I)),
    ("aimd", re.compile(r"(?:\baimd\b|molecular dynamics|\bmsd\b|\brdf\b|\bvacf\b|\bvdos\b|diffusion|分子动力学|扩散系数|径向分布)", re.I)),
    ("mechanical", re.compile(r"(?:equation of state|\beos\b|elastic|bulk modulus|弹性|体积模量|状态方程)", re.I)),
    ("band_path", re.compile(r"(?:band path|k-path|high[-\s]*symmetry|高对称.*路径)", re.I)),
    ("kpoints", re.compile(r"(?:generate.*kpoints|k-point mesh|kpoints.*生成|生成.*k点)", re.I)),
)


def infer_task_families(objective: str) -> list[str]:
    return [family for family, pattern in OBJECTIVE_RULES if pattern.search(objective)]


def create_plan(
    objective: str,
    *,
    task_families: Iterable[str] = (),
    energy_reference: str | None = None,
    units: Iterable[str] = (),
) -> dict[str, Any]:
    selected = list(dict.fromkeys([*infer_task_families(objective), *task_families]))
    unknown = sorted(set(selected) - TASK_FAMILIES.keys())
    if unknown:
        raise ValueError(f"unknown VASPKIT task families: {', '.join(unknown)}")
    tasks = []
    for family in selected:
        spec = TASK_FAMILIES[family]
        tasks.append(
            {
                "family": family,
                "phase": spec["phase"],
                "status": "planned",
                "required_inputs": list(spec["required_inputs"]),
                "input_files": [],
                "commands_or_menu_answers": [],
                "expected_outputs": list(spec["expected_outputs"]),
                "generated_outputs": [],
                "log_file": None,
                "reason": spec["reason"],
            }
        )
    status = "planned" if tasks else "not_applicable"
    reason = (
        "Applicable VASPKIT tasks were inferred or explicitly selected; confirm local task IDs against the installed version."
        if tasks
        else "No VASPKIT input-generation or post-processing observable is required by the declared VASP objective."
    )
    return {
        "schema_version": 1,
        "engine": "vasp",
        "tool": "vaspkit",
        "objective": objective.strip(),
        "status": status,
        "task_families": tasks,
        "preflight": {
            "status": "planned" if tasks else "not_applicable",
            "artifact": None,
        },
        "vaspkit_version": None,
        "executable": None,
        "energy_reference": energy_reference,
        "units": list(dict.fromkeys(units)),
        "execution_target": "remote-compute",
        "reason": reason,
    }


def validate_plan(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if payload.get("engine") != "vasp" or payload.get("tool") != "vaspkit":
        errors.append("plan must bind engine=vasp and tool=vaspkit")
    if payload.get("status") not in PLAN_STATUSES:
        errors.append("status must be planned, completed, not_applicable, or blocked")
    if payload.get("execution_target") != "remote-compute":
        errors.append("execution_target must be remote-compute")
    if not isinstance(payload.get("reason"), str) or not payload["reason"].strip():
        errors.append("reason is required")
    tasks = payload.get("task_families")
    if not isinstance(tasks, list):
        errors.append("task_families must be a list")
        return errors
    if payload.get("status") == "not_applicable" and tasks:
        errors.append("not_applicable plans cannot contain planned task families")
    if payload.get("status") in {"planned", "completed"} and not tasks:
        errors.append(f"{payload.get('status')} plans require at least one task family")
    preflight = payload.get("preflight")
    if not isinstance(preflight, dict) or preflight.get("status") not in {"planned", "passed", "not_applicable", "failed"}:
        errors.append("preflight must record planned, passed, not_applicable, or failed")
    for index, task in enumerate(tasks):
        prefix = f"task_families[{index}]"
        if not isinstance(task, dict):
            errors.append(f"{prefix} must be an object")
            continue
        if task.get("family") not in TASK_FAMILIES:
            errors.append(f"{prefix}.family is unsupported")
        if task.get("phase") not in {"input_generation", "postprocessing"}:
            errors.append(f"{prefix}.phase is invalid")
        if task.get("status") not in TASK_STATUSES:
            errors.append(f"{prefix}.status is invalid")
        for field in (
            "required_inputs",
            "input_files",
            "commands_or_menu_answers",
            "expected_outputs",
            "generated_outputs",
        ):
            if not isinstance(task.get(field), list):
                errors.append(f"{prefix}.{field} must be a list")
        if payload.get("status") == "completed" and task.get("status") not in {"completed", "not_applicable"}:
            errors.append(f"{prefix}.status must be completed or not_applicable when the plan is completed")
        if task.get("status") == "completed":
            for field in ("input_files", "commands_or_menu_answers", "generated_outputs"):
                if not task.get(field):
                    errors.append(f"{prefix}.{field} is required for a completed task")
            if not str(task.get("log_file") or "").strip():
                errors.append(f"{prefix}.log_file is required for a completed task")
        if task.get("status") == "not_applicable" and not str(task.get("reason") or "").strip():
            errors.append(f"{prefix}.reason is required for a not_applicable task")
    completed_tasks = [task for task in tasks if isinstance(task, dict) and task.get("status") == "completed"]
    if completed_tasks:
        if not isinstance(preflight, dict) or preflight.get("status") != "passed" or not str(preflight.get("artifact") or "").strip():
            errors.append("a passed VASPKIT preflight artifact is required after executing a task")
        if not str(payload.get("vaspkit_version") or "").strip():
            errors.append("vaspkit_version is required after executing a VASPKIT task")
        if not str(payload.get("executable") or "").strip():
            errors.append("executable is required after executing a VASPKIT task")
    reference_sensitive = {"thermochemistry", "dos_band", "electronic_analysis"}
    if any(task.get("family") in reference_sensitive and task.get("status") == "completed" for task in tasks if isinstance(task, dict)):
        if not str(payload.get("energy_reference") or "").strip():
            errors.append("energy_reference is required for completed thermochemistry or electronic-analysis tasks")
        if not payload.get("units"):
            errors.append("units are required for completed thermochemistry or electronic-analysis tasks")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create a versioned VASPKIT plan")
    create.add_argument("--objective", required=True)
    create.add_argument("--task-family", action="append", default=[], choices=sorted(TASK_FAMILIES))
    create.add_argument("--energy-reference")
    create.add_argument("--unit", action="append", default=[])
    create.add_argument("--out", required=True, type=Path)

    check = subparsers.add_parser("check", help="Validate an existing VASPKIT plan")
    check.add_argument("--plan", required=True, type=Path)

    args = parser.parse_args(argv)
    if args.command == "create":
        payload = create_plan(
            args.objective,
            task_families=args.task_family,
            energy_reference=args.energy_reference,
            units=args.unit,
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    else:
        try:
            payload = json.loads(args.plan.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"invalid VASPKIT plan: {exc}")
            return 2
        if not isinstance(payload, dict):
            print("invalid VASPKIT plan: root must be an object")
            return 2

    errors = validate_plan(payload)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 2
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
