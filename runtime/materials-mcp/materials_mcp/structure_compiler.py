"""Compile explicit material candidates into validated periodic structures."""
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


COMPILER_VERSION = "1.1.0"
STATUS_VALUES = {"pass", "hold", "reject"}


def _backend_info() -> dict[str, str]:
    """Return the actual structure backend versions used by this process.

    Pymatgen's top-level namespace intentionally does not expose a stable
    ``__version__`` attribute in all supported releases. Read distribution
    metadata instead, and keep the import path used by the compiler explicit.
    """
    from importlib.metadata import PackageNotFoundError, version

    def dist_version(name: str) -> str:
        try:
            return version(name)
        except PackageNotFoundError:
            return "unavailable"

    from pymatgen.core.surface import SlabGenerator  # noqa: F401

    return {
        "pymatgen": dist_version("pymatgen"),
        "pymatgen-core": dist_version("pymatgen-core"),
    }


@dataclass
class StructureCompilationResult:
    status: str
    candidate_id: str
    output_dir: str
    files: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    missing_fields: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    manifest: str | None = None

    def to_dict(self) -> dict[str, Any]:
        if self.status not in STATUS_VALUES:
            raise ValueError(f"invalid compiler status: {self.status}")
        return {
            "status": self.status,
            "candidate_id": self.candidate_id,
            "output_dir": self.output_dir,
            "files": self.files,
            "warnings": self.warnings,
            "assumptions": self.assumptions,
            "missing_fields": self.missing_fields,
            "errors": self.errors,
            "manifest": self.manifest,
            "compiler_version": COMPILER_VERSION,
        }


def _json_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_id(value: Any) -> str:
    candidate_id = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "candidate")).strip("-.")
    return candidate_id[:96] or "candidate"


def _triplet(value: Any, name: str, integer: bool = False) -> tuple[Any, Any, Any]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{name} must contain exactly three values")
    converted = tuple(int(item) if integer else float(item) for item in value)
    if not all(math.isfinite(float(item)) for item in converted):
        raise ValueError(f"{name} must contain finite values")
    return converted


def _lattice_from_spec(spec: dict[str, Any]):
    from pymatgen.core import Lattice  # type: ignore

    lattice = spec.get("lattice")
    if not isinstance(lattice, dict):
        raise ValueError("prototype.lattice is required")
    matrix = lattice.get("matrix")
    if isinstance(matrix, list):
        if len(matrix) != 3 or any(not isinstance(row, list) or len(row) != 3 for row in matrix):
            raise ValueError("prototype.lattice.matrix must be a 3x3 array")
        return Lattice([[float(value) for value in row] for row in matrix])
    lengths = lattice.get("lengths")
    if lengths is not None:
        a, b, c = _triplet(lengths, "prototype.lattice.lengths")
    else:
        a = float(lattice.get("a", 0))
        b = float(lattice.get("b", a))
        c = float(lattice.get("c", a))
    if min(a, b, c) <= 0:
        raise ValueError("prototype lattice lengths must be positive")
    angles = lattice.get("angles", [lattice.get("alpha", 90), lattice.get("beta", 90), lattice.get("gamma", 90)])
    alpha, beta, gamma = _triplet(angles, "prototype.lattice.angles")
    if not all(0 < angle < 180 for angle in (alpha, beta, gamma)):
        raise ValueError("prototype lattice angles must lie between 0 and 180 degrees")
    return Lattice.from_parameters(a, b, c, alpha, beta, gamma)


def _explicit_structure(prototype: dict[str, Any]):
    from pymatgen.core import Structure  # type: ignore

    lattice = _lattice_from_spec(prototype)
    sites = prototype.get("sites")
    if not isinstance(sites, list) or not sites:
        raise ValueError("prototype.sites must contain explicit periodic sites")
    species: list[Any] = []
    coords: list[list[float]] = []
    site_ids: list[str] = []
    oxidation_states: list[float | None] = []
    for index, raw in enumerate(sites):
        if not isinstance(raw, dict):
            raise ValueError(f"prototype.sites[{index}] must be an object")
        element = str(raw.get("element") or raw.get("species") or "").strip()
        if not element:
            raise ValueError(f"prototype.sites[{index}].element is required")
        occupancy = float(raw.get("occupancy", 1.0))
        if not math.isclose(occupancy, 1.0, abs_tol=1e-8):
            raise ValueError("fractional occupancy is not a DFT-ready structure; expand it to an ordered supercell")
        frac = _triplet(raw.get("frac") or raw.get("fractional_coordinates"), f"prototype.sites[{index}].frac")
        species.append(element)
        coords.append(list(frac))
        site_ids.append(str(raw.get("site_id") or f"site-{index}"))
        state = raw.get("oxidation_state")
        oxidation_states.append(float(state) if state is not None else None)
    structure = Structure(lattice, species, coords, coords_are_cartesian=False, to_unit_cell=True, site_properties={"site_id": site_ids})
    if all(state is not None for state in oxidation_states):
        structure.add_oxidation_state_by_site([float(state) for state in oxidation_states])
    return structure


def _spinel_structure(prototype: dict[str, Any]):
    from pymatgen.core import Lattice, Structure  # type: ignore

    lattice_spec = prototype.get("lattice") if isinstance(prototype.get("lattice"), dict) else {}
    a = float(lattice_spec.get("a", prototype.get("a", 0)))
    if a <= 0:
        raise ValueError("spinel prototype requires lattice.a")
    species = prototype.get("species")
    if not isinstance(species, dict):
        raise ValueError("spinel prototype requires species.A and species.B")
    a_species = str(species.get("A") or "").strip()
    b_species = str(species.get("B") or "").strip()
    if not a_species or not b_species:
        raise ValueError("spinel prototype requires species.A and species.B")
    oxygen_u = float(prototype.get("oxygen_u", 0.385))
    convention = str(prototype.get("origin_convention", "pymatgen-origin-2"))
    if convention != "pymatgen-origin-2":
        raise ValueError("unsupported spinel origin convention; use pymatgen-origin-2")
    structure = Structure.from_spacegroup(
        str(prototype.get("space_group") or "Fd-3m"),
        Lattice.cubic(a),
        [a_species, b_species, "O"],
        [[0, 0, 0], [0.625, 0.625, 0.625], [oxygen_u, oxygen_u, oxygen_u]],
    )
    expected_formula = prototype.get("expected_formula")
    if expected_formula:
        from pymatgen.core import Composition  # type: ignore

        generated = structure.composition.fractional_composition
        expected = Composition(str(expected_formula)).fractional_composition
        if generated != expected:
            raise ValueError(
                f"generated spinel composition {structure.composition.reduced_formula} does not match prototype.expected_formula {expected_formula}"
            )
    return structure


def _brucite_structure(prototype: dict[str, Any]):
    from pymatgen.core import Lattice, Structure  # type: ignore

    lattice_spec = prototype.get("lattice") if isinstance(prototype.get("lattice"), dict) else {}
    a = float(lattice_spec.get("a", prototype.get("a", 0)))
    c = float(lattice_spec.get("c", prototype.get("c", 0)))
    metal = str((prototype.get("species") or {}).get("metal") if isinstance(prototype.get("species"), dict) else prototype.get("metal") or "").strip()
    if a <= 0 or c <= 0 or not metal:
        raise ValueError("brucite prototype requires lattice.a, lattice.c, and species.metal")
    z = float(prototype.get("hydrogen_z", 0.216))
    lattice = Lattice.hexagonal(a, c)
    structure = Structure.from_spacegroup(
        str(prototype.get("space_group") or "P-3m1"),
        lattice,
        [metal, "O", "H"],
        [[0, 0, 0], [1 / 3, 2 / 3, z], [1 / 3, 2 / 3, 1 - z]],
    )
    supercell = prototype.get("supercell")
    if supercell is not None:
        structure.make_supercell(_triplet(supercell, "prototype.supercell", integer=True))
    substitutions = prototype.get("substitutions", [])
    if substitutions:
        if not isinstance(substitutions, list):
            raise ValueError("prototype.substitutions must be a list")
        for item in substitutions:
            if not isinstance(item, dict) or "site_index" not in item or "element" not in item:
                raise ValueError("each substitution requires site_index and element")
            structure.replace(int(item["site_index"]), str(item["element"]))
    vacancies = prototype.get("vacancies", [])
    if vacancies:
        if not isinstance(vacancies, list) or not all(isinstance(value, int) for value in vacancies):
            raise ValueError("prototype.vacancies must contain ordered integer site indices")
        structure.remove_sites(sorted(set(vacancies), reverse=True))
    return structure


def _build_structure(prototype: dict[str, Any]):
    kind = str(prototype.get("type") or "").strip().lower()
    if kind == "explicit":
        return _explicit_structure(prototype)
    if kind == "spinel":
        return _spinel_structure(prototype)
    if kind in {"brucite", "hydroxide"}:
        return _brucite_structure(prototype)
    raise ValueError("prototype.type must be explicit, spinel, or brucite")


def _minimum_distance(structure) -> float | None:
    if not len(structure):
        return None
    neighbors = structure.get_neighbor_list(float(max(structure.lattice.abc)), exclude_self=True)
    distances = [float(value) for value in neighbors[3] if float(value) > 1e-8]
    return min(distances) if distances else None


def _bond_graph(structure) -> list[dict[str, Any]]:
    """Build a conservative periodic coordination graph for visualization."""
    from pymatgen.analysis.local_env import CrystalNN  # type: ignore

    oxygen_like = {"O", "S", "Se", "F", "Cl", "N", "H"}
    bonds: dict[tuple[int, int, tuple[int, int, int]], dict[str, Any]] = {}
    finder = CrystalNN(weighted_cn=True, distance_cutoffs=(0.5, 1.0), x_diff_weight=3.0, porous_adjustment=False)
    for i, site in enumerate(structure):
        try:
            neighbors = finder.get_nn_info(structure, i)
        except Exception:
            neighbors = []
        for neighbor in neighbors:
            if float(neighbor.get("weight", 0)) < 0.2:
                continue
            j = int(neighbor["site_index"])
            element_a = str(site.specie.element if hasattr(site.specie, "element") else site.specie)
            other = structure[j]
            element_b = str(other.specie.element if hasattr(other.specie, "element") else other.specie)
            if (element_a in oxygen_like) == (element_b in oxygen_like):
                continue
            shift = tuple(int(round(float(value))) for value in neighbor.get("image", (0, 0, 0)))
            if i < j or (i == j and shift > (0, 0, 0)):
                key = (i, j, shift)
                a, b, image = i, j, shift
            else:
                key = (j, i, tuple(-value for value in shift))
                a, b, image = key
            length = float(structure.get_distance(a, b, jimage=image))
            bonds[key] = {
                "site_index_a": a,
                "site_index_b": b,
                "image_shift": list(image),
                "length_angstrom": length,
                "kind": "coordination",
            }
    if not bonds:
        from pymatgen.core import Element  # type: ignore

        center_indices, neighbor_indices, images, distances = structure.get_neighbor_list(3.3, exclude_self=True)
        for i, j, raw_shift, raw_distance in zip(center_indices, neighbor_indices, images, distances):
            i = int(i)
            j = int(j)
            if i == j:
                continue
            element_a = str(structure[i].specie.element if hasattr(structure[i].specie, "element") else structure[i].specie)
            element_b = str(structure[j].specie.element if hasattr(structure[j].specie, "element") else structure[j].specie)
            if (element_a in oxygen_like) == (element_b in oxygen_like):
                continue
            radius_a = float(Element(element_a).atomic_radius or 1.2)
            radius_b = float(Element(element_b).atomic_radius or 1.2)
            distance = float(raw_distance)
            if distance > (radius_a + radius_b) * 1.25:
                continue
            shift = tuple(int(value) for value in raw_shift)
            if i < j or (i == j and shift > (0, 0, 0)):
                key = (i, j, shift)
                a, b, image = i, j, shift
            else:
                key = (j, i, tuple(-value for value in shift))
                a, b, image = key
            bonds[key] = {
                "site_index_a": a,
                "site_index_b": b,
                "image_shift": list(image),
                "length_angstrom": distance,
                "kind": "coordination",
            }
    return [bonds[key] for key in sorted(bonds)]


def _normalized_structure(structure, label: str, kind: str) -> dict[str, Any]:
    matrix = [[float(value) for value in row] for row in structure.lattice.matrix]
    sites: list[dict[str, Any]] = []
    for index, site in enumerate(structure):
        specie = site.specie
        element = str(specie.element if hasattr(specie, "element") else specie)
        oxidation = float(specie.oxi_state) if hasattr(specie, "oxi_state") else None
        sites.append({
            "site_id": str(site.properties.get("site_id") or f"site-{index}"),
            "element": element,
            "frac": [float(value % 1.0) for value in site.frac_coords],
            "occupancy": 1.0,
            "oxidation_state": oxidation,
            "properties": {key: value for key, value in site.properties.items() if key != "site_id"},
        })
    return {
        "schema_version": 1,
        "label": label,
        "kind": kind,
        "formula": str(structure.composition.reduced_formula),
        "lattice": {
            "matrix": matrix,
            "lengths": [float(value) for value in structure.lattice.abc],
            "angles": [float(value) for value in structure.lattice.angles],
        },
        "sites": sites,
        "bonds": _bond_graph(structure),
        "minimum_distance_angstrom": _minimum_distance(structure),
        "source": "openscience-structure-compiler",
    }


def _write_structure(structure, output_dir: Path, stem: str, kind: str) -> list[dict[str, Any]]:
    from pymatgen.io.cif import CifWriter  # type: ignore
    from pymatgen.io.vasp import Poscar  # type: ignore

    safe_stem = _safe_id(stem)
    cif_path = output_dir / f"{safe_stem}.cif"
    poscar_path = output_dir / f"{safe_stem}.POSCAR"
    json_path = output_dir / f"{safe_stem}.structure.json"
    CifWriter(structure, symprec=None).write_file(cif_path)
    Poscar(structure, sort_structure=False).write_file(poscar_path)
    json_path.write_text(json.dumps(_normalized_structure(structure, safe_stem, kind), indent=2, ensure_ascii=True), encoding="utf-8")
    return [
        {"path": path.name, "format": fmt, "kind": kind, "sha256": _file_hash(path), "size_bytes": path.stat().st_size}
        for path, fmt in ((cif_path, "cif"), (poscar_path, "poscar"), (json_path, "normalized-structure-json"))
    ]


def _slab(structure, spec: dict[str, Any]):
    from pymatgen.core.surface import SlabGenerator  # type: ignore

    miller = _triplet(spec.get("miller_index"), "surface.miller_index", integer=True)
    generator = SlabGenerator(
        initial_structure=structure,
        miller_index=miller,
        min_slab_size=float(spec.get("min_slab_size_angstrom", 10.0)),
        min_vacuum_size=float(spec.get("min_vacuum_size_angstrom", 15.0)),
        center_slab=bool(spec.get("center_slab", True)),
        in_unit_planes=bool(spec.get("in_unit_planes", False)),
        primitive=bool(spec.get("primitive", False)),
        max_normal_search=int(spec.get("max_normal_search", 1)),
    )
    slabs = generator.get_slabs(symmetrize=bool(spec.get("symmetrize", False)), repair=True)
    if not slabs:
        raise ValueError(f"no valid slab termination for Miller index {miller}")
    termination = int(spec.get("termination_index", 0))
    if termination < 0 or termination >= len(slabs):
        raise ValueError(f"surface termination_index must be between 0 and {len(slabs) - 1}")
    return slabs[termination]


def _interface(phase_a, phase_b, spec: dict[str, Any]):
    from pymatgen.core.interface import Interface  # type: ignore

    surface_a = dict(spec.get("surface_a") or {"miller_index": spec.get("miller_a", [0, 0, 1])})
    surface_b = dict(spec.get("surface_b") or {"miller_index": spec.get("miller_b", [0, 0, 1])})
    for surface in (surface_a, surface_b):
        surface.setdefault("min_slab_size_angstrom", spec.get("min_slab_size_angstrom", 8.0))
        surface.setdefault("min_vacuum_size_angstrom", 0.0)
        surface.setdefault("center_slab", False)
    slab_a = _slab(phase_a, surface_a).get_orthogonal_c_slab()
    slab_b = _slab(phase_b, surface_b).get_orthogonal_c_slab()
    mismatch_a = abs(slab_b.lattice.a - slab_a.lattice.a) / slab_a.lattice.a
    mismatch_b = abs(slab_b.lattice.b - slab_a.lattice.b) / slab_a.lattice.b
    max_mismatch = float(spec.get("max_lattice_mismatch", 0.05))
    if max(mismatch_a, mismatch_b) > max_mismatch:
        raise ValueError(
            f"interface in-plane mismatch ({mismatch_a:.4f}, {mismatch_b:.4f}) exceeds {max_mismatch:.4f}; provide matched supercells"
        )
    interface = Interface.from_slabs(
        slab_a,
        slab_b,
        in_plane_offset=tuple(_triplet([*(spec.get("in_plane_offset") or [0, 0]), 0], "interface.in_plane_offset")[:2]),
        gap=float(spec.get("gap_angstrom", 2.0)),
        vacuum_over_film=float(spec.get("vacuum_angstrom", 15.0)),
        center_slab=True,
    )
    return interface, {"mismatch_a": mismatch_a, "mismatch_b": mismatch_b}


def compile_candidate_structure(
    candidate: dict[str, Any],
    structure_spec: dict[str, Any] | None,
    output_dir: str | Path,
    surface_specs: list[dict[str, Any]] | None = None,
    interface_specs: list[dict[str, Any]] | None = None,
    min_distance_angstrom: float = 0.8,
) -> dict[str, Any]:
    """Compile one frozen candidate without inventing missing atom coordinates."""
    if not isinstance(candidate, dict):
        raise ValueError("candidate must be an object")
    candidate_id = _safe_id(candidate.get("candidate_id") or candidate.get("id"))
    target = Path(output_dir).resolve()
    prototype = None
    if isinstance(structure_spec, dict):
        prototype = structure_spec.get("prototype") if isinstance(structure_spec.get("prototype"), dict) else structure_spec
    result = StructureCompilationResult("hold", candidate_id, str(target))
    if not isinstance(prototype, dict) or not prototype.get("type"):
        result.missing_fields.append("structure_spec.prototype.type")
        result.assumptions.append("No atomistic structure was generated because the candidate does not define a prototype or explicit sites.")
        return result.to_dict()

    target.mkdir(parents=True, exist_ok=True)
    try:
        backend = _backend_info()
        result.assumptions.append(
            "Structure backend: pymatgen "
            f"{backend['pymatgen']} (pymatgen-core {backend['pymatgen-core']}); "
            "SlabGenerator import: pymatgen.core.surface"
        )
        bulk = _build_structure(prototype)
        minimum = _minimum_distance(bulk)
        if minimum is None or minimum < float(min_distance_angstrom):
            raise ValueError(
                f"bulk minimum periodic distance {minimum if minimum is not None else 'unknown'} A is below {min_distance_angstrom:.4f} A"
            )
        result.files.extend(_write_structure(bulk, target, "bulk", "bulk"))

        phases: dict[str, Any] = {"bulk": bulk}
        extra_phases = structure_spec.get("phases", {}) if isinstance(structure_spec, dict) else {}
        if isinstance(extra_phases, dict):
            for name, phase_spec in extra_phases.items():
                if not isinstance(phase_spec, dict):
                    raise ValueError(f"structure_spec.phases.{name} must be an object")
                phase = _build_structure(phase_spec.get("prototype") if isinstance(phase_spec.get("prototype"), dict) else phase_spec)
                phase_minimum = _minimum_distance(phase)
                if phase_minimum is None or phase_minimum < float(min_distance_angstrom):
                    raise ValueError(f"phase {name} minimum periodic distance is below {min_distance_angstrom:.4f} A")
                phases[str(name)] = phase
                result.files.extend(_write_structure(phase, target, f"phase-{name}", "phase"))

        requested_surfaces = surface_specs if surface_specs is not None else (
            structure_spec.get("surfaces", []) if isinstance(structure_spec, dict) else []
        )
        for index, surface_spec in enumerate(requested_surfaces or []):
            if not isinstance(surface_spec, dict):
                raise ValueError(f"surface_specs[{index}] must be an object")
            phase_name = str(surface_spec.get("phase") or "bulk")
            if phase_name not in phases:
                raise ValueError(f"unknown surface phase: {phase_name}")
            slab = _slab(phases[phase_name], surface_spec)
            miller = "".join(str(value).replace("-", "m") for value in _triplet(surface_spec.get("miller_index"), "surface.miller_index", integer=True))
            result.files.extend(_write_structure(slab, target, f"surface-{phase_name}-{miller}-{index}", "surface"))

        interface_metadata: list[dict[str, Any]] = []
        requested_interfaces = interface_specs if interface_specs is not None else (
            structure_spec.get("interfaces", []) if isinstance(structure_spec, dict) else []
        )
        for index, interface_spec in enumerate(requested_interfaces or []):
            if not isinstance(interface_spec, dict):
                raise ValueError(f"interface_specs[{index}] must be an object")
            phase_a = str(interface_spec.get("phase_a") or "bulk")
            phase_b = str(interface_spec.get("phase_b") or "")
            if phase_a not in phases or phase_b not in phases:
                raise ValueError(f"interface phases must exist: phase_a={phase_a}, phase_b={phase_b}")
            interface, metadata = _interface(phases[phase_a], phases[phase_b], interface_spec)
            interface_minimum = _minimum_distance(interface)
            if interface_minimum is None or interface_minimum < float(min_distance_angstrom):
                raise ValueError(f"interface minimum periodic distance is below {min_distance_angstrom:.4f} A")
            interface_metadata.append({"index": index, "phase_a": phase_a, "phase_b": phase_b, **metadata})
            result.files.extend(_write_structure(interface, target, f"interface-{phase_a}-{phase_b}-{index}", "interface"))

        result.status = "pass"
        manifest_payload = {
            "schema_version": 1,
            "compiler_version": COMPILER_VERSION,
            "status": result.status,
            "candidate_id": candidate_id,
            "candidate_sha256": _json_hash(candidate),
            "structure_spec_sha256": _json_hash(structure_spec),
            "formula": str(bulk.composition.reduced_formula),
            "site_count": len(bulk),
            "lattice": {
                "matrix": [[float(value) for value in row] for row in bulk.lattice.matrix],
                "lengths": [float(value) for value in bulk.lattice.abc],
                "angles": [float(value) for value in bulk.lattice.angles],
            },
            "minimum_distance_angstrom": minimum,
            "files": result.files,
            "interfaces": interface_metadata,
            "warnings": result.warnings,
            "assumptions": result.assumptions,
            "backend": backend,
        }
        manifest_path = target / "manifest.json"
        manifest_path.write_text(json.dumps(manifest_payload, indent=2, ensure_ascii=True), encoding="utf-8")
        result.manifest = manifest_path.name
        result.files.append({
            "path": manifest_path.name,
            "format": "manifest-json",
            "kind": "manifest",
            "sha256": _file_hash(manifest_path),
            "size_bytes": manifest_path.stat().st_size,
        })
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        result.status = "reject"
        result.errors.append(str(exc))
    except Exception as exc:
        result.status = "reject"
        result.errors.append(f"structure compiler failed: {exc}")
    return result.to_dict()
