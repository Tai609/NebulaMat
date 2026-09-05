"""Run an upstream MatterGen request and normalize its crystal artifacts.

This file intentionally has no MatterGen import at module load time. That
keeps ``--dry-run`` useful on machines without the CUDA/PyTorch environment
and gives the desktop agent a deterministic preflight failure instead of a
cryptic import traceback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


UPSTREAM = {
    "repository": "https://github.com/microsoft/mattergen",
    "revision": "ac9ddd406171138c3f037d06b9b53fedbbb1c536",
    "version": "1.0.3",
    "license": "MIT",
}
SCHEMA_VERSION = 1
MAX_BATCH_SIZE = 64
MAX_NUM_BATCHES = 32
MAX_SAMPLES = 1024
ELEMENT_RE = re.compile(r"^[A-Z][a-z]?$")


class RequestError(ValueError):
    """A user-correctable request or workspace error."""


def _managed_python() -> Path | None:
    raw = os.environ.get("NEBULAMAT_MATTERGEN_PYTHON", "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def _reexec_managed_python() -> None:
    """Run the request in the app-owned interpreter when one is provisioned."""
    managed = _managed_python()
    if managed is None or not managed.is_file():
        return
    try:
        current = Path(sys.executable).resolve()
        target = managed.resolve()
    except OSError:
        current = Path(sys.executable)
        target = managed
    if current == target or os.environ.get("NEBULAMAT_MATTERGEN_REEXEC") == "1":
        return
    os.environ["NEBULAMAT_MATTERGEN_REEXEC"] = "1"
    os.execv(str(target), [str(target), *sys.argv])


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _workspace_path(raw: str, workspace: Path, label: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise RequestError(f"{label} must be a non-empty path")
    candidate = Path(raw)
    resolved = (candidate if candidate.is_absolute() else workspace / candidate).resolve()
    try:
        resolved.relative_to(workspace)
    except ValueError as error:
        raise RequestError(f"{label} must stay inside the workspace") from error
    return resolved


def _parse_json_object(value: Any, label: str) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as error:
            raise RequestError(f"{label} must be valid JSON") from error
    else:
        raise RequestError(f"{label} must be a JSON object")
    if not isinstance(parsed, dict):
        raise RequestError(f"{label} must be a JSON object")
    return parsed


def _validate_properties(properties: dict[str, Any]) -> dict[str, str | int | float]:
    result: dict[str, str | int | float] = {}
    for key, value in properties.items():
        if not isinstance(key, str) or not key.strip() or len(key) > 80:
            raise RequestError("property names must be non-empty strings")
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise RequestError(f"property {key!r} must be a string or number")
        if isinstance(value, float) and not value == value:
            raise RequestError(f"property {key!r} must be finite")
        if isinstance(value, str) and not value.strip():
            raise RequestError(f"property {key!r} must not be empty")
        result[key] = value
    return result


def _validate_compositions(value: Any) -> list[dict[str, int]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RequestError("target_compositions must be a JSON array")
    compositions: list[dict[str, int]] = []
    for index, composition in enumerate(value):
        if not isinstance(composition, dict) or not composition:
            raise RequestError(f"target composition {index} must be a non-empty object")
        normalized: dict[str, int] = {}
        for element, count in composition.items():
            if not isinstance(element, str) or not ELEMENT_RE.fullmatch(element):
                raise RequestError(f"invalid element in target composition {index}: {element!r}")
            if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
                raise RequestError(f"atom counts in target composition {index} must be positive integers")
            normalized[element] = count
        compositions.append(normalized)
    return compositions


def validate_request(request: dict[str, Any], workspace: Path) -> dict[str, Any]:
    if request.get("schema_version") != SCHEMA_VERSION:
        raise RequestError(f"unsupported MatterGen request schema: {request.get('schema_version')!r}")

    output_dir = _workspace_path(request.get("output_dir", ""), workspace, "output_dir")
    pretrained_name = request.get("pretrained_name")
    model_path = request.get("model_path")
    if bool(pretrained_name) == bool(model_path):
        raise RequestError("provide exactly one of pretrained_name or model_path")
    if pretrained_name is not None and (not isinstance(pretrained_name, str) or not pretrained_name.strip()):
        raise RequestError("pretrained_name must be a non-empty string")
    if model_path is not None:
        model_path = str(_workspace_path(model_path, workspace, "model_path"))
        if not Path(model_path).exists():
            raise RequestError(f"model_path does not exist: {model_path}")

    batch_size = request.get("batch_size", 1)
    num_batches = request.get("num_batches", 1)
    if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= MAX_BATCH_SIZE:
        raise RequestError(f"batch_size must be an integer between 1 and {MAX_BATCH_SIZE}")
    if isinstance(num_batches, bool) or not isinstance(num_batches, int) or not 1 <= num_batches <= MAX_NUM_BATCHES:
        raise RequestError(f"num_batches must be an integer between 1 and {MAX_NUM_BATCHES}")
    if batch_size * num_batches > MAX_SAMPLES:
        raise RequestError(f"requested samples exceed the safety limit of {MAX_SAMPLES}")

    guidance = request.get("diffusion_guidance_factor")
    if guidance is not None and (isinstance(guidance, bool) or not isinstance(guidance, (int, float)) or not 0 <= guidance <= 20):
        raise RequestError("diffusion_guidance_factor must be between 0 and 20")
    trajectories = request.get("record_trajectories", False)
    if not isinstance(trajectories, bool):
        raise RequestError("record_trajectories must be boolean")

    properties = _validate_properties(_parse_json_object(request.get("properties_to_condition_on"), "properties_to_condition_on"))
    compositions = _validate_compositions(request.get("target_compositions"))
    standardization = request.get("standardization")
    if standardization is not None and not isinstance(standardization, dict):
        raise RequestError("standardization must be a JSON object")
    try:
        normalized_standardization = _standardization_module().normalize_policy(standardization)
    except Exception as error:
        raise RequestError(f"invalid standardization policy: {error}") from error

    return {
        "schema_version": SCHEMA_VERSION,
        "output_dir": str(output_dir),
        "pretrained_name": pretrained_name,
        "model_path": model_path,
        "batch_size": batch_size,
        "num_batches": num_batches,
        "properties_to_condition_on": properties,
        "target_compositions": compositions,
        "diffusion_guidance_factor": guidance,
        "record_trajectories": trajectories,
        "standardization": normalized_standardization,
    }


def _standardization_module():
    """Load the shared standardizer without importing pymatgen at startup."""
    import importlib

    materials_root = Path(__file__).resolve().parents[1] / "materials-mcp"
    if str(materials_root) not in sys.path:
        sys.path.insert(0, str(materials_root))
    return importlib.import_module("materials_mcp.structure_standardizer")


def _manifest_artifacts(output_dir: Path, workspace: Path) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for path in sorted(output_dir.rglob("*")):
        if not path.is_file() or path.name == "mattergen-run.json":
            continue
        artifacts.append(
            {
                "path": path.relative_to(workspace).as_posix(),
                "size_bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    return artifacts


def _installed_model_path(pretrained_name: str | None) -> Path | None:
    """Resolve a checkpoint explicitly installed into the workspace."""
    if not pretrained_name:
        return None
    root = os.environ.get("NEBULAMAT_MATTERGEN_MODELS", "").strip()
    if not root:
        return None
    model_dir = Path(root) / pretrained_name
    checkpoint = model_dir / "checkpoints" / "last.ckpt"
    config = model_dir / "config.yaml"
    return model_dir if checkpoint.is_file() and config.is_file() else None


def _extract_cifs(zip_path: Path, output_dir: Path) -> int:
    """Expose one safe, deterministic CIF per generated structure."""
    count = 0
    with zipfile.ZipFile(zip_path) as archive:
        for info in sorted(archive.infolist(), key=lambda item: item.filename):
            if info.is_dir() or not info.filename.lower().endswith(".cif"):
                continue
            destination = output_dir / f"structure-{count + 1:04d}.cif"
            destination.write_bytes(archive.read(info))
            count += 1
    return count


def _build_manifest(request_path: Path, request: dict[str, Any], workspace: Path, status: str, **extra: Any) -> dict[str, Any]:
    output_dir = Path(request["output_dir"])
    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "run_id": str(uuid.uuid4()),
        "status": status,
        "started_at": extra.pop("started_at", _utc_now()),
        "finished_at": _utc_now(),
        "request": request_path.relative_to(workspace).as_posix(),
        "request_sha256": _sha256(request_path),
        "upstream": UPSTREAM,
        "model": request.get("pretrained_name") or request.get("model_path"),
        "requested_samples": request["batch_size"] * request["num_batches"],
        "artifacts": _manifest_artifacts(output_dir, workspace) if output_dir.is_dir() else [],
    }
    manifest.update(extra)
    return manifest


def run(request_path: Path, dry_run: bool = False, allow_existing: bool = False) -> dict[str, Any]:
    workspace = Path.cwd().resolve()
    request_path = request_path.resolve()
    try:
        request_path.relative_to(workspace)
    except ValueError as error:
        raise RequestError("request must be inside the workspace") from error
    if not request_path.is_file():
        raise RequestError(f"request file does not exist: {request_path}")
    try:
        request_data = json.loads(request_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RequestError(f"request is not valid JSON: {error}") from error
    if not isinstance(request_data, dict):
        raise RequestError("request root must be a JSON object")
    request = validate_request(request_data, workspace)
    output_dir = Path(request["output_dir"])
    if output_dir.exists() and not allow_existing:
        existing = [item for item in output_dir.iterdir() if item.resolve() != request_path]
        if existing:
            raise RequestError(f"output_dir is not empty; pass --allow-existing to reuse it: {output_dir}")
    plan = {
        "status": "dry_run" if dry_run else "planned",
        "request": request_path.relative_to(workspace).as_posix(),
        "upstream": UPSTREAM,
        "model": request["pretrained_name"] or request["model_path"],
        "requested_samples": request["batch_size"] * request["num_batches"],
        "output_dir": output_dir.relative_to(workspace).as_posix(),
        "properties_to_condition_on": request["properties_to_condition_on"],
        "target_compositions": request["target_compositions"],
        "standardization": request["standardization"],
    }
    installed_model = _installed_model_path(request["pretrained_name"])
    plan["model_source"] = "workspace" if installed_model else "not_installed"
    if dry_run:
        return plan

    output_dir.mkdir(parents=True, exist_ok=True)
    started_at = _utc_now()
    try:
        if request["pretrained_name"] and installed_model is None:
            raise RequestError(
                f"MatterGen 模型 {request['pretrained_name']!r} 尚未安装；请先在科学计算环境中点击对应的安装按钮，"
                "下载完成并通过 SHA-256 校验后再运行。"
            )
        try:
            from mattergen.scripts.generate import main as generate
        except ImportError as error:
            setup_hint = (
                "run the installer at NEBULAMAT_MATTERGEN_SETUP to provision the bundled "
                "app-managed environment"
                if os.environ.get("NEBULAMAT_MATTERGEN_SOURCE")
                else "install the pinned upstream checkout"
            )
            raise RequestError(
                "MatterGen is not installed in the active Python environment; "
                f"{setup_hint}, or run this request on a registered Linux/CUDA machine"
            ) from error

        kwargs: dict[str, Any] = {
            "output_path": str(output_dir),
            "batch_size": request["batch_size"],
            "num_batches": request["num_batches"],
            "properties_to_condition_on": request["properties_to_condition_on"],
            "target_compositions": request["target_compositions"],
            "record_trajectories": request["record_trajectories"],
        }
        if request["pretrained_name"]:
            kwargs["model_path"] = str(installed_model)
        else:
            kwargs["model_path"] = request["model_path"]
        if request["diffusion_guidance_factor"] is not None:
            kwargs["diffusion_guidance_factor"] = request["diffusion_guidance_factor"]
        structures = generate(**kwargs)

        zip_path = output_dir / "generated_crystals_cif.zip"
        cif_count = _extract_cifs(zip_path, output_dir) if zip_path.is_file() else 0
        if cif_count == 0 and structures:
            try:
                from pymatgen.io.cif import CifWriter

                for index, structure in enumerate(structures, start=1):
                    CifWriter(structure).write_file(output_dir / f"structure-{index:04d}.cif")
                cif_count = len(structures)
            except ImportError as error:
                raise RequestError("MatterGen returned structures but pymatgen CIF export is unavailable") from error

        if cif_count == 0:
            raise RequestError("MatterGen returned no CIF structures to standardize")

        standardization_module = _standardization_module()
        standardization_records: list[dict[str, Any]] = []
        standardized_root = output_dir / "standardized"
        for source in sorted(output_dir.glob("structure-*.cif")):
            destination = standardized_root / source.stem
            try:
                record = standardization_module.standardize_structure(
                    source,
                    destination,
                    request["standardization"],
                )
            except Exception as error:
                raise RequestError(f"standardization failed for {source.name}: {error}") from error
            record["source_artifact"] = {
                "path": source.relative_to(workspace).as_posix(),
                "sha256": _sha256(source),
            }
            standardization_records.append(record)
        aggregate_standardization_manifest = standardized_root / "standardization-manifest.json"
        aggregate_standardization_manifest.write_text(
            json.dumps(
                {
                    "schema_version": standardization_module.STANDARDIZATION_SCHEMA_VERSION,
                    "standardizer_version": standardization_module.STANDARDIZER_VERSION,
                    "status": "pass",
                    "records": [
                        {
                            "source_artifact": row.get("source_artifact"),
                            "manifest": row.get("manifest"),
                            "screening_ready": row.get("screening_ready"),
                            "bulk": row.get("bulk"),
                            "surface": row.get("surface"),
                        }
                        for row in standardization_records
                    ],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        manifest = _build_manifest(
            request_path,
            request,
            workspace,
            "completed",
            started_at=started_at,
            generated_structures=cif_count,
            model_source="workspace" if installed_model else "not_installed",
            standardization={
                "status": "pass" if standardization_records else "hold",
                "standardizer_version": standardization_module.STANDARDIZER_VERSION,
                "records": standardization_records,
                "screening_ready": {
                    "bulk": bool(standardization_records) and all(
                        row.get("screening_ready", {}).get("bulk") is True for row in standardization_records
                    ),
                    "surface": bool(standardization_records) and all(
                        row.get("screening_ready", {}).get("surface") is True for row in standardization_records
                    ),
                    "adsorption": False,
                },
                "raw_structures_are_not_screening_inputs": True,
            },
        )
        (output_dir / "mattergen-run.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return manifest
    except Exception as error:
        manifest = _build_manifest(request_path, request, workspace, "failed", started_at=started_at, error=str(error))
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "mattergen-run.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if isinstance(error, RequestError):
            raise
        raise RequestError(str(error)) from error


def main() -> int:
    _reexec_managed_python()
    parser = argparse.ArgumentParser(description="Run a validated MatterGen request in the current workspace")
    parser.add_argument("--request", required=True, type=Path, help="workspace-relative request JSON")
    parser.add_argument("--dry-run", action="store_true", help="validate and print the plan without importing MatterGen")
    parser.add_argument("--allow-existing", action="store_true", help="allow a non-empty output directory")
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.request, dry_run=args.dry_run, allow_existing=args.allow_existing), indent=2))
        return 0
    except RequestError as error:
        print(f"MatterGen request failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
