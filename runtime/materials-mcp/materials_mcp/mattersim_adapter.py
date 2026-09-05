"""Optional MatterSim-v1.0.0-5M adapter for first-stage structure screening.

MatterSim-v1 is primarily a bulk-material model.  This adapter exposes its
energy/force/stress calculation and relaxation as a reproducible pre-screen,
while keeping slab results explicitly qualitative until they are calibrated by
the project's VASP protocol.
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
from typing import Any

try:
    from .structure_standardizer import StandardizationError, validate_standardized_artifact
except ImportError:  # pragma: no cover - supports direct CLI execution
    from structure_standardizer import StandardizationError, validate_standardized_artifact


MATTERSIM_SCHEMA_VERSION = 1
DEFAULT_CHECKPOINT_NAME = "mattersim-v1.0.0-5M.pth"
DEFAULT_MODEL_ID = "MatterSim-v1.0.0-5M"
MATTERSIM_SOURCE_URL = (
    "https://github.com/microsoft/mattersim/blob/v1.0.0/"
    "pretrained_models/mattersim-v1.0.0-5M.pth"
)
STRUCTURE_KINDS = {"bulk", "slab", "interface", "molecule"}


class MatterSimError(RuntimeError):
    """Raised when MatterSim cannot be loaded or an input is invalid."""


def _finite(value: Any, name: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise MatterSimError(f"{name} must be numeric") from exc
    if not math.isfinite(parsed):
        raise MatterSimError(f"{name} must be finite")
    return parsed


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_checkpoint(model_path: str | Path | None, workspace_root: Path | None) -> Path:
    requested = str(model_path or "").strip()
    candidates: list[Path] = []
    if requested:
        alias = requested.lower()
        if alias in {"5m", "mattersim-v1.0.0-5m", "mattersim-v1.0.0-5m.pth"}:
            requested = DEFAULT_CHECKPOINT_NAME
        candidates.append(Path(requested).expanduser())
    else:
        configured = str(os.getenv("NEBULAMAT_MATTERSIM_MODEL") or "").strip()
        if configured:
            candidates.append(Path(configured).expanduser())
        if workspace_root is not None:
            candidates.append(Path(workspace_root) / "runtime" / "mattersim" / "models" / DEFAULT_CHECKPOINT_NAME)
            candidates.append(Path(workspace_root) / "runtime" / "mattersim" / "models" / "MatterSim-v1.0.0-5M.pth")
        candidates.append(Path.home() / ".local" / "mattersim" / "pretrained_models" / DEFAULT_CHECKPOINT_NAME)
        candidates.append(Path.home() / ".local" / "mattersim" / "pretrained_models" / "MatterSim-v1.0.0-5M.pth")

    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file():
            return resolved
    searched = ", ".join(str(path.resolve()) for path in candidates) or "no path"
    raise MatterSimError(
        f"MatterSim checkpoint {DEFAULT_CHECKPOINT_NAME} was not found; searched: {searched}. "
        f"Download the official v1.0.0-5M file from {MATTERSIM_SOURCE_URL} "
        "or set NEBULAMAT_MATTERSIM_MODEL."
    )


def _read_atoms(path: Path) -> Any:
    try:
        from ase.io import read  # type: ignore
    except ImportError as exc:
        raise MatterSimError("ASE is required for MatterSim screening") from exc
    if not path.is_file():
        raise MatterSimError(f"structure file does not exist: {path}")
    try:
        return read(path)
    except Exception as exc:
        raise MatterSimError(f"ASE could not read structure {path}: {exc}") from exc


def _load_calculator(checkpoint: Path, device: str) -> tuple[Any, str | None]:
    try:
        from mattersim.forcefield import MatterSimCalculator  # type: ignore
    except ImportError as exc:
        raise MatterSimError(
            "MatterSim is not installed; install the optional v1 environment with "
            "pip install -e 'runtime/materials-mcp[mattersim]'"
        ) from exc
    try:
        calculator = MatterSimCalculator(
            load_path=str(checkpoint),
            device=str(device).strip(),
            compute_stress=True,
        )
    except Exception as exc:
        raise MatterSimError(
            f"could not load MatterSim checkpoint {checkpoint}: {exc}. "
            "Check the v1.0.0-5M file, Python/Torch compatibility, and device."
        ) from exc
    try:
        version = importlib.metadata.version("mattersim")
    except importlib.metadata.PackageNotFoundError:
        version = None
    return calculator, version


def _max_force(forces: Any) -> float:
    return max(
        (
            math.sqrt(sum(float(component) ** 2 for component in force))
            for force in forces
        ),
        default=0.0,
    )


def _snapshot(atoms: Any, calculator: Any) -> dict[str, Any]:
    atoms.calc = calculator
    try:
        energy = _finite(atoms.get_potential_energy(), "energy_ev")
        forces = atoms.get_forces()
        force_max = _max_force(forces)
    except Exception as exc:
        raise MatterSimError(f"MatterSim property evaluation failed: {exc}") from exc
    result: dict[str, Any] = {
        "energy_ev": energy,
        "energy_per_atom_ev": energy / len(atoms) if len(atoms) else None,
        "max_force_ev_per_angstrom": force_max,
    }
    try:
        from ase.units import GPa  # type: ignore

        stress = atoms.get_stress(voigt=False)
        result["stress_gpa"] = [
            [_finite(component, "stress_gpa") / GPa for component in row]
            for row in stress
        ]
    except Exception:
        result["stress_gpa"] = None
    return result


def _relax(
    atoms: Any,
    calculator: Any,
    fmax: float,
    max_steps: int,
    relax_cell: bool,
) -> dict[str, Any]:
    atoms.calc = calculator
    try:
        from ase.optimize import FIRE  # type: ignore

        target = atoms
        if relax_cell:
            from ase.filters import FrechetCellFilter  # type: ignore

            target = FrechetCellFilter(atoms)
        optimizer = FIRE(target, logfile=None)
        optimizer.run(fmax=fmax, steps=max_steps)
    except Exception as exc:
        raise MatterSimError(f"MatterSim relaxation failed: {exc}") from exc
    final = _snapshot(atoms, calculator)
    return {
        "status": "converged" if final["max_force_ev_per_angstrom"] <= fmax else "not_converged",
        "fmax_ev_per_angstrom": fmax,
        "max_steps": max_steps,
        "relax_cell": relax_cell,
        "final_max_force_ev_per_angstrom": final["max_force_ev_per_angstrom"],
    }


def _write_relaxed_structure(atoms: Any, output_dir: Path) -> str:
    try:
        from ase.io import write  # type: ignore

        output_dir.mkdir(parents=True, exist_ok=True)
        target = output_dir / "mattersim-relaxed.extxyz"
        write(target, atoms)
        return target.as_posix()
    except Exception as exc:
        raise MatterSimError(f"could not write MatterSim relaxed structure: {exc}") from exc


def run_mattersim_stability_screen(
    structure_path: str | Path,
    *,
    model_path: str | Path | None = None,
    workspace_root: str | Path | None = None,
    device: str = "cuda",
    structure_kind: str = "bulk",
    relax: bool = True,
    relax_cell: bool = False,
    fmax_ev_per_angstrom: float = 0.05,
    max_steps: int = 200,
    max_displacement_angstrom: float = 0.75,
    output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Evaluate and optionally relax one structure with MatterSim-v1.0.0-5M."""
    kind = str(structure_kind or "").strip().lower()
    if kind not in STRUCTURE_KINDS:
        raise MatterSimError(f"unsupported structure_kind {structure_kind!r}; choose one of {sorted(STRUCTURE_KINDS)}")
    if relax_cell and kind not in {"bulk", "interface"}:
        raise MatterSimError("relax_cell is only allowed for bulk or interface structures")
    fmax = _finite(fmax_ev_per_angstrom, "fmax_ev_per_angstrom")
    displacement_limit = _finite(max_displacement_angstrom, "max_displacement_angstrom")
    if fmax <= 0 or displacement_limit <= 0:
        raise MatterSimError("fmax_ev_per_angstrom and max_displacement_angstrom must be positive")
    try:
        steps = int(max_steps)
    except (TypeError, ValueError) as exc:
        raise MatterSimError("max_steps must be an integer") from exc
    if steps < 1 or steps > 10000:
        raise MatterSimError("max_steps must be between 1 and 10000")

    path = Path(structure_path).resolve()
    if not path.is_file():
        raise MatterSimError(f"structure file does not exist: {path}")
    expected_standardized_kind = {"bulk": "bulk", "slab": "surface"}.get(kind)
    try:
        provenance = validate_standardized_artifact(path, expected_standardized_kind)
    except StandardizationError as exc:
        raise MatterSimError(
            f"MatterSim screening requires a standardized structure: {exc}. "
            "Use the standardized bulk/surface artifact from mattergen-run.json; raw structure-*.cif files are not valid inputs."
        ) from exc
    root = Path(workspace_root).resolve() if workspace_root else None
    checkpoint = _resolve_checkpoint(model_path, root)
    calculator, mattersim_version = _load_calculator(checkpoint, str(device).strip() or "cpu")
    atoms = _read_atoms(path)
    initial_positions = atoms.get_positions().copy()
    initial_cell = atoms.cell.array.copy()
    initial = _snapshot(atoms, calculator)
    relaxation: dict[str, Any] = {"status": "skipped"}
    if relax:
        relaxation = _relax(atoms, calculator, fmax, steps, relax_cell)
    final = _snapshot(atoms, calculator)
    displacement = max(
        (
            math.sqrt(sum(float(component) ** 2 for component in delta))
            for delta in (atoms.get_positions() - initial_positions)
        ),
        default=0.0,
    )
    cell_change = max(
        (
            abs(float(atoms.cell.array[row][column] - initial_cell[row][column]))
            for row in range(3)
            for column in range(3)
        ),
        default=0.0,
    )
    converged = not relax or relaxation.get("status") == "converged"
    geometry_reasonable = displacement <= displacement_limit
    decision = "promote_to_next_stage" if converged and geometry_reasonable else "hold"
    result: dict[str, Any] = {
        "schema_version": MATTERSIM_SCHEMA_VERSION,
        "screen_type": "mattersim_stability_proxy",
        "status": "completed",
        "model": {
            "id": DEFAULT_MODEL_ID,
            "checkpoint": checkpoint.name,
            "checkpoint_sha256": _sha256(checkpoint),
            "package_version": mattersim_version,
            "device": str(device).strip() or "cpu",
            "source": MATTERSIM_SOURCE_URL,
        },
        "input": {
            "path": path.as_posix(),
            "sha256": _sha256(path),
            "formula": str(atoms.get_chemical_formula()),
            "natoms": int(len(atoms)),
            "structure_kind": kind,
            "standardization_manifest": provenance["manifest_path"],
            "standardized_kind": provenance["artifact"].get("kind"),
        },
        "initial": initial,
        "final": final,
        "relaxation": relaxation,
        "geometry_change": {
            "max_displacement_angstrom": displacement,
            "max_cell_component_change_angstrom": cell_change,
            "max_displacement_limit_angstrom": displacement_limit,
        },
        "decision": decision,
        "decision_basis": "relaxation convergence and geometry-change proxy; not a formation-energy or energy-above-hull proof",
        "next_stage": "surface_construction_and_uma" if kind == "bulk" else "uma_adsorption_screen",
        "limitations": [
            "MatterSim-v1.0.0 is trained primarily for bulk materials; slab, interface, and surface energies are qualitative pre-screen evidence until calibrated against VASP.",
            "Energy per atom is not comparable across different chemical compositions without a consistent reference scheme and should not be treated as Materials Project energy above hull.",
            "The screen does not establish aqueous stability, dissolution resistance, surface reconstruction, electrochemical active phase, or synthesizability.",
            "A converged relaxation is a geometry/force result, not proof that the phase exists under experimental conditions.",
        ],
    }
    if relax and output_dir is not None:
        result["relaxed_structure_artifact"] = _write_relaxed_structure(atoms, Path(output_dir).resolve())
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a governed MatterSim-v1.0.0-5M stability screen")
    parser.add_argument("--structure", required=True)
    parser.add_argument("--model-path")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--structure-kind", choices=sorted(STRUCTURE_KINDS), default="bulk")
    parser.add_argument("--no-relax", action="store_true")
    parser.add_argument("--relax-cell", action="store_true")
    parser.add_argument("--fmax", type=float, default=0.05)
    parser.add_argument("--max-steps", type=int, default=200)
    parser.add_argument("--max-displacement", type=float, default=0.75)
    parser.add_argument("--output-dir")
    parser.add_argument("--output-json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = run_mattersim_stability_screen(
            args.structure,
            model_path=args.model_path,
            workspace_root=Path.cwd(),
            device=args.device,
            structure_kind=args.structure_kind,
            relax=not args.no_relax,
            relax_cell=args.relax_cell,
            fmax_ev_per_angstrom=args.fmax,
            max_steps=args.max_steps,
            max_displacement_angstrom=args.max_displacement,
            output_dir=args.output_dir,
        )
    except MatterSimError as exc:
        result = {"schema_version": MATTERSIM_SCHEMA_VERSION, "screen_type": "mattersim_stability_proxy", "status": "error", "error": str(exc)}
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
