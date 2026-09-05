"""Deterministic DFT cost estimates and submission-review artifacts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


CNY_PER_CORE_HOUR = 0.1


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _positive(value: Any, name: str) -> float:
    number = float(value)
    if number <= 0:
        raise ValueError(f"{name} must be positive")
    return number


def build_cost_estimate(
    spec_path: Path,
    model_paths: list[Path],
    model: dict[str, Any],
    workloads: list[dict[str, Any]],
    lower_cost_alternative: str,
    assumptions: list[str] | None = None,
    max_parallel_jobs: int = 1,
) -> dict[str, Any]:
    if not spec_path.is_file():
        raise ValueError("DFTRunSpec.json is missing")
    if not model_paths or any(not path.is_file() for path in model_paths):
        raise ValueError("at least one existing model artifact is required")
    atom_count = int(model.get("atom_count", 0))
    free_atoms = int(model.get("free_atoms", -1))
    fixed_atoms = int(model.get("fixed_atoms", -1))
    if atom_count <= 0 or free_atoms < 0 or fixed_atoms < 0:
        raise ValueError("atom_count must be positive and free/fixed atom counts cannot be negative")
    if free_atoms + fixed_atoms != atom_count:
        raise ValueError("free_atoms plus fixed_atoms must equal atom_count")
    for field in ("slab_layers", "supercell", "coverage", "kpoint_policy"):
        if not str(model.get(field) or "").strip():
            raise ValueError(f"model.{field} is required")
    memory_gib = _positive(model.get("memory_gib"), "model.memory_gib")
    if not workloads:
        raise ValueError("at least one planned workload is required")
    if not str(lower_cost_alternative or "").strip():
        raise ValueError("a lower-cost alternative is required")
    parallel = int(max_parallel_jobs)
    if parallel <= 0:
        raise ValueError("max_parallel_jobs must be positive")

    rows: list[dict[str, Any]] = []
    totals = {"jobs": 0, "job_hours_low": 0.0, "job_hours_expected": 0.0, "job_hours_high": 0.0,
              "core_hours_low": 0.0, "core_hours_expected": 0.0, "core_hours_high": 0.0}
    for index, workload in enumerate(workloads):
        name = str(workload.get("name") or "").strip()
        count = int(workload.get("count", 0))
        cores = int(workload.get("cores_per_job", 0))
        low = _positive(workload.get("wall_hours_low"), f"workloads[{index}].wall_hours_low")
        expected = _positive(workload.get("wall_hours_expected"), f"workloads[{index}].wall_hours_expected")
        high = _positive(workload.get("wall_hours_high"), f"workloads[{index}].wall_hours_high")
        if not name or count <= 0 or cores <= 0:
            raise ValueError(f"workloads[{index}] requires name, positive count, and positive cores_per_job")
        if not low <= expected <= high:
            raise ValueError(f"workloads[{index}] wall-hour range must satisfy low <= expected <= high")
        job_hours = {"low": count * low, "expected": count * expected, "high": count * high}
        core_hours = {key: value * cores for key, value in job_hours.items()}
        rows.append({
            "name": name,
            "count": count,
            "cores_per_job": cores,
            "wall_hours_per_job": {"low": low, "expected": expected, "high": high},
            "job_hours": job_hours,
            "core_hours": core_hours,
            "cost_cny": {key: round(value * CNY_PER_CORE_HOUR, 2) for key, value in core_hours.items()},
        })
        totals["jobs"] += count
        for key in ("low", "expected", "high"):
            totals[f"job_hours_{key}"] += job_hours[key]
            totals[f"core_hours_{key}"] += core_hours[key]

    serial = {key: round(totals[f"job_hours_{key}"], 3) for key in ("low", "expected", "high")}
    parallel_lower_bound = {key: round(value / parallel, 3) for key, value in serial.items()}
    core_hours = {key: round(totals[f"core_hours_{key}"], 3) for key in ("low", "expected", "high")}
    return {
        "schema_version": 1,
        "kind": "dft_submission_cost_estimate",
        "currency": "CNY",
        "rate_cny_per_core_hour": CNY_PER_CORE_HOUR,
        "spec": {"path": spec_path.as_posix(), "sha256": sha256_file(spec_path)},
        "model_artifacts": [
            {"path": path.as_posix(), "sha256": sha256_file(path)} for path in model_paths
        ],
        "model": {
            **model,
            "atom_count": atom_count,
            "free_atoms": free_atoms,
            "fixed_atoms": fixed_atoms,
            "memory_gib": memory_gib,
        },
        "workloads": rows,
        "totals": {
            "planned_job_count": totals["jobs"],
            "serial_wall_hours": serial,
            "parallel_wall_hours_lower_bound": parallel_lower_bound,
            "max_parallel_jobs": parallel,
            "core_hours": core_hours,
            "cost_cny": {key: round(value * CNY_PER_CORE_HOUR, 2) for key, value in core_hours.items()},
        },
        "lower_cost_alternative": lower_cost_alternative.strip(),
        "assumptions": [str(value) for value in (assumptions or []) if str(value).strip()],
        "warning": "This is a planning estimate, not a scheduler guarantee or invoice.",
    }


def validate_cost_estimate(payload: dict[str, Any], spec_path: Path) -> list[str]:
    errors: list[str] = []
    if payload.get("schema_version") != 1 or payload.get("kind") != "dft_submission_cost_estimate":
        errors.append("cost estimate must use the DFT submission cost schema")
    if payload.get("currency") != "CNY" or float(payload.get("rate_cny_per_core_hour", -1)) != CNY_PER_CORE_HOUR:
        errors.append("cost estimate must use 0.1 CNY per core-hour")
    spec = payload.get("spec")
    if not isinstance(spec, dict) or spec.get("sha256") != sha256_file(spec_path):
        errors.append("cost estimate does not match the current DFTRunSpec.json")
    model = payload.get("model")
    if not isinstance(model, dict):
        errors.append("model audit is missing")
    else:
        required = ("atom_count", "free_atoms", "fixed_atoms", "slab_layers", "supercell", "coverage", "kpoint_policy", "memory_gib")
        if any(model.get(field) in (None, "") for field in required):
            errors.append("model audit is incomplete")
    if not payload.get("model_artifacts"):
        errors.append("model artifact hashes are missing")
    totals = payload.get("totals")
    if not isinstance(totals, dict) or not isinstance(totals.get("cost_cny"), dict) or not isinstance(totals.get("core_hours"), dict):
        errors.append("time, core-hour, or cost totals are missing")
    if not str(payload.get("lower_cost_alternative") or "").strip():
        errors.append("lower-cost alternative is missing")
    return errors


def validate_model_audit(payload: dict[str, Any], spec_path: Path) -> list[str]:
    errors: list[str] = []
    if payload.get("schema_version") != 1 or payload.get("kind") != "dft_model_audit":
        errors.append("model audit must use schema dft_model_audit v1")
    if payload.get("status") not in {"passed", "review", "blocked"}:
        errors.append("model audit status must be passed, review, or blocked")
    spec = payload.get("spec")
    if not isinstance(spec, dict) or spec.get("sha256") != sha256_file(spec_path):
        errors.append("model audit does not match the current DFTRunSpec.json")
    for field in ("model_artifacts", "findings", "assumptions"):
        if not isinstance(payload.get(field), list):
            errors.append(f"model audit field {field} must be a list")
    for item in payload.get("model_artifacts", []):
        if not isinstance(item, dict) or not str(item.get("path") or "").strip():
            errors.append("model audit contains an invalid model artifact")
            continue
        path = Path(str(item["path"]))
        if not path.is_file() or item.get("sha256") != sha256_file(path):
            errors.append(f"model audit hash does not match {path}")
    if not str(payload.get("lower_cost_alternative") or "").strip():
        errors.append("model audit lower-cost alternative is missing")
    return errors


def build_model_audit(
    spec_path: Path,
    model_paths: list[Path],
    status: str,
    findings: list[dict[str, Any]],
    assumptions: list[str],
    lower_cost_alternative: str,
) -> dict[str, Any]:
    if status not in {"passed", "review", "blocked"}:
        raise ValueError("model audit status must be passed, review, or blocked")
    if not spec_path.is_file() or not model_paths or any(not path.is_file() for path in model_paths):
        raise ValueError("the current DFTRunSpec and model artifacts are required")
    if not str(lower_cost_alternative or "").strip():
        raise ValueError("a lower-cost alternative is required")
    return {
        "schema_version": 1,
        "kind": "dft_model_audit",
        "status": status,
        "spec": {"path": spec_path.as_posix(), "sha256": sha256_file(spec_path)},
        "model_artifacts": [
            {"path": path.as_posix(), "sha256": sha256_file(path)} for path in model_paths
        ],
        "findings": [dict(value) for value in findings],
        "assumptions": [str(value) for value in assumptions if str(value).strip()],
        "lower_cost_alternative": lower_cost_alternative.strip(),
        "scientific_validation": "pending_human_review",
    }


def dump_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    temporary.replace(path)
