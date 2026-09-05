"""Governed ASE molecular dynamics with the FAIR Chemistry UMA potential."""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

try:
    from .structure_standardizer import StandardizationError, validate_standardized_artifact
    from .uma import (
        DEFAULT_MODEL,
        DEFAULT_TASK,
        SUPPORTED_TASKS,
        UMAError,
        _finite,
        _load_calculator,
        _relax,
        _resolve_local_checkpoint,
        _sha256,
        _validate_task,
    )
except ImportError:  # pragma: no cover - supports direct CLI execution
    from structure_standardizer import StandardizationError, validate_standardized_artifact
    from uma import (
        DEFAULT_MODEL,
        DEFAULT_TASK,
        SUPPORTED_TASKS,
        UMAError,
        _finite,
        _load_calculator,
        _relax,
        _resolve_local_checkpoint,
        _sha256,
        _validate_task,
    )


MD_SCHEMA_VERSION = 1
DEFAULT_SUPERCELL = (2, 2, 1)
DEFAULT_SEEDS = (1729, 2718, 3141)
DEFAULT_TIMESTEP_FS = 0.5
DEFAULT_TRAJECTORY_PREVIEW_MAX_FRAMES = 600
THERMO_FIELDS = (
    "phase",
    "step",
    "time_fs",
    "temperature_k",
    "potential_energy_ev",
    "kinetic_energy_ev",
    "total_energy_ev",
    "max_force_ev_per_angstrom",
    "minimum_distance_angstrom",
)


class _MDAbort(RuntimeError):
    """Stop one replica after a physical or numerical guard fails."""


def _integer(value: Any, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        raise UMAError(f"{name} must be an integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise UMAError(f"{name} must be an integer") from exc
    if parsed < minimum:
        raise UMAError(f"{name} must be >= {minimum}")
    return parsed


def _positive(value: Any, name: str, *, allow_zero: bool = False) -> float:
    parsed = _finite(value, name)
    if parsed < 0 or (not allow_zero and parsed == 0):
        qualifier = "non-negative" if allow_zero else "positive"
        raise UMAError(f"{name} must be {qualifier}")
    return parsed


def _normalize_supercell(values: Sequence[int] | None) -> tuple[int, int, int]:
    raw = tuple(DEFAULT_SUPERCELL if values is None else values)
    if len(raw) != 3:
        raise UMAError("supercell must contain exactly three integers")
    matrix = tuple(_integer(value, f"supercell[{index}]", minimum=1) for index, value in enumerate(raw))
    if matrix[2] != 1:
        raise UMAError("surface UMA-MD requires supercell[2] == 1; never replicate the vacuum direction")
    return matrix


def _normalize_seeds(values: Iterable[int] | None) -> list[int]:
    seeds = [_integer(value, "seed", minimum=0) for value in (DEFAULT_SEEDS if values is None else values)]
    if not seeds:
        raise UMAError("at least one random seed is required")
    if len(seeds) > 16:
        raise UMAError("no more than 16 random seeds may be run in one request")
    if len(set(seeds)) != len(seeds):
        raise UMAError("random seeds must be unique")
    return seeds


def _minimum_distance(atoms: Any) -> float | None:
    if len(atoms) < 2:
        return None
    distances = np.asarray(atoms.get_all_distances(mic=True), dtype=float)
    np.fill_diagonal(distances, np.inf)
    value = float(np.min(distances))
    return value if math.isfinite(value) else None


def _surface_area(atoms: Any) -> float:
    return float(np.linalg.norm(np.cross(atoms.cell.array[0], atoms.cell.array[1])))


def _bottom_layer_indices(atoms: Any, layer_count: int, tolerance: float) -> list[int]:
    if layer_count == 0:
        return []
    normal = np.asarray(atoms.cell.array[2], dtype=float)
    norm = float(np.linalg.norm(normal))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise UMAError("surface cell has no valid third lattice vector")
    direction = normal / norm
    projections = np.asarray(atoms.get_positions(), dtype=float) @ direction
    ordered = sorted(enumerate(projections.tolist()), key=lambda item: item[1])
    groups: list[dict[str, Any]] = []
    for index, projection in ordered:
        if not groups or projection - float(groups[-1]["center"]) > tolerance:
            groups.append({"center": projection, "indices": [index]})
        else:
            indices = groups[-1]["indices"]
            indices.append(index)
            groups[-1]["center"] = sum(float(projections[item]) for item in indices) / len(indices)
    if len(groups) <= layer_count:
        raise UMAError(
            f"fixed_bottom_layers={layer_count} leaves no mobile atomic plane; detected {len(groups)} planes"
        )
    return sorted(index for group in groups[:layer_count] for index in group["indices"])


def _replicate_indices(indices: Iterable[int], input_natoms: int, factor: int) -> list[int]:
    values = sorted({int(index) for index in indices})
    if any(index < 0 or index >= input_natoms for index in values):
        raise UMAError(f"freeze_indices contains an atom index outside 0..{input_natoms - 1}")
    return [index + copy_index * input_natoms for copy_index in range(factor) for index in values]


def _artifact(path: Path, output_dir: Path, *, kind: str) -> dict[str, Any]:
    return {
        "path": path.relative_to(output_dir).as_posix(),
        "kind": kind,
        "sha256": _sha256(path),
        "size_bytes": path.stat().st_size,
    }


def _artifact_kind(path: Path) -> str:
    if path.name in {"trajectory.extxyz", "trajectory-preview.extxyz"}:
        return "trajectory"
    if path.suffix == ".csv":
        return "thermodynamics"
    return "structure"


def _write_structure(path: Path, atoms: Any) -> None:
    try:
        from ase.io import write  # type: ignore

        write(path, atoms)
    except Exception as exc:
        raise UMAError(f"could not write MD structure {path}: {exc}") from exc


def _run_replica(
    base_atoms: Any,
    calculator: Any,
    output_dir: Path,
    *,
    seed: int,
    ensemble: str,
    temperature_k: float,
    timestep_fs: float,
    equilibration_steps: int,
    production_steps: int,
    friction_per_fs: float,
    thermo_interval_steps: int,
    trajectory_interval_steps: int,
    collision_distance_angstrom: float,
) -> tuple[dict[str, Any], list[Path]]:
    try:
        from ase import units  # type: ignore
        from ase.io import write  # type: ignore
        from ase.md.langevin import Langevin  # type: ignore
        from ase.md import velocitydistribution  # type: ignore
        from ase.md.verlet import VelocityVerlet  # type: ignore
    except ImportError as exc:
        raise UMAError("ASE molecular-dynamics modules are required for UMA-MD") from exc

    atoms = base_atoms.copy()
    atoms.calc = calculator
    rng = np.random.default_rng(seed)
    thermalize = getattr(velocitydistribution, "thermalize_momenta", None)
    if thermalize is not None:
        thermalize(atoms, temperature_k, rng=rng)
    else:  # ASE < 3.29
        velocitydistribution.MaxwellBoltzmannDistribution(atoms, temperature_K=temperature_k, rng=rng)
    velocitydistribution.Stationary(atoms, preserve_temperature=True)
    if ensemble == "nvt":
        dynamics = Langevin(
            atoms,
            timestep_fs * units.fs,
            temperature_K=temperature_k,
            friction=friction_per_fs / units.fs,
            fixcm=False,
            rng=rng,
        )
    else:
        dynamics = VelocityVerlet(atoms, timestep_fs * units.fs)

    replica_dir = output_dir / f"seed-{seed}"
    replica_dir.mkdir(parents=True, exist_ok=False)
    thermo_path = replica_dir / "thermo.csv"
    trajectory_path = replica_dir / "trajectory.extxyz"
    trajectory_preview_path = replica_dir / "trajectory-preview.extxyz"
    final_extxyz = replica_dir / "final.extxyz"
    final_cif = replica_dir / "final.cif"
    representative_path = replica_dir / "representative.extxyz"
    closest_path = replica_dir / "closest-contact.extxyz"
    rows: list[dict[str, Any]] = []
    state = {"phase": "equilibration"}
    best_temperature_delta = math.inf
    representative = atoms.copy()
    closest_distance = math.inf
    closest = atoms.copy()
    last_thermo_step = -1
    last_trajectory_step = -1
    last_preview_step = -1
    preview_frame_count = 0
    total_steps = equilibration_steps + production_steps
    preview_interval_steps = max(
        trajectory_interval_steps,
        math.ceil(
            total_steps
            / max(1, DEFAULT_TRAJECTORY_PREVIEW_MAX_FRAMES - 1)
            / trajectory_interval_steps
        )
        * trajectory_interval_steps,
    )

    with thermo_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=THERMO_FIELDS)
        writer.writeheader()

        def record_thermo() -> None:
            nonlocal best_temperature_delta, representative, closest_distance, closest, last_thermo_step
            step = int(dynamics.get_number_of_steps())
            if step == last_thermo_step:
                return
            potential = float(atoms.get_potential_energy())
            kinetic = float(atoms.get_kinetic_energy())
            temperature = float(atoms.get_temperature())
            forces = np.asarray(atoms.get_forces(), dtype=float)
            max_force = float(np.max(np.linalg.norm(forces, axis=1))) if len(forces) else 0.0
            minimum_distance = _minimum_distance(atoms)
            numeric_values = [potential, kinetic, temperature, max_force]
            if minimum_distance is not None:
                numeric_values.append(minimum_distance)
            if not all(math.isfinite(value) for value in numeric_values):
                raise _MDAbort("non-finite energy, force, temperature, or distance detected")
            row = {
                "phase": state["phase"],
                "step": step,
                "time_fs": step * timestep_fs,
                "temperature_k": temperature,
                "potential_energy_ev": potential,
                "kinetic_energy_ev": kinetic,
                "total_energy_ev": potential + kinetic,
                "max_force_ev_per_angstrom": max_force,
                "minimum_distance_angstrom": minimum_distance,
            }
            writer.writerow(row)
            handle.flush()
            rows.append(row)
            last_thermo_step = step
            if state["phase"] == "production" and abs(temperature - temperature_k) < best_temperature_delta:
                best_temperature_delta = abs(temperature - temperature_k)
                representative = atoms.copy()
            if minimum_distance is not None and minimum_distance < closest_distance:
                closest_distance = minimum_distance
                closest = atoms.copy()
            if minimum_distance is not None and minimum_distance < collision_distance_angstrom:
                raise _MDAbort(
                    f"minimum distance {minimum_distance:.4f} A fell below the "
                    f"{collision_distance_angstrom:.4f} A collision guard"
                )

        def record_trajectory() -> None:
            nonlocal last_trajectory_step, last_preview_step
            step = int(dynamics.get_number_of_steps())
            if step == last_trajectory_step:
                return
            metadata = {
                "md_step": step,
                "md_timestep_fs": timestep_fs,
                "time_fs": step * timestep_fs,
                "md_phase": state["phase"],
                "md_seed": seed,
            }
            previous_info = {key: atoms.info.get(key) for key in metadata}
            missing_info = {key for key in metadata if key not in atoms.info}
            atoms.info.update(metadata)
            try:
                write(trajectory_path, atoms, format="extxyz", append=trajectory_path.exists())
            finally:
                for key in missing_info:
                    atoms.info.pop(key, None)
                atoms.info.update({key: value for key, value in previous_info.items() if key not in missing_info})
            last_trajectory_step = step
            if last_preview_step < 0 or step - last_preview_step >= preview_interval_steps:
                record_preview(step)

        def record_preview(step: int) -> None:
            nonlocal last_preview_step, preview_frame_count
            snapshot = atoms.copy()
            snapshot.calc = None
            snapshot.arrays.pop("momenta", None)
            snapshot.info.update(
                {
                    "md_step": step,
                    "md_timestep_fs": timestep_fs,
                    "time_fs": step * timestep_fs,
                    "md_phase": state["phase"],
                    "md_seed": seed,
                }
            )
            write(
                trajectory_preview_path,
                snapshot,
                format="extxyz",
                append=trajectory_preview_path.exists(),
            )
            last_preview_step = step
            preview_frame_count += 1

        dynamics.attach(record_thermo, interval=thermo_interval_steps)
        dynamics.attach(record_trajectory, interval=trajectory_interval_steps)
        abort_reason: str | None = None
        try:
            if equilibration_steps:
                dynamics.run(equilibration_steps)
            state["phase"] = "production"
            dynamics.run(production_steps)
        except _MDAbort as exc:
            abort_reason = str(exc)
        if int(dynamics.get_number_of_steps()) != last_thermo_step:
            try:
                record_thermo()
            except _MDAbort as exc:
                abort_reason = abort_reason or str(exc)
        if int(dynamics.get_number_of_steps()) != last_trajectory_step:
            record_trajectory()
        if int(dynamics.get_number_of_steps()) != last_preview_step:
            record_preview(int(dynamics.get_number_of_steps()))

    _write_structure(final_extxyz, atoms)
    _write_structure(final_cif, atoms)
    _write_structure(representative_path, representative)
    _write_structure(closest_path, closest)
    production_rows = [row for row in rows if row["phase"] == "production"] or rows
    temperatures = [float(row["temperature_k"]) for row in production_rows]
    total_energies = [float(row["total_energy_ev"]) for row in production_rows]
    minimum_distances = [
        float(row["minimum_distance_angstrom"])
        for row in rows
        if row["minimum_distance_angstrom"] is not None
    ]
    summary: dict[str, Any] = {
        "seed": seed,
        "status": "aborted" if abort_reason else "completed",
        "completed_steps": int(dynamics.get_number_of_steps()),
        "planned_steps": equilibration_steps + production_steps,
        "samples": len(rows),
        "trajectory_preview_frames": preview_frame_count,
        "temperature_k": {
            "mean": float(np.mean(temperatures)) if temperatures else None,
            "std": float(np.std(temperatures)) if temperatures else None,
            "target": temperature_k,
        },
        "minimum_distance_angstrom": min(minimum_distances) if minimum_distances else None,
        "maximum_force_ev_per_angstrom": max(
            (float(row["max_force_ev_per_angstrom"]) for row in rows),
            default=None,
        ),
        "abort_reason": abort_reason,
    }
    if ensemble == "nve" and len(total_energies) >= 2:
        summary["energy_drift_ev_per_atom"] = (total_energies[-1] - total_energies[0]) / len(atoms)
    artifacts = [thermo_path, trajectory_path, trajectory_preview_path, final_extxyz, final_cif, representative_path, closest_path]
    return summary, artifacts


def run_uma_surface_md(
    adsorbed_path: str | Path,
    output_dir: str | Path,
    *,
    model_name: str = DEFAULT_MODEL,
    task_name: str = DEFAULT_TASK,
    device: str = "cuda",
    supercell: Sequence[int] | None = DEFAULT_SUPERCELL,
    ensemble: str = "nvt",
    temperature_k: float = 300.0,
    timestep_fs: float = DEFAULT_TIMESTEP_FS,
    equilibration_ps: float = 5.0,
    production_ps: float = 20.0,
    friction_per_fs: float = 0.01,
    seeds: Iterable[int] | None = DEFAULT_SEEDS,
    fixed_bottom_layers: int = 2,
    freeze_indices: Iterable[int] | None = None,
    layer_tolerance_angstrom: float = 0.25,
    pre_relax: bool = True,
    fmax_ev_per_angstrom: float = 0.05,
    max_relax_steps: int = 200,
    thermo_interval_steps: int = 10,
    trajectory_interval_steps: int = 10,
    collision_distance_angstrom: float = 0.6,
) -> dict[str, Any]:
    """Run reproducible ASE surface MD with UMA on a standardized adsorption system.

    The complete adsorbed system is repeated, preserving the supplied coverage.
    Only in-plane supercells are accepted; ordinary three-dimensional NPT is
    intentionally not part of this surface protocol.
    """
    source = Path(adsorbed_path).resolve()
    destination = Path(output_dir).resolve()
    try:
        provenance = validate_standardized_artifact(source, "surface")
    except StandardizationError as exc:
        raise UMAError(
            f"UMA-MD requires a standardized adsorbed surface: {exc}. "
            "Use standardize_uma_adsorption_structure_set before molecular dynamics."
        ) from exc
    manifest = provenance["manifest"]
    artifact = provenance["artifact"]
    if manifest.get("kind") != "adsorption-set" or artifact.get("role") != "adsorbed":
        raise UMAError("UMA-MD input must be the adsorbed artifact from a standardized adsorption-set")
    if manifest.get("screening_ready", {}).get("adsorption") is not True:
        raise UMAError("standardized adsorption set is not marked adsorption-ready")
    if destination.exists():
        if not destination.is_dir():
            raise UMAError("output_dir must be a directory")
        if any(destination.iterdir()):
            raise UMAError("output_dir must be empty so trajectories cannot be appended to a previous run")

    task = _validate_task(task_name)
    if not str(model_name or "").strip():
        raise UMAError("model_name is required")
    if not str(device or "").strip():
        raise UMAError("device is required")
    matrix = _normalize_supercell(supercell)
    expansion_factor = math.prod(matrix)
    normalized_ensemble = str(ensemble or "").strip().lower()
    if normalized_ensemble not in {"nvt", "nve"}:
        raise UMAError("surface UMA-MD ensemble must be 'nvt' or 'nve'; NPT is not supported for vacuum slabs")
    target_temperature = _positive(temperature_k, "temperature_k")
    timestep = _positive(timestep_fs, "timestep_fs")
    equilibration = _positive(equilibration_ps, "equilibration_ps", allow_zero=True)
    production = _positive(production_ps, "production_ps")
    friction = _positive(
        friction_per_fs,
        "friction_per_fs",
        allow_zero=normalized_ensemble == "nve",
    )
    layer_tolerance = _positive(layer_tolerance_angstrom, "layer_tolerance_angstrom")
    collision_distance = _positive(collision_distance_angstrom, "collision_distance_angstrom")
    fmax = _positive(fmax_ev_per_angstrom, "fmax_ev_per_angstrom")
    bottom_layers = _integer(fixed_bottom_layers, "fixed_bottom_layers", minimum=0)
    relax_steps = _integer(max_relax_steps, "max_relax_steps", minimum=1)
    thermo_interval = _integer(thermo_interval_steps, "thermo_interval_steps", minimum=1)
    trajectory_interval = _integer(trajectory_interval_steps, "trajectory_interval_steps", minimum=1)
    normalized_seeds = _normalize_seeds(seeds)
    equilibration_steps = int(round(equilibration * 1000.0 / timestep))
    production_steps = int(round(production * 1000.0 / timestep))
    if production_steps < 1:
        raise UMAError("production_ps is shorter than one MD step")
    steps_per_seed = equilibration_steps + production_steps
    if steps_per_seed > 2_000_000:
        raise UMAError("requested duration exceeds the 2,000,000-step per-seed safety limit")

    try:
        from ase.io import read  # type: ignore
    except ImportError as exc:
        raise UMAError("ASE is required for UMA surface molecular dynamics") from exc
    try:
        input_atoms = read(source)
    except Exception as exc:
        raise UMAError(f"ASE could not read standardized adsorbed structure {source}: {exc}") from exc
    input_natoms = int(len(input_atoms))
    if input_natoms < 2:
        raise UMAError("adsorbed surface must contain at least two atoms")
    adsorbate_record = next(
        (row for row in manifest.get("artifacts", []) if row.get("role") == "adsorbate"),
        {},
    )
    input_adsorbate_atoms = int(adsorbate_record.get("natoms") or 0)
    input_substrate_atoms = input_natoms - input_adsorbate_atoms
    if input_adsorbate_atoms < 1 or input_substrate_atoms < 1:
        raise UMAError("adsorption-set manifest must declare positive substrate and adsorbate atom counts")
    input_atoms.set_array(
        "atom_role",
        np.asarray(
            ["substrate"] * input_substrate_atoms + ["adsorbate"] * input_adsorbate_atoms,
            dtype="U10",
        ),
    )
    declared_layers = int((manifest.get("surface") or {}).get("layers") or 0)
    if declared_layers and bottom_layers >= declared_layers and freeze_indices is None:
        raise UMAError(
            f"fixed_bottom_layers={bottom_layers} must be smaller than the declared {declared_layers} slab layers"
        )

    input_pbc = [bool(value) for value in input_atoms.pbc]
    input_area = _surface_area(input_atoms)
    if not math.isfinite(input_area) or input_area <= 1e-12:
        raise UMAError("adsorbed surface has no finite in-plane area")
    input_atoms.set_constraint()
    expanded = input_atoms.repeat(matrix)
    expanded.set_pbc((True, True, False))
    expanded_area = _surface_area(expanded)
    if not math.isclose(expanded_area / input_area, matrix[0] * matrix[1], rel_tol=1e-6, abs_tol=1e-6):
        raise UMAError("in-plane surface area did not scale consistently with the requested supercell")
    if freeze_indices is not None:
        fixed_indices = _replicate_indices(freeze_indices, input_natoms, expansion_factor)
        constraint_mode = "explicit_input_indices_replicated"
    else:
        fixed_indices = _bottom_layer_indices(expanded, bottom_layers, layer_tolerance)
        constraint_mode = "lowest_atomic_planes"
    from ase.constraints import FixAtoms  # type: ignore

    if fixed_indices:
        expanded.set_constraint(FixAtoms(indices=fixed_indices))
    initial_minimum_distance = _minimum_distance(expanded)
    if initial_minimum_distance is not None and initial_minimum_distance < collision_distance:
        raise UMAError(
            f"expanded input minimum distance {initial_minimum_distance:.4f} A is below the "
            f"{collision_distance:.4f} A collision guard"
        )

    calculator, fairchem_version = _load_calculator(str(model_name).strip(), task, str(device).strip())
    destination.mkdir(parents=True, exist_ok=True)
    expanded_initial = destination / "expanded-initial.extxyz"
    _write_structure(expanded_initial, expanded)
    relaxation: dict[str, Any] = {"status": "skipped"}
    if pre_relax:
        relaxation = _relax(expanded, calculator, fmax, relax_steps, None, "expanded-adsorbed")
    else:
        expanded.calc = calculator
    prepared = destination / "prepared-for-md.extxyz"
    _write_structure(prepared, expanded)

    replica_summaries: list[dict[str, Any]] = []
    replica_artifacts: list[Path] = []
    for seed in normalized_seeds:
        summary, paths = _run_replica(
            expanded,
            calculator,
            destination,
            seed=seed,
            ensemble=normalized_ensemble,
            temperature_k=target_temperature,
            timestep_fs=timestep,
            equilibration_steps=equilibration_steps,
            production_steps=production_steps,
            friction_per_fs=friction,
            thermo_interval_steps=thermo_interval,
            trajectory_interval_steps=trajectory_interval,
            collision_distance_angstrom=collision_distance,
        )
        replica_summaries.append(summary)
        replica_artifacts.extend(paths)

    local_checkpoint = _resolve_local_checkpoint(str(model_name).strip())
    all_artifacts = [expanded_initial, prepared, *replica_artifacts]
    completed_replicas = sum(row["status"] == "completed" for row in replica_summaries)
    collision_guard_passed = all(
        row.get("minimum_distance_angstrom") is None
        or float(row["minimum_distance_angstrom"]) >= collision_distance
        for row in replica_summaries
    )
    result: dict[str, Any] = {
        "schema_version": MD_SCHEMA_VERSION,
        "simulation_type": "uma_surface_md",
        "status": (
            "completed"
            if all(row["status"] == "completed" for row in replica_summaries)
            else "completed_with_failures"
        ),
        "input": {
            "path": source.as_posix(),
            "sha256": _sha256(source),
            "standardization_manifest": provenance["manifest_path"],
            "standardization_manifest_sha256": _sha256(Path(provenance["manifest_path"])),
            "natoms": input_natoms,
            "substrate_natoms": input_substrate_atoms,
            "adsorbate_natoms": input_adsorbate_atoms,
            "pbc": input_pbc,
            "surface_area_angstrom2": input_area,
        },
        "model": {
            "name": str(model_name).strip(),
            "task_name": task,
            "device": str(device).strip(),
            "fairchem_core_version": fairchem_version,
            "checkpoint": local_checkpoint.name if local_checkpoint is not None else None,
            "checkpoint_sha256": _sha256(local_checkpoint) if local_checkpoint is not None else None,
            "weight_source": "local_checkpoint" if local_checkpoint is not None else "fairchem_pretrained_registry",
        },
        "execution_runtime": {
            "kind": "direct",
            "platform": sys.platform,
            "python": str(Path(sys.executable).resolve()),
        },
        "expansion": {
            "supercell": list(matrix),
            "factor": expansion_factor,
            "coverage_policy": "preserve_by_replicating_complete_adsorbed_system",
            "expanded_natoms": int(len(expanded)),
            "expanded_substrate_natoms": input_substrate_atoms * expansion_factor,
            "expanded_adsorbate_natoms": input_adsorbate_atoms * expansion_factor,
            "surface_area_angstrom2": expanded_area,
            "pbc": [True, True, False],
        },
        "constraints": {
            "mode": constraint_mode,
            "fixed_bottom_layers": bottom_layers if freeze_indices is None else None,
            "fixed_indices": fixed_indices,
            "fixed_atom_count": len(fixed_indices),
            "mobile_atom_count": int(len(expanded)) - len(fixed_indices),
            "layer_tolerance_angstrom": layer_tolerance if freeze_indices is None else None,
        },
        "protocol": {
            "engine": "ase",
            "potential": "fairchem-uma",
            "ensemble": normalized_ensemble,
            "thermostat": "langevin" if normalized_ensemble == "nvt" else None,
            "temperature_k": target_temperature,
            "timestep_fs": timestep,
            "equilibration_ps": equilibration,
            "production_ps": production,
            "equilibration_steps": equilibration_steps,
            "production_steps": production_steps,
            "friction_per_fs": friction if normalized_ensemble == "nvt" else None,
            "seeds": normalized_seeds,
            "thermo_interval_steps": thermo_interval,
            "trajectory_interval_steps": trajectory_interval,
            "trajectory_preview_max_frames": DEFAULT_TRAJECTORY_PREVIEW_MAX_FRAMES,
            "collision_distance_angstrom": collision_distance,
            "ordinary_3d_npt_allowed": False,
        },
        "pre_relaxation": relaxation,
        "replicas": replica_summaries,
        "quality_gates": {
            "decision": (
                "pass"
                if completed_replicas == len(replica_summaries) and collision_guard_passed
                else "hold"
            ),
            "finite_energy_force_temperature_required": True,
            "collision_guard_passed": collision_guard_passed,
            "collision_distance_angstrom": collision_distance,
            "completed_replicas": completed_replicas,
            "required_replicas": len(replica_summaries),
            "temperature_is_a_recorded_operating_condition_not_a_bulk_thermal_stability_gate": True,
        },
        "artifacts": [
            _artifact(path, destination, kind=_artifact_kind(path))
            for path in all_artifacts
        ],
        "limitations": [
            "UMA-MD is an ML-potential screening calculation, not converged DFT molecular dynamics.",
            "No electrode potential, pH, implicit solvent, or explicit electrolyte is added unless present in the input and model protocol.",
            "Adsorbates are replicated with the complete input cell, so the supplied coverage is preserved rather than inferred.",
            "Representative and anomalous frames require same-protocol DFT energy/force calibration before mechanistic claims.",
        ],
        "required_next_step": "calibrate representative and closest-contact frames against same-protocol DFT energies and forces",
    }
    manifest_path = destination / "md-manifest.json"
    temporary = manifest_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    temporary.replace(manifest_path)
    result["manifest"] = manifest_path.as_posix()
    result["manifest_sha256"] = _sha256(manifest_path)
    result["output_dir"] = destination.as_posix()
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run governed ASE surface molecular dynamics with FAIR Chemistry UMA")
    parser.add_argument("--adsorbed", required=True, help="standardized adsorbed surface structure")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--task", default=DEFAULT_TASK, choices=sorted(SUPPORTED_TASKS))
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--supercell", nargs=3, type=int, default=list(DEFAULT_SUPERCELL))
    parser.add_argument("--ensemble", choices=("nvt", "nve"), default="nvt")
    parser.add_argument("--temperature-k", type=float, default=300.0)
    parser.add_argument("--timestep-fs", type=float, default=DEFAULT_TIMESTEP_FS)
    parser.add_argument("--equilibration-ps", type=float, default=5.0)
    parser.add_argument("--production-ps", type=float, default=20.0)
    parser.add_argument("--friction-per-fs", type=float, default=0.01)
    parser.add_argument("--seed", action="append", type=int)
    parser.add_argument("--fixed-bottom-layers", type=int, default=2)
    parser.add_argument("--freeze-index", action="append", type=int)
    parser.add_argument("--layer-tolerance", type=float, default=0.25)
    parser.add_argument("--no-pre-relax", action="store_true")
    parser.add_argument("--fmax", type=float, default=0.05)
    parser.add_argument("--max-relax-steps", type=int, default=200)
    parser.add_argument("--thermo-interval", type=int, default=10)
    parser.add_argument("--trajectory-interval", type=int, default=10)
    parser.add_argument("--collision-distance", type=float, default=0.6)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = run_uma_surface_md(
            args.adsorbed,
            args.output_dir,
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
            "schema_version": MD_SCHEMA_VERSION,
            "simulation_type": "uma_surface_md",
            "status": "error",
            "error": str(exc),
        }
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return 0 if result.get("status") == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))


__all__ = ["DEFAULT_SEEDS", "DEFAULT_SUPERCELL", "MD_SCHEMA_VERSION", "run_uma_surface_md"]
