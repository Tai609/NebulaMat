"""Select the active local or configured WSL runtime for UMA calculations."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .uma import UMAError
from .uma_md import DEFAULT_SEEDS, DEFAULT_SUPERCELL, _build_parser, run_uma_surface_md


def _runtime_config(workspace_root: Path) -> tuple[Path | None, dict[str, Any]]:
    candidates = [
        workspace_root / "materials" / "runtime.json",
        Path(__file__).resolve().parents[3] / "materials" / "runtime.json",
    ]
    for path in candidates:
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise UMAError(f"could not read UMA runtime configuration {path}: {exc}") from exc
        if isinstance(payload, dict):
            return path, payload
    return None, {}


def _wsl_path(path: Path) -> str:
    try:
        completed = subprocess.run(
            ["wsl.exe", "--exec", "wslpath", "-a", "-u", str(path.resolve())],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise UMAError(f"could not translate Windows path for WSL: {path}: {exc}") from exc
    translated = completed.stdout.strip()
    if completed.returncode != 0 or not translated.startswith("/"):
        message = completed.stderr.strip() or "wslpath returned no POSIX path"
        raise UMAError(f"could not translate Windows path for WSL: {path}: {message}")
    return translated


def _windows_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    if len(normalized) > 7 and normalized.startswith("/mnt/") and normalized[6] == "/":
        drive = normalized[5].upper()
        remainder = normalized[7:].replace("/", "\\")
        return f"{drive}:\\{remainder}"
    return value


def _configured_wsl_uma(workspace_root: Path) -> tuple[str, Path | None]:
    config_path, payload = _runtime_config(workspace_root)
    uma = (payload.get("tools") or {}).get("uma") if isinstance(payload.get("tools"), dict) else None
    if not isinstance(uma, dict):
        raise UMAError("materials/runtime.json does not configure the UMA runtime")
    runtime = uma.get("runtime") if isinstance(uma.get("runtime"), dict) else {}
    interpreter = str(runtime.get("wsl_python") or "").strip()
    if not interpreter.startswith("/"):
        raise UMAError("UMA runtime does not declare a valid runtime.wsl_python interpreter")
    weights: Path | None = None
    raw_weights = str(uma.get("weights") or "").strip()
    if raw_weights and config_path is not None:
        config_root = config_path.parent.parent
        candidate = Path(raw_weights)
        weights = candidate.resolve() if candidate.is_absolute() else (config_root / candidate).resolve()
        if not weights.is_file():
            weights = None
    return interpreter, weights


def _parse_subprocess_json(stdout: str) -> dict[str, Any]:
    start = stdout.find("{")
    if start < 0:
        raise UMAError("WSL UMA runner returned no JSON result")
    try:
        payload = json.loads(stdout[start:])
    except json.JSONDecodeError as exc:
        raise UMAError(f"WSL UMA runner returned invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise UMAError("WSL UMA runner result must be a JSON object")
    return payload


def _run_wsl_surface_md(
    adsorbed_path: Path,
    output_dir: Path,
    workspace_root: Path,
    **parameters: Any,
) -> dict[str, Any]:
    interpreter, weights = _configured_wsl_uma(workspace_root)
    package_root = Path(__file__).resolve().parent.parent
    command = [
        "wsl.exe",
        "--exec",
        "/usr/bin/env",
        f"PYTHONPATH={_wsl_path(package_root)}",
    ]
    if weights is not None:
        command.append(f"NEBULAMAT_UMA_WEIGHTS={_wsl_path(weights)}")
    command.extend(
        [
            interpreter,
            "-m",
            "materials_mcp.uma_md",
            "--adsorbed",
            _wsl_path(adsorbed_path),
            "--output-dir",
            _wsl_path(output_dir),
            "--model",
            str(parameters["model_name"]),
            "--task",
            str(parameters["task_name"]),
            "--device",
            str(parameters["device"]),
            "--supercell",
            *[str(value) for value in parameters["supercell"]],
            "--ensemble",
            str(parameters["ensemble"]),
            "--temperature-k",
            str(parameters["temperature_k"]),
            "--timestep-fs",
            str(parameters["timestep_fs"]),
            "--equilibration-ps",
            str(parameters["equilibration_ps"]),
            "--production-ps",
            str(parameters["production_ps"]),
            "--friction-per-fs",
            str(parameters["friction_per_fs"]),
            "--fixed-bottom-layers",
            str(parameters["fixed_bottom_layers"]),
            "--layer-tolerance",
            str(parameters["layer_tolerance_angstrom"]),
            "--fmax",
            str(parameters["fmax_ev_per_angstrom"]),
            "--max-relax-steps",
            str(parameters["max_relax_steps"]),
            "--thermo-interval",
            str(parameters["thermo_interval_steps"]),
            "--trajectory-interval",
            str(parameters["trajectory_interval_steps"]),
            "--collision-distance",
            str(parameters["collision_distance_angstrom"]),
        ]
    )
    for seed in parameters["seeds"]:
        command.extend(["--seed", str(seed)])
    for index in parameters["freeze_indices"] or []:
        command.extend(["--freeze-index", str(index)])
    if not parameters["pre_relax"]:
        command.append("--no-pre-relax")
    try:
        completed = subprocess.run(
            command,
            cwd=workspace_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise UMAError(f"could not start configured WSL UMA runtime {interpreter}: {exc}") from exc
    payload = _parse_subprocess_json(completed.stdout)
    if payload.get("status") == "error":
        raise UMAError(str(payload.get("error") or "WSL UMA runner failed"))
    if completed.returncode not in {0, 2}:
        message = completed.stderr.strip()[-2000:] or f"exit code {completed.returncode}"
        raise UMAError(f"WSL UMA runner failed: {message}")
    for field in ("manifest", "output_dir"):
        if isinstance(payload.get(field), str):
            payload[field] = _windows_path(payload[field])
    input_record = payload.get("input")
    if isinstance(input_record, dict):
        for field in ("path", "standardization_manifest"):
            if isinstance(input_record.get(field), str):
                input_record[field] = _windows_path(input_record[field])
    payload["execution_runtime"] = {
        "kind": "wsl2",
        "python": interpreter,
        "delegated_by": str(Path(sys.executable).resolve()),
    }
    return payload


def run_uma_surface_md_runtime(
    adsorbed_path: str | Path,
    output_dir: str | Path,
    *,
    workspace_root: str | Path,
    model_name: str,
    task_name: str,
    device: str,
    supercell: list[int] | tuple[int, int, int] | None,
    ensemble: str,
    temperature_k: float,
    timestep_fs: float,
    equilibration_ps: float,
    production_ps: float,
    friction_per_fs: float,
    seeds: list[int] | tuple[int, ...] | None,
    fixed_bottom_layers: int,
    freeze_indices: list[int] | None,
    layer_tolerance_angstrom: float,
    pre_relax: bool,
    fmax_ev_per_angstrom: float,
    max_relax_steps: int,
    thermo_interval_steps: int,
    trajectory_interval_steps: int,
    collision_distance_angstrom: float,
) -> dict[str, Any]:
    """Use local fairchem when available, otherwise the configured WSL runtime."""
    root = Path(workspace_root).resolve()
    parameters = {
        "model_name": model_name,
        "task_name": task_name,
        "device": device,
        "supercell": list(DEFAULT_SUPERCELL if supercell is None else supercell),
        "ensemble": ensemble,
        "temperature_k": temperature_k,
        "timestep_fs": timestep_fs,
        "equilibration_ps": equilibration_ps,
        "production_ps": production_ps,
        "friction_per_fs": friction_per_fs,
        "seeds": list(DEFAULT_SEEDS if seeds is None else seeds),
        "fixed_bottom_layers": fixed_bottom_layers,
        "freeze_indices": freeze_indices,
        "layer_tolerance_angstrom": layer_tolerance_angstrom,
        "pre_relax": pre_relax,
        "fmax_ev_per_angstrom": fmax_ev_per_angstrom,
        "max_relax_steps": max_relax_steps,
        "thermo_interval_steps": thermo_interval_steps,
        "trajectory_interval_steps": trajectory_interval_steps,
        "collision_distance_angstrom": collision_distance_angstrom,
    }
    if importlib.util.find_spec("fairchem") is not None:
        result = run_uma_surface_md(adsorbed_path, output_dir, **parameters)
        result["execution_runtime"] = {
            "kind": "local",
            "python": str(Path(sys.executable).resolve()),
        }
        return result
    if os.name == "nt":
        return _run_wsl_surface_md(Path(adsorbed_path), Path(output_dir), root, **parameters)
    return run_uma_surface_md(adsorbed_path, output_dir, **parameters)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point that follows the same local/WSL runtime policy as MCP."""
    args = _build_parser().parse_args(argv)
    try:
        result = run_uma_surface_md_runtime(
            args.adsorbed,
            args.output_dir,
            workspace_root=Path.cwd(),
            model_name=args.model,
            task_name=args.task,
            device=args.device,
            supercell=args.supercell,
            ensemble=args.ensemble,
            temperature_k=args.temperature_k,
            timestep_fs=args.timestep_fs,
            equilibration_ps=args.equilibration_ps,
            production_ps=args.production_ps,
            friction_per_fs=args.friction_per_fs,
            seeds=args.seed or DEFAULT_SEEDS,
            fixed_bottom_layers=args.fixed_bottom_layers,
            freeze_indices=args.freeze_index,
            layer_tolerance_angstrom=args.layer_tolerance,
            pre_relax=not args.no_pre_relax,
            fmax_ev_per_angstrom=args.fmax,
            max_relax_steps=args.max_relax_steps,
            thermo_interval_steps=args.thermo_interval,
            trajectory_interval_steps=args.trajectory_interval,
            collision_distance_angstrom=args.collision_distance,
        )
    except UMAError as exc:
        result = {
            "schema_version": 1,
            "simulation_type": "uma_surface_md",
            "status": "error",
            "error": str(exc),
        }
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return 0 if result.get("status") == "completed" else 2


__all__ = ["main", "run_uma_surface_md_runtime"]
