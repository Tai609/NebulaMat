"""Optional FAIR Chemistry UMA adapter for catalyst adsorption screening.

The adapter is deliberately opt-in.  It keeps the fairchem dependency and
Hugging Face gated weights out of the ordinary materials-MCP environment while
providing one auditable protocol for three-energy adsorption calculations.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Iterable

try:
    from .structure_standardizer import StandardizationError, validate_standardized_artifact
except ImportError:  # pragma: no cover - supports direct CLI execution
    from structure_standardizer import StandardizationError, validate_standardized_artifact


UMA_SCHEMA_VERSION = 1
DEFAULT_MODEL = "uma-s-1p2p1"
DEFAULT_TASK = "oc25"
DEFAULT_LOCAL_CHECKPOINT = "uma-s-1p2p1.pt"
SUPPORTED_TASKS = {"oc20", "oc22", "oc25", "omat", "omol", "odac", "omc"}


class UMAError(RuntimeError):
    """Raised when UMA cannot be loaded or a screening input is invalid."""


def _finite(value: Any, name: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise UMAError(f"{name} must be numeric") from exc
    if not math.isfinite(parsed):
        raise UMAError(f"{name} must be finite")
    return parsed


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def adsorption_energy_ev(
    adsorbed_energy_ev: float,
    slab_energy_ev: float,
    adsorbate_energy_ev: float,
) -> float:
    """Return E(slab+adsorbate) - E(slab) - E(adsorbate) in eV."""
    return (
        _finite(adsorbed_energy_ev, "adsorbed_energy_ev")
        - _finite(slab_energy_ev, "slab_energy_ev")
        - _finite(adsorbate_energy_ev, "adsorbate_energy_ev")
    )


def _validate_task(task_name: str) -> str:
    task = str(task_name or "").strip().lower()
    if task not in SUPPORTED_TASKS:
        raise UMAError(
            f"unsupported UMA task {task_name!r}; choose one of {sorted(SUPPORTED_TASKS)}"
        )
    return task


def _resolve_local_checkpoint(model_name: str) -> Path | None:
    """Find the pinned workspace checkpoint before consulting Hugging Face.

    FairChem 2.21 renamed the registry entry to ``uma-s-1p2`` while the
    workspace still carries the hash-pinned ``uma-s-1p2p1.pt`` artifact.  A
    direct checkpoint load keeps that artifact reproducible across the rename.
    """
    if model_name != DEFAULT_MODEL:
        return None
    candidates: list[Path] = []
    configured = str(os.getenv("NEBULAMAT_UMA_WEIGHTS") or "").strip()
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.extend(
        [
            Path.cwd() / "runtime" / "uma" / "models" / DEFAULT_LOCAL_CHECKPOINT,
            Path(__file__).resolve().parents[2] / "uma" / "models" / DEFAULT_LOCAL_CHECKPOINT,
        ]
    )
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file():
            return resolved
    return None


def _load_calculator(model_name: str, task_name: str, device: str) -> tuple[Any, str | None]:
    try:
        from fairchem.core import FAIRChemCalculator, pretrained_mlip  # type: ignore
    except ImportError as exc:
        raise UMAError(
            "fairchem is not installed; install the optional UMA environment with "
            "pip install -e 'runtime/materials-mcp[uma]'"
        ) from exc

    try:
        checkpoint = _resolve_local_checkpoint(model_name)
        if checkpoint is not None:
            from fairchem.core.units.mlip_unit import load_predict_unit  # type: ignore

            predictor = load_predict_unit(str(checkpoint), device=device)
        else:
            # FairChem 2.21 uses ``uma-s-1p2`` for the model formerly exposed
            # by this workspace as ``uma-s-1p2p1``.
            registry_name = "uma-s-1p2" if model_name == DEFAULT_MODEL else model_name
            predictor = pretrained_mlip.get_predict_unit(registry_name, device=device)
        calculator = FAIRChemCalculator(predictor, task_name=task_name)
    except Exception as exc:  # fairchem surfaces HF auth and CUDA errors here
        raise UMAError(
            f"could not load UMA model {model_name!r} for task {task_name!r}: {exc}. "
            "Check Hugging Face access to facebook/UMA, `hf auth login`, and the device."
        ) from exc
    try:
        version = importlib.metadata.version("fairchem-core")
    except importlib.metadata.PackageNotFoundError:
        version = None
    return calculator, version


def _read_atoms(path: Path) -> Any:
    try:
        from ase.io import read  # type: ignore
    except ImportError as exc:
        raise UMAError("ASE is required for UMA structure screening") from exc
    if not path.is_file():
        raise UMAError(f"structure file does not exist: {path}")
    try:
        return read(path)
    except Exception as exc:
        raise UMAError(f"ASE could not read structure {path}: {exc}") from exc


def _attach_freeze_constraint(atoms: Any, indices: Iterable[int] | None, label: str) -> None:
    values = [int(index) for index in (indices or [])]
    if not values:
        return
    if any(index < 0 or index >= len(atoms) for index in values):
        raise UMAError(f"{label} contains an atom index outside 0..{len(atoms) - 1}")
    try:
        from ase.constraints import FixAtoms  # type: ignore
    except ImportError as exc:
        raise UMAError("ASE constraints are required when freeze_indices is supplied") from exc
    atoms.set_constraint(FixAtoms(indices=sorted(set(values))))


def _bottom_layer_indices(atoms: Any, layer_count: int, tolerance_angstrom: float = 0.25) -> list[int]:
    """Return atom indices in the bottom real planes along cross(a, b)."""
    if isinstance(layer_count, bool):
        raise UMAError("fixed_bottom_layers must be an integer")
    try:
        requested = int(layer_count)
    except (TypeError, ValueError) as exc:
        raise UMAError("fixed_bottom_layers must be an integer") from exc
    if requested < 1:
        raise UMAError("fixed_bottom_layers must be at least 1")
    tolerance = _finite(tolerance_angstrom, "layer_tolerance_angstrom")
    if tolerance <= 0:
        raise UMAError("layer_tolerance_angstrom must be positive")

    cell = [[float(value) for value in row] for row in atoms.cell.array]
    normal = [
        cell[0][1] * cell[1][2] - cell[0][2] * cell[1][1],
        cell[0][2] * cell[1][0] - cell[0][0] * cell[1][2],
        cell[0][0] * cell[1][1] - cell[0][1] * cell[1][0],
    ]
    norm = math.sqrt(sum(value * value for value in normal))
    if norm <= 1e-12:
        raise UMAError("surface lattice vectors a and b are collinear")
    normal = [value / norm for value in normal]
    if sum(normal[index] * cell[2][index] for index in range(3)) < 0:
        normal = [-value for value in normal]

    projected = sorted(
        (
            sum(float(position[index]) * normal[index] for index in range(3)),
            atom_index,
        )
        for atom_index, position in enumerate(atoms.get_positions())
    )
    groups: list[dict[str, Any]] = []
    for projection, atom_index in projected:
        if not groups or projection - float(groups[-1]["center"]) > tolerance:
            groups.append({"center": projection, "indices": [atom_index]})
        else:
            group = groups[-1]
            group["indices"].append(atom_index)
            count = len(group["indices"])
            group["center"] = (float(group["center"]) * (count - 1) + projection) / count
    if requested >= len(groups):
        raise UMAError(
            f"fixed_bottom_layers={requested} leaves no mobile atomic plane; detected {len(groups)} planes"
        )
    return sorted(index for group in groups[:requested] for index in group["indices"])


def _relax(atoms: Any, calculator: Any, fmax: float, max_steps: int, freeze_indices: Iterable[int] | None, label: str) -> dict[str, Any]:
    _attach_freeze_constraint(atoms, freeze_indices, label)
    atoms.calc = calculator
    try:
        from ase.optimize import LBFGS  # type: ignore

        optimizer = LBFGS(atoms, logfile=None)
        optimizer.run(fmax=fmax, steps=max_steps)
        forces = atoms.get_forces()
        force_norm = max((float((force * force).sum() ** 0.5) for force in forces), default=0.0)
        return {
            "status": "converged" if force_norm <= fmax else "not_converged",
            "max_force_ev_per_angstrom": force_norm,
            "fmax_ev_per_angstrom": fmax,
            "max_steps": max_steps,
        }
    except Exception as exc:
        raise UMAError(f"UMA relaxation failed for {label}: {exc}") from exc


def _energy(atoms: Any, calculator: Any) -> float:
    atoms.calc = calculator
    try:
        return _finite(atoms.get_potential_energy(), "potential_energy_ev")
    except Exception as exc:
        raise UMAError(f"UMA energy evaluation failed: {exc}") from exc


def _write_relaxed_structure(atoms: Any, output_dir: Path, label: str) -> str:
    try:
        from ase.io import write  # type: ignore

        output_dir.mkdir(parents=True, exist_ok=True)
        # Extended XYZ preserves the cell and periodic flags for the next
        # structure-conversion step; plain XYZ would silently lose them.
        target = output_dir / f"uma-relaxed-{label}.extxyz"
        write(target, atoms)
        return target.as_posix()
    except Exception as exc:
        raise UMAError(f"could not write relaxed {label} structure: {exc}") from exc


def run_uma_adsorption_screen(
    slab_path: str | Path,
    adsorbate_path: str | Path,
    adsorbed_path: str | Path,
    *,
    model_name: str = DEFAULT_MODEL,
    task_name: str = DEFAULT_TASK,
    device: str = "cuda",
    relax: bool = True,
    fmax_ev_per_angstrom: float = 0.05,
    max_steps: int = 200,
    freeze_indices: Iterable[int] | None = None,
    fixed_bottom_layers: int = 3,
    layer_tolerance_angstrom: float = 0.25,
    output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Run a same-model UMA adsorption-energy screen.

    The three input structures must use the same cell, composition convention,
    charge/magnetic protocol, and calculator task.  ``freeze_indices`` refers
    to the slab and adsorbed-system atom ordering; it is not applied to the
    isolated adsorbate.  This is an initial screen, not a DFT result.
    """
    task = _validate_task(task_name)
    if not str(model_name or "").strip():
        raise UMAError("model_name is required")
    if not str(device or "").strip():
        raise UMAError("device is required")
    if relax is not True:
        raise UMAError(
            "relaxation is mandatory for UMA adsorption screening; "
            "slab, isolated adsorbate, and adsorbed slab must converge before energies are evaluated"
        )
    fmax = _finite(fmax_ev_per_angstrom, "fmax_ev_per_angstrom")
    if fmax <= 0:
        raise UMAError("fmax_ev_per_angstrom must be positive")
    try:
        steps = int(max_steps)
    except (TypeError, ValueError) as exc:
        raise UMAError("max_steps must be an integer") from exc
    if steps < 1 or steps > 10000:
        raise UMAError("max_steps must be between 1 and 10000")
    if isinstance(fixed_bottom_layers, bool):
        raise UMAError("fixed_bottom_layers must be an integer")
    try:
        bottom_layers = int(fixed_bottom_layers)
    except (TypeError, ValueError) as exc:
        raise UMAError("fixed_bottom_layers must be an integer") from exc
    if bottom_layers < 1:
        raise UMAError("fixed_bottom_layers must be at least 1")
    layer_tolerance = _finite(layer_tolerance_angstrom, "layer_tolerance_angstrom")
    if layer_tolerance <= 0:
        raise UMAError("layer_tolerance_angstrom must be positive")
    try:
        manual_freeze_indices = sorted({int(index) for index in (freeze_indices or [])})
    except (TypeError, ValueError) as exc:
        raise UMAError("freeze_indices must contain integers") from exc

    paths = {
        "slab": Path(slab_path).resolve(),
        "adsorbate": Path(adsorbate_path).resolve(),
        "adsorbed": Path(adsorbed_path).resolve(),
    }
    for label, path in paths.items():
        if not path.is_file():
            raise UMAError(f"{label} structure file does not exist: {path}")
    if len(set(paths.values())) != len(paths):
        raise UMAError("slab, adsorbate, and adsorbed structure paths must be distinct")

    provenances: dict[str, dict[str, Any]] = {}
    expected_kinds = {"slab": "surface", "adsorbate": "adsorbate", "adsorbed": "surface"}
    for label, path in paths.items():
        try:
            provenances[label] = validate_standardized_artifact(path, expected_kinds[label])
        except StandardizationError as exc:
            raise UMAError(
                f"UMA adsorption screening requires standardized {label} input: {exc}. "
                "Provide slab, isolated adsorbate, and adsorbed-system artifacts with matching provenance; raw CIFs are not eligible."
            ) from exc
    slab_manifest = provenances["slab"]["manifest"]
    adsorbed_manifest = provenances["adsorbed"]["manifest"]
    slab_surface = slab_manifest.get("surface") or {}
    adsorbed_surface = adsorbed_manifest.get("surface") or {}
    for field in ("miller_index", "layers"):
        if slab_surface.get(field) != adsorbed_surface.get(field):
            raise UMAError(
                f"slab and adsorbed structures must share standardized surface {field}; "
                f"received {slab_surface.get(field)!r} and {adsorbed_surface.get(field)!r}"
            )

    calculator, fairchem_version = _load_calculator(str(model_name).strip(), task, str(device).strip())
    atoms = {label: _read_atoms(path) for label, path in paths.items()}
    input_records = {
        label: {
            "path": path.as_posix(),
            "sha256": _sha256(path),
            "natoms": int(len(atoms[label])),
            "formula": str(atoms[label].get_chemical_formula()),
            "standardization_manifest": provenances[label]["manifest_path"],
            "standardized_kind": provenances[label]["artifact"].get("kind"),
        }
        for label, path in paths.items()
    }

    if manual_freeze_indices:
        resolved_freeze_indices = {
            "slab": manual_freeze_indices,
            "adsorbed": manual_freeze_indices,
        }
        constraint_mode = "explicit_indices"
    else:
        resolved_freeze_indices = {
            "slab": _bottom_layer_indices(atoms["slab"], bottom_layers, layer_tolerance),
            "adsorbed": _bottom_layer_indices(atoms["adsorbed"], bottom_layers, layer_tolerance),
        }
        constraint_mode = "bottom_atomic_planes"

    relaxation = {
        "slab": _relax(
            atoms["slab"], calculator, fmax, steps, resolved_freeze_indices["slab"], "slab"
        ),
        "adsorbate": _relax(atoms["adsorbate"], calculator, fmax, steps, None, "adsorbate"),
        "adsorbed": _relax(
            atoms["adsorbed"],
            calculator,
            fmax,
            steps,
            resolved_freeze_indices["adsorbed"],
            "adsorbed",
        ),
    }

    relaxed_artifacts: dict[str, str] = {}
    if output_dir is not None:
        destination = Path(output_dir).resolve()
        for label in paths:
            relaxed_artifacts[label] = _write_relaxed_structure(atoms[label], destination, label)

    result: dict[str, Any] = {
        "schema_version": UMA_SCHEMA_VERSION,
        "screen_type": "uma_adsorption_energy",
        "status": "completed",
        "model": {
            "name": str(model_name).strip(),
            "task_name": task,
            "device": str(device).strip(),
            "fairchem_core_version": fairchem_version,
        },
        "inputs": input_records,
        "protocol": {
            "relax": True,
            "fmax_ev_per_angstrom": fmax,
            "max_steps": steps,
            "constraint_mode": constraint_mode,
            "fixed_bottom_layers": bottom_layers if constraint_mode == "bottom_atomic_planes" else None,
            "layer_tolerance_angstrom": layer_tolerance,
            "freeze_indices": resolved_freeze_indices,
            "energy_expression": "E(slab+adsorbate) - E(slab) - E(adsorbate)",
            "negative_values": "exothermic under this sign convention",
        },
        "relaxation": relaxation,
        "limitations": [
            "UMA is an ML energy/force model and this value is an initial screen, not a converged DFT result.",
            "The calculation does not include an implicit solvent, electrode potential, pH, coverage correction, or field unless those effects are encoded in the supplied structures/model.",
            "Surface reconstruction, spin/charge states, and adsorbate reference conventions must be checked with the VASP protocol before experimental decisions.",
            "All three energies must use this same UMA model and task; do not mix MatterSim and fairchem energies in the adsorption-energy expression.",
        ],
    }
    if relaxed_artifacts:
        result["relaxed_structure_artifacts"] = relaxed_artifacts
    if any(record.get("status") != "converged" for record in relaxation.values()):
        result["status"] = "hold"
        result["next_step"] = (
            "increase the relaxation budget or correct the starting geometry, then rerun all three relaxations; "
            "adsorption energies are intentionally withheld until every structure converges"
        )
        return result

    energies = {label: _energy(atoms[label], calculator) for label in paths}
    result["energies_ev"] = energies
    result["adsorption_energy_ev"] = adsorption_energy_ev(
        energies["adsorbed"], energies["slab"], energies["adsorbate"]
    )
    result["uncertainty"] = {
        "status": "not_calibrated",
        "value_ev": None,
        "required_next_step": "calibrate against same-protocol VASP calculations on representative surfaces and adsorbates",
    }
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a governed fairchem/UMA adsorption-energy screen")
    parser.add_argument("--slab", required=True, help="slab structure path")
    parser.add_argument("--adsorbate", required=True, help="isolated adsorbate structure path")
    parser.add_argument("--adsorbed", required=True, help="adsorbed slab structure path")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--task", default=DEFAULT_TASK, choices=sorted(SUPPORTED_TASKS))
    parser.add_argument("--device", default="cuda")
    parser.add_argument(
        "--relax",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="mandatory relaxation of all three structures before evaluating energies",
    )
    parser.add_argument("--fmax", type=float, default=0.05)
    parser.add_argument("--max-steps", type=int, default=200)
    parser.add_argument("--freeze-index", action="append", type=int, default=[])
    parser.add_argument("--fixed-bottom-layers", type=int, default=3)
    parser.add_argument("--layer-tolerance", type=float, default=0.25)
    parser.add_argument("--output-dir")
    parser.add_argument("--output-json", help="write the JSON result to this path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = run_uma_adsorption_screen(
            args.slab,
            args.adsorbate,
            args.adsorbed,
            model_name=args.model,
            task_name=args.task,
            device=args.device,
            relax=args.relax,
            fmax_ev_per_angstrom=args.fmax,
            max_steps=args.max_steps,
            freeze_indices=args.freeze_index,
            fixed_bottom_layers=args.fixed_bottom_layers,
            layer_tolerance_angstrom=args.layer_tolerance,
            output_dir=args.output_dir,
        )
    except UMAError as exc:
        result = {"schema_version": UMA_SCHEMA_VERSION, "screen_type": "uma_adsorption_energy", "status": "error", "error": str(exc)}
    payload = json.dumps(result, indent=2, ensure_ascii=True)
    print(payload)
    if args.output_json:
        target = Path(args.output_json)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(payload + "\n", encoding="utf-8")
        temporary.replace(target)
    return 0 if result.get("status") == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
