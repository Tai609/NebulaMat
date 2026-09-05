"""Deterministic post-MatterGen structure standardization.

MatterGen emits small primitive cells.  Those cells are useful candidates but
are not a controlled basis for relaxation or adsorption comparisons.  This
module expands bulk cells to a target atom-count window and, when explicitly
requested, builds slabs with a fixed Miller index, layer count, vacuum, and
in-plane atom-count window.  Every output is registered in a hash-bearing
manifest so downstream calculators cannot silently consume the raw CIF.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


STANDARDIZER_VERSION = "1.1.0"
STANDARDIZATION_SCHEMA_VERSION = 1
DEFAULT_STANDARDIZATION: dict[str, Any] = {
    "enabled": True,
    "bulk_target_atoms": 40,
    "bulk_atom_tolerance": 0.20,
    "surface_miller_index": None,
    "surface_layers": None,
    "surface_target_atoms": 96,
    "surface_atom_tolerance": 0.20,
    "vacuum_angstrom": 15.0,
    "surface_min_lateral_angstrom": 12.0,
    "surface_max_cell_aspect_ratio": 4.0,
    "surface_max_slab_thickness_angstrom": 20.0,
    "min_distance_angstrom": 0.8,
    "termination_index": 0,
}


class StandardizationError(ValueError):
    """Raised when a structure cannot meet an explicit standardization policy."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _finite(value: Any, name: str, *, positive: bool = False) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise StandardizationError(f"{name} must be numeric") from exc
    if not math.isfinite(result) or (positive and result <= 0):
        raise StandardizationError(f"{name} must be finite and {'positive' if positive else 'valid'}")
    return result


def _int(value: Any, name: str, *, minimum: int = 1) -> int:
    if isinstance(value, bool):
        raise StandardizationError(f"{name} must be an integer")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise StandardizationError(f"{name} must be an integer") from exc
    if result < minimum:
        raise StandardizationError(f"{name} must be >= {minimum}")
    return result


def normalize_policy(policy: dict[str, Any] | None) -> dict[str, Any]:
    """Validate and fill the explicit standardization policy."""
    supplied = policy if isinstance(policy, dict) else {}
    normalized = dict(DEFAULT_STANDARDIZATION)
    normalized.update(supplied)
    if not isinstance(normalized["enabled"], bool):
        raise StandardizationError("standardization.enabled must be boolean")
    normalized["bulk_target_atoms"] = _int(normalized["bulk_target_atoms"], "bulk_target_atoms")
    normalized["bulk_atom_tolerance"] = _finite(normalized["bulk_atom_tolerance"], "bulk_atom_tolerance")
    if not 0 <= normalized["bulk_atom_tolerance"] < 1:
        raise StandardizationError("bulk_atom_tolerance must be between 0 and 1")
    normalized["surface_target_atoms"] = _int(normalized["surface_target_atoms"], "surface_target_atoms")
    normalized["surface_atom_tolerance"] = _finite(normalized["surface_atom_tolerance"], "surface_atom_tolerance")
    if not 0 <= normalized["surface_atom_tolerance"] < 1:
        raise StandardizationError("surface_atom_tolerance must be between 0 and 1")
    normalized["vacuum_angstrom"] = _finite(normalized["vacuum_angstrom"], "vacuum_angstrom", positive=True)
    normalized["surface_min_lateral_angstrom"] = _finite(
        normalized["surface_min_lateral_angstrom"], "surface_min_lateral_angstrom", positive=True
    )
    normalized["surface_max_cell_aspect_ratio"] = _finite(
        normalized["surface_max_cell_aspect_ratio"], "surface_max_cell_aspect_ratio", positive=True
    )
    normalized["surface_max_slab_thickness_angstrom"] = _finite(
        normalized["surface_max_slab_thickness_angstrom"],
        "surface_max_slab_thickness_angstrom",
        positive=True,
    )
    normalized["min_distance_angstrom"] = _finite(normalized["min_distance_angstrom"], "min_distance_angstrom", positive=True)
    normalized["termination_index"] = _int(normalized["termination_index"], "termination_index", minimum=0)
    miller = normalized.get("surface_miller_index")
    layers = normalized.get("surface_layers")
    if miller is None and layers is not None:
        raise StandardizationError("surface_miller_index is required when surface_layers is set")
    if miller is not None:
        if not isinstance(miller, (list, tuple)) or len(miller) != 3:
            raise StandardizationError("surface_miller_index must contain three integers")
        converted = tuple(int(item) for item in miller)
        if converted == (0, 0, 0):
            raise StandardizationError("surface_miller_index cannot be [0, 0, 0]")
        normalized["surface_miller_index"] = list(converted)
        if layers is None:
            raise StandardizationError("surface_layers is required when surface_miller_index is set")
        normalized["surface_layers"] = _int(layers, "surface_layers")
    return normalized


def _backend_versions() -> dict[str, str]:
    def dist(name: str) -> str:
        try:
            return version(name)
        except PackageNotFoundError:
            return "unavailable"

    return {"pymatgen": dist("pymatgen"), "pymatgen-core": dist("pymatgen-core")}


def _minimum_distance(structure) -> float | None:
    if not len(structure):
        return None
    radius = float(max(structure.lattice.abc))
    distances = [float(value) for value in structure.get_neighbor_list(radius, exclude_self=True)[3] if float(value) > 1e-8]
    return min(distances) if distances else None


def _validate_minimum_distance(structure, minimum: float, label: str) -> float:
    observed = _minimum_distance(structure)
    if observed is None or observed < minimum:
        raise StandardizationError(
            f"{label} minimum periodic distance {observed if observed is not None else 'unknown'} A is below {minimum:.4f} A"
        )
    return observed


def _supercell_matrix(factors: tuple[int, int, int]) -> list[list[int]]:
    return [[factors[0], 0, 0], [0, factors[1], 0], [0, 0, factors[2]]]


def _choose_bulk_matrix(structure, target: int, tolerance: float) -> list[list[int]]:
    """Choose an exact-size, near-isotropic integer supercell matrix."""
    base_atoms = int(len(structure))
    lower = target * (1.0 - tolerance)
    upper = target * (1.0 + tolerance)
    multipliers = [
        multiplier
        for multiplier in range(1, max(2, math.ceil(upper / base_atoms) + 1))
        if lower <= base_atoms * multiplier <= upper
    ]
    if not multipliers:
        raise StandardizationError(
            f"bulk source atom count {base_atoms} has no integer supercell inside [{lower:.0f}, {upper:.0f}] atoms"
        )
    multiplier = min(
        multipliers,
        key=lambda value: (abs(base_atoms * value - target), base_atoms * value > target, base_atoms * value),
    )
    try:
        from ase.build import find_optimal_cell_shape  # type: ignore

        raw_matrix = find_optimal_cell_shape(structure.lattice.matrix, multiplier, "sc")
        matrix = [[int(value) for value in row] for row in raw_matrix]
    except Exception as exc:
        raise StandardizationError(f"could not find a near-isotropic bulk supercell of size {multiplier}: {exc}") from exc
    determinant = round(
        matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
        - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
        + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
    )
    if abs(determinant) != multiplier:
        raise StandardizationError("optimal-cell search returned an invalid transformation determinant")
    return matrix


def _choose_planar_matrix(
    slab,
    target: int,
    tolerance: float,
    *,
    minimum_lateral: float,
    maximum_cell_aspect_ratio: float,
) -> list[list[int]]:
    """Choose a sufficiently wide 2D supercell without replicating layers."""
    base_atoms = int(len(slab))
    lower = target * (1.0 - tolerance)
    upper = target * (1.0 + tolerance)
    multipliers = [
        multiplier
        for multiplier in range(1, max(2, math.ceil(upper / base_atoms) + 1))
        if lower <= base_atoms * multiplier <= upper
    ]
    if not multipliers:
        raise StandardizationError(
            f"surface base atom count {base_atoms} has no in-plane integer supercell inside [{lower:.0f}, {upper:.0f}] atoms"
        )
    lattice_a = [float(value) for value in slab.lattice.matrix[0]]
    lattice_b = [float(value) for value in slab.lattice.matrix[1]]
    cell_height = float(slab.lattice.c)
    best: tuple[tuple[float, ...], list[list[int]]] | None = None
    for multiplier in multipliers:
        limit = max(3, math.ceil(math.sqrt(multiplier)) + 2)
        for p in range(-limit, limit + 1):
            for q in range(-limit, limit + 1):
                for r in range(-limit, limit + 1):
                    for s in range(-limit, limit + 1):
                        if abs(p * s - q * r) != multiplier:
                            continue
                        vector_a = [p * lattice_a[i] + q * lattice_b[i] for i in range(3)]
                        vector_b = [r * lattice_a[i] + s * lattice_b[i] for i in range(3)]
                        length_a = math.sqrt(sum(value * value for value in vector_a))
                        length_b = math.sqrt(sum(value * value for value in vector_b))
                        shortest = min(length_a, length_b)
                        if shortest < minimum_lateral or cell_height / shortest > maximum_cell_aspect_ratio:
                            continue
                        cosine = abs(sum(vector_a[i] * vector_b[i] for i in range(3)) / (length_a * length_b))
                        atom_count = base_atoms * multiplier
                        score = (
                            abs(atom_count - target) / target,
                            float(atom_count > target),
                            abs(math.log(length_a / length_b)),
                            cosine,
                            max(length_a, length_b),
                        )
                        matrix = [[p, q, 0], [r, s, 0], [0, 0, 1]]
                        if best is None or (score, matrix) < best:
                            best = (score, matrix)
    if best is None:
        raise StandardizationError(
            "could not find an in-plane supercell inside the atom-count window "
            f"with both lateral vectors >= {minimum_lateral:.4f} A and "
            f"c/min(a,b) <= {maximum_cell_aspect_ratio:.4f}"
        )
    return best[1]


def _choose_factors(base_atoms: int, target: int, tolerance: float, *, planar: bool = False) -> tuple[int, int, int]:
    """Choose the closest integer diagonal supercell deterministically."""
    if base_atoms <= 0:
        raise StandardizationError("source structure contains no atoms")
    lower = target * (1.0 - tolerance)
    upper = target * (1.0 + tolerance)
    best: tuple[tuple[float, ...], tuple[int, int, int]] | None = None
    limit = 12
    for a in range(1, limit + 1):
        for b in range(1, limit + 1):
            for c in ([1] if planar else range(1, limit + 1)):
                count = base_atoms * a * b * c
                in_window = lower <= count <= upper
                # Prefer in-window candidates, then closeness, then less
                # anisotropy and fewer atoms to keep calculations bounded.
                score = (
                    0.0 if in_window else 1.0,
                    max(a, b, c) - min(a, b, c) if not planar else abs(a - b),
                    abs(count - target) / target,
                    float(count),
                    float(a + b + c),
                )
                candidate = (score, (a, b, c))
                if best is None or candidate < best:
                    best = candidate
    assert best is not None
    return best[1]


def _require_atom_window(count: int, target: int, tolerance: float, label: str) -> None:
    lower = target * (1.0 - tolerance)
    upper = target * (1.0 + tolerance)
    if not lower <= count <= upper:
        raise StandardizationError(
            f"{label} standardized atom count {count} is outside the target window "
            f"[{lower:.0f}, {upper:.0f}]; adjust the target or tolerance explicitly"
        )


def _surface_normal(slab) -> list[float]:
    """Return the oriented Cartesian surface normal from cross(a, b)."""
    lattice_a = [float(value) for value in slab.lattice.matrix[0]]
    lattice_b = [float(value) for value in slab.lattice.matrix[1]]
    lattice_c = [float(value) for value in slab.lattice.matrix[2]]
    normal = [
        lattice_a[1] * lattice_b[2] - lattice_a[2] * lattice_b[1],
        lattice_a[2] * lattice_b[0] - lattice_a[0] * lattice_b[2],
        lattice_a[0] * lattice_b[1] - lattice_a[1] * lattice_b[0],
    ]
    norm = math.sqrt(sum(value * value for value in normal))
    if norm <= 1e-12:
        raise StandardizationError("surface lattice vectors a and b are collinear")
    direction = [value / norm for value in normal]
    if sum(direction[index] * lattice_c[index] for index in range(3)) < 0:
        direction = [-value for value in direction]
    return direction


def _plane_projections(slab, tolerance: float = 0.15) -> list[float]:
    direction = _surface_normal(slab)
    projections = sorted(sum(float(a) * b for a, b in zip(site.coords, direction)) for site in slab)
    groups: list[float] = []
    for projection in projections:
        if not groups or projection - groups[-1] > tolerance:
            groups.append(projection)
        else:
            groups[-1] = (groups[-1] + projection) / 2.0
    return groups


def _layer_count(slab) -> int:
    """Count real atomic planes along cross(a, b), not the lattice c vector."""
    return len(_plane_projections(slab))


def _orthogonalize_slab_cell(slab, vacuum_angstrom: float):
    """Make c normal to the surface and interpret vacuum as a total gap."""
    from pymatgen.core import Lattice, Structure  # type: ignore

    normal = _surface_normal(slab)
    projections = [sum(float(a) * b for a, b in zip(site.coords, normal)) for site in slab]
    if not projections:
        raise StandardizationError("surface structure contains no atoms")
    minimum = min(projections)
    thickness = max(projections) - minimum
    cell_height = thickness + vacuum_angstrom
    shift = vacuum_angstrom / 2.0 - minimum
    coordinates = [
        [float(site.coords[index]) + normal[index] * shift for index in range(3)]
        for site in slab
    ]
    lattice = Lattice(
        [
            [float(value) for value in slab.lattice.matrix[0]],
            [float(value) for value in slab.lattice.matrix[1]],
            [normal[index] * cell_height for index in range(3)],
        ]
    )
    rebuilt = Structure(
        lattice,
        slab.species,
        coordinates,
        coords_are_cartesian=True,
        to_unit_cell=True,
        site_properties=slab.site_properties,
    )
    return rebuilt, thickness


def _build_exact_layer_slab(source_structure, miller: tuple[int, int, int], requested_layers: int, termination: int):
    """Search Pymatgen unit-plane sizes until the real plane count is exact."""
    from pymatgen.core.surface import SlabGenerator  # type: ignore

    observed: set[int] = set()
    for slab_size_unit_planes in range(1, max(requested_layers * 2, requested_layers + 4) + 1):
        generator = SlabGenerator(
            initial_structure=source_structure,
            miller_index=miller,
            min_slab_size=float(slab_size_unit_planes),
            min_vacuum_size=1.0,
            in_unit_planes=True,
            primitive=False,
            max_normal_search=1,
            center_slab=False,
        )
        try:
            slabs = generator.get_slabs(symmetrize=False, repair=True)
        except (IndexError, ValueError):
            slabs = generator.get_slabs(symmetrize=False, repair=False)
        if termination >= len(slabs):
            continue
        slab = slabs[termination]
        plane_count = _layer_count(slab)
        observed.add(plane_count)
        if plane_count == requested_layers:
            return slab, slab_size_unit_planes
    detail = ", ".join(str(value) for value in sorted(observed)) or "none"
    raise StandardizationError(
        f"could not build exactly {requested_layers} real atomic planes for Miller index {miller}; "
        f"observed plane counts: {detail}"
    )


def _validate_surface_geometry(slab, slab_thickness: float, policy: dict[str, Any]) -> dict[str, Any]:
    lengths = [float(slab.lattice.a), float(slab.lattice.b)]
    shortest = min(lengths)
    aspect_ratio = float(slab.lattice.c) / shortest
    if slab_thickness > policy["surface_max_slab_thickness_angstrom"]:
        raise StandardizationError(
            f"surface slab thickness {slab_thickness:.4f} A exceeds "
            f"{policy['surface_max_slab_thickness_angstrom']:.4f} A"
        )
    if shortest < policy["surface_min_lateral_angstrom"]:
        raise StandardizationError(
            f"surface shortest lateral vector {shortest:.4f} A is below "
            f"{policy['surface_min_lateral_angstrom']:.4f} A"
        )
    if aspect_ratio > policy["surface_max_cell_aspect_ratio"]:
        raise StandardizationError(
            f"surface c/min(a,b) ratio {aspect_ratio:.4f} exceeds "
            f"{policy['surface_max_cell_aspect_ratio']:.4f}"
        )
    return {
        "in_plane_lengths_angstrom": lengths,
        "cell_height_angstrom": float(slab.lattice.c),
        "cell_aspect_ratio": aspect_ratio,
        "slab_thickness_angstrom": slab_thickness,
        "total_vacuum_angstrom": float(slab.lattice.c) - slab_thickness,
    }


def _write_outputs(structure, output_dir: Path, stem: str, kind: str, source_hash: str, policy: dict[str, Any]) -> dict[str, Any]:
    from pymatgen.io.cif import CifWriter  # type: ignore
    from pymatgen.io.vasp import Poscar  # type: ignore

    output_dir.mkdir(parents=True, exist_ok=True)
    cif = output_dir / f"{stem}.cif"
    poscar = output_dir / f"{stem}.POSCAR"
    structure_json = output_dir / f"{stem}.structure.json"
    CifWriter(structure, symprec=None).write_file(cif)
    Poscar(structure, sort_structure=False).write_file(poscar)
    normalized = {
        "schema_version": STANDARDIZATION_SCHEMA_VERSION,
        "label": stem,
        "kind": kind,
        "formula": str(structure.composition.reduced_formula),
        "natoms": int(len(structure)),
        "lattice": {
            "matrix": [[float(v) for v in row] for row in structure.lattice.matrix],
            "lengths": [float(v) for v in structure.lattice.abc],
            "angles": [float(v) for v in structure.lattice.angles],
        },
        "source_sha256": source_hash,
        "standardizer_version": STANDARDIZER_VERSION,
        "policy": policy,
    }
    structure_json.write_text(json.dumps(normalized, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    files = []
    for path, fmt in ((cif, "cif"), (poscar, "poscar"), (structure_json, "normalized-structure-json")):
        files.append({"path": path.name, "format": fmt, "kind": kind, "sha256": _sha256(path), "size_bytes": path.stat().st_size})
    return {"kind": kind, "stem": stem, "natoms": int(len(structure)), "formula": str(structure.composition.reduced_formula), "layer_count": _layer_count(structure) if kind == "surface" else None, "files": files}


def standardize_structure(source_path: str | Path, output_dir: str | Path, policy: dict[str, Any] | None = None) -> dict[str, Any]:
    """Standardize one MatterGen CIF and write a provenance manifest."""
    source = Path(source_path).resolve()
    target = Path(output_dir).resolve()
    if not source.is_file():
        raise StandardizationError(f"source structure does not exist: {source}")
    normalized_policy = normalize_policy(policy)
    if not normalized_policy["enabled"]:
        raise StandardizationError("standardization.enabled must remain true for screening inputs")
    try:
        from pymatgen.core import Structure  # type: ignore
    except ImportError as exc:
        raise StandardizationError("pymatgen is required for MatterGen structure standardization") from exc
    try:
        source_structure = Structure.from_file(source)
    except Exception as exc:
        raise StandardizationError(f"could not read MatterGen structure {source}: {exc}") from exc
    source_hash = _sha256(source)
    target.mkdir(parents=True, exist_ok=True)
    bulk_matrix = _choose_bulk_matrix(source_structure, normalized_policy["bulk_target_atoms"], normalized_policy["bulk_atom_tolerance"])
    bulk = source_structure.copy()
    bulk.make_supercell(bulk_matrix)
    _require_atom_window(len(bulk), normalized_policy["bulk_target_atoms"], normalized_policy["bulk_atom_tolerance"], "bulk")
    bulk_distance = _validate_minimum_distance(bulk, normalized_policy["min_distance_angstrom"], "bulk")
    bulk_record = _write_outputs(bulk, target, "bulk", "bulk", source_hash, normalized_policy)
    bulk_record.update({"source_natoms": int(len(source_structure)), "replication_matrix": bulk_matrix, "minimum_distance_angstrom": bulk_distance})
    surface_record: dict[str, Any] | None = None
    if normalized_policy.get("surface_miller_index") is not None:
        miller = tuple(normalized_policy["surface_miller_index"])
        termination = normalized_policy["termination_index"]
        requested_layers = int(normalized_policy["surface_layers"])
        slab, slab_size_unit_planes = _build_exact_layer_slab(
            source_structure, miller, requested_layers, termination
        )
        slab, slab_thickness = _orthogonalize_slab_cell(slab, normalized_policy["vacuum_angstrom"])
        planar_matrix = _choose_planar_matrix(
            slab,
            normalized_policy["surface_target_atoms"],
            normalized_policy["surface_atom_tolerance"],
            minimum_lateral=normalized_policy["surface_min_lateral_angstrom"],
            maximum_cell_aspect_ratio=normalized_policy["surface_max_cell_aspect_ratio"],
        )
        slab.make_supercell(planar_matrix)
        _require_atom_window(len(slab), normalized_policy["surface_target_atoms"], normalized_policy["surface_atom_tolerance"], "surface")
        atomic_plane_count = _layer_count(slab)
        if atomic_plane_count != requested_layers:
            raise StandardizationError(
                f"surface plane count changed during in-plane expansion: expected {requested_layers}, observed {atomic_plane_count}"
            )
        geometry = _validate_surface_geometry(slab, slab_thickness, normalized_policy)
        slab_distance = _validate_minimum_distance(slab, normalized_policy["min_distance_angstrom"], "surface")
        surface_record = _write_outputs(slab, target, "surface", "surface", source_hash, normalized_policy)
        surface_record.update(
            {
                "miller_index": list(miller),
                "layers": requested_layers,
                "atomic_plane_count": atomic_plane_count,
                "slab_size_unit_planes": slab_size_unit_planes,
                "replication_matrix": planar_matrix,
                "vacuum_angstrom": float(normalized_policy["vacuum_angstrom"]),
                "minimum_distance_angstrom": slab_distance,
                **geometry,
            }
        )
    artifacts = bulk_record["files"] + (surface_record["files"] if surface_record else [])
    manifest = {
        "schema_version": STANDARDIZATION_SCHEMA_VERSION,
        "standardizer_version": STANDARDIZER_VERSION,
        "status": "pass",
        "source": {"path": source.as_posix(), "sha256": source_hash, "natoms": int(len(source_structure)), "formula": str(source_structure.composition.reduced_formula)},
        "policy": normalized_policy,
        "backend": _backend_versions(),
        "bulk": bulk_record,
        "surface": surface_record,
        "screening_ready": {"bulk": True, "surface": surface_record is not None, "adsorption": False},
        "artifacts": artifacts,
    }
    manifest_path = target / "standardization-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    manifest["manifest"] = {"path": manifest_path.as_posix(), "sha256": _sha256(manifest_path)}
    return manifest


def _find_manifest(path: Path) -> Path | None:
    for parent in [path.parent, *path.parents]:
        candidate = parent / "standardization-manifest.json"
        if candidate.is_file():
            return candidate
        if parent == parent.parent:
            break
    return None


def validate_standardized_artifact(path: str | Path, expected_kind: str | None = None) -> dict[str, Any]:
    """Validate manifest registration and hash for a calculator input."""
    artifact = Path(path).resolve()
    if not artifact.is_file():
        raise StandardizationError(f"standardized structure does not exist: {artifact}")
    manifest_path = _find_manifest(artifact)
    if manifest_path is None:
        raise StandardizationError(f"raw structure is not eligible for screening; missing standardization-manifest.json near {artifact}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise StandardizationError(f"could not read standardization manifest {manifest_path}: {exc}") from exc
    if manifest.get("status") != "pass":
        raise StandardizationError(f"standardization manifest is not screening-ready: {manifest_path}")
    if manifest.get("standardizer_version") != STANDARDIZER_VERSION:
        raise StandardizationError(
            f"standardization manifest uses version {manifest.get('standardizer_version')!r}; "
            f"rebuild the structure set with required version {STANDARDIZER_VERSION}"
        )
    record = next((row for row in manifest.get("artifacts", []) if row.get("path") == artifact.name), None)
    if record is None:
        raise StandardizationError(f"artifact {artifact.name} is not registered in {manifest_path.name}")
    if record.get("sha256") != _sha256(artifact):
        raise StandardizationError(f"artifact hash does not match {manifest_path.name}: {artifact.name}")
    kind = str(record.get("kind") or "")
    if expected_kind and kind != expected_kind:
        raise StandardizationError(f"expected a standardized {expected_kind} artifact, received {kind or 'unknown'}")
    readiness_key = "bulk" if kind == "bulk" else "surface" if kind == "surface" else "adsorption"
    if manifest.get("screening_ready", {}).get(readiness_key) is not True:
        raise StandardizationError(f"{kind or 'unknown'} artifact is not marked {readiness_key}-ready in {manifest_path.name}")
    return {"manifest_path": manifest_path.as_posix(), "manifest": manifest, "artifact": record}


def standardize_adsorption_set(
    slab_path: str | Path,
    adsorbate_path: str | Path,
    adsorbed_path: str | Path,
    output_dir: str | Path,
) -> dict[str, Any]:
    """Validate an explicit adsorption triplet and write one UMA-ready cohort.

    This function never places or invents an adsorbate.  It only accepts three
    user/workflow-provided structures, verifies their stoichiometry and cell
    relationship, and normalizes their calculation files and provenance.
    """
    sources = {
        "slab": Path(slab_path).resolve(),
        "adsorbate": Path(adsorbate_path).resolve(),
        "adsorbed": Path(adsorbed_path).resolve(),
    }
    if len(set(sources.values())) != 3:
        raise StandardizationError("slab, adsorbate, and adsorbed paths must be distinct")
    for label, path in sources.items():
        if not path.is_file():
            raise StandardizationError(f"{label} structure does not exist: {path}")
    slab_provenance = validate_standardized_artifact(sources["slab"], "surface")
    try:
        from ase.io import read, write  # type: ignore

        atoms = {label: read(path) for label, path in sources.items()}
    except Exception as exc:
        raise StandardizationError(f"ASE could not read the adsorption structure set: {exc}") from exc
    if len(atoms["adsorbed"]) != len(atoms["slab"]) + len(atoms["adsorbate"]):
        raise StandardizationError("adsorbed atom count must equal slab atom count plus isolated adsorbate atom count")
    expected_composition = Counter(atoms["slab"].get_chemical_symbols()) + Counter(atoms["adsorbate"].get_chemical_symbols())
    if Counter(atoms["adsorbed"].get_chemical_symbols()) != expected_composition:
        raise StandardizationError("adsorbed composition must equal slab composition plus adsorbate composition")
    slab_cell = atoms["slab"].cell.array
    adsorbed_cell = atoms["adsorbed"].cell.array
    max_cell_delta = max(abs(float(slab_cell[i][j] - adsorbed_cell[i][j])) for i in range(3) for j in range(3))
    if max_cell_delta > 1e-6:
        raise StandardizationError(f"slab and adsorbed cells differ by {max_cell_delta:.6g} A; use the same standardized surface cell")
    if tuple(bool(value) for value in atoms["slab"].pbc) != tuple(bool(value) for value in atoms["adsorbed"].pbc):
        raise StandardizationError("slab and adsorbed periodic-boundary flags must match")

    target = Path(output_dir).resolve()
    target.mkdir(parents=True, exist_ok=True)
    output_paths = {label: target / f"{label}.extxyz" for label in sources}
    try:
        for label, path in output_paths.items():
            write(path, atoms[label])
    except Exception as exc:
        raise StandardizationError(f"could not write normalized adsorption structures: {exc}") from exc
    artifacts = []
    for label, path in output_paths.items():
        kind = "adsorbate" if label == "adsorbate" else "surface"
        artifacts.append(
            {
                "path": path.name,
                "format": "extxyz",
                "kind": kind,
                "role": label,
                "sha256": _sha256(path),
                "size_bytes": path.stat().st_size,
                "natoms": int(len(atoms[label])),
                "formula": str(atoms[label].get_chemical_formula()),
            }
        )
    source_manifest = slab_provenance["manifest"]
    manifest = {
        "schema_version": STANDARDIZATION_SCHEMA_VERSION,
        "standardizer_version": STANDARDIZER_VERSION,
        "status": "pass",
        "kind": "adsorption-set",
        "source": {
            label: {"path": path.as_posix(), "sha256": _sha256(path)}
            for label, path in sources.items()
        },
        "source_slab_manifest": slab_provenance["manifest_path"],
        "policy": source_manifest.get("policy", {}),
        "surface": source_manifest.get("surface"),
        "cohort_checks": {
            "composition_conserved": True,
            "atom_count_conserved": True,
            "slab_adsorbed_cell_match": True,
            "max_cell_component_delta_angstrom": max_cell_delta,
        },
        "screening_ready": {"bulk": False, "surface": True, "adsorption": True},
        "artifacts": artifacts,
    }
    manifest_path = target / "standardization-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    manifest["manifest"] = {"path": manifest_path.as_posix(), "sha256": _sha256(manifest_path)}
    return manifest


__all__ = [
    "DEFAULT_STANDARDIZATION",
    "STANDARDIZER_VERSION",
    "StandardizationError",
    "normalize_policy",
    "standardize_structure",
    "standardize_adsorption_set",
    "validate_standardized_artifact",
]
