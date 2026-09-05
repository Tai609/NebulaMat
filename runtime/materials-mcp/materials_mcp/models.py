"""Provider-neutral material records.

The adapters deliberately return a small stable contract. Provider-specific
payloads stay in the adapter and are never exposed to the agent as the primary
schema.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class MaterialRecord:
    provider: str
    material_id: str
    formula: str | None = None
    elements: list[str] = field(default_factory=list)
    structure_url: str | None = None
    structure_format: str | None = None
    properties: dict[str, Any] = field(default_factory=dict)
    source_url: str | None = None
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


NORMALIZED_PROPERTIES = {
    "band_gap": ("band_gap", "bandgap", "band_gap_ev", "band_gap_eV", "Egap"),
    "formation_energy_per_atom": (
        "formation_energy_per_atom",
        "formation_energy",
        "formationenergy",
        "delta_e",
        "enthalpy_formation_atom",
    ),
    "energy_above_hull": ("energy_above_hull", "e_above_hull", "above_hull", "stability"),
    "density": ("density", "density_g_cm3"),
    "volume": ("volume", "volume_ang3", "volume_a3"),
    "volume_per_atom": ("volume_per_atom", "volume_atom"),
    "total_magnetization": ("total_magnetization", "magnetization", "spin_atom"),
    "crystal_system": ("crystal_system", "spacegroup.crystal_system", "crystal_system_relax"),
    "space_group": ("space_group", "spacegroup.symbol", "spacegroup_relax"),
}

NORMALIZED_PROPERTY_UNITS: dict[str, str] = {
    "band_gap": "eV",
    "formation_energy_per_atom": "eV/atom",
    "energy_above_hull": "eV/atom",
    "density": "g/cm3",
    "volume": "angstrom3",
    "volume_per_atom": "angstrom3/atom",
    "total_magnetization": "mu_B",
}


def _first(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value: Any = mapping
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                value = None
                break
            value = value[part]
        if value not in (None, ""):
            return value
    return None


def _elements_from_formula(formula: str | None) -> list[str]:
    if not formula:
        return []
    # This is only a fallback. Pymatgen is used by the materials environment
    # whenever a formula needs full parenthesis/isotope/charge support.
    found: list[str] = []
    for token in __import__("re").finditer(r"([A-Z][a-z]?)", formula):
        element = token.group(1)
        if element not in found:
            found.append(element)
    return found


def normalize_record(provider: str, raw: dict[str, Any]) -> MaterialRecord:
    """Map one provider payload into the stable MaterialRecord contract."""
    formula_value = _first(
        raw,
        (
            "formula_pretty",
            "formula",
            "name",
            "compound",
            "chemical_formula",
            "chemical_formula_reduced",
            "reduced_formula",
            "composition",
            "results.material.chemical_formula_reduced",
        ),
    )
    formula = str(formula_value) if formula_value not in (None, "") else None
    raw_elements = _first(raw, ("elements", "elements_set", "results.material.elements"))
    if isinstance(raw_elements, str):
        elements = _elements_from_formula(raw_elements)
    elif isinstance(raw_elements, (list, tuple, set)):
        elements = sorted({str(x) for x in raw_elements})
    else:
        elements = _elements_from_formula(formula)

    props: dict[str, Any] = {}
    for normalized, keys in NORMALIZED_PROPERTIES.items():
        value = _first(raw, keys)
        if value not in (None, ""):
            unit = NORMALIZED_PROPERTY_UNITS.get(normalized)
            if isinstance(value, dict) and "value" in value:
                props[normalized] = {"value": value["value"], "unit": value.get("unit") or unit}
            else:
                props[normalized] = {"value": value, "unit": unit} if unit else value

    material_id = _first(
        raw,
        ("material_id", "materialid", "id", "entry_id", "entryId", "uid", "auid"),
    )
    if material_id in (None, ""):
        material_id = "unknown"

    structure_url = _first(
        raw,
        (
            "structure_url",
            "structureUrl",
            "structure.url",
            "download_url",
            "links.structure",
        ),
    )
    structure_format = _first(raw, ("structure_format", "structure.format", "format"))
    source_url = _first(raw, ("source_url", "sourceUrl", "url", "links.self"))
    if not source_url:
        canonical = {
            "materials_project": f"https://materialsproject.org/materials/{material_id}",
            "oqmd": f"https://oqmd.org/materials/entry/{material_id}",
            "aflow": f"https://aflowlib.org/CrystalDatabase/{material_id}",
            "nomad": f"https://nomad-laboratory.eu/entry/id/{material_id}",
        }.get(provider)
        source_url = canonical

    endpoint = {
        "materials_project": "https://api.materialsproject.org",
        "oqmd": "https://oqmd.org/oqmdapi",
        "aflow": "https://aflow.org/API/aflux",
        "nomad": "https://nomad-laboratory.eu/api/v1",
    }.get(provider)
    provenance = {
        "provider": provider,
        "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "endpoint": endpoint,
        "normalization": "provider-adapter",
    }
    return MaterialRecord(
        provider=provider,
        material_id=str(material_id),
        formula=formula,
        elements=elements,
        structure_url=str(structure_url) if structure_url else None,
        structure_format=str(structure_format) if structure_format else None,
        properties=props,
        source_url=str(source_url) if source_url else None,
        provenance=provenance,
    )


def normalize_payload(provider: str, payload: Any) -> list[MaterialRecord]:
    """Normalize common list/envelope shapes returned by database APIs."""
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = None
        for key in ("data", "results", "entries", "response", "docs"):
            value = payload.get(key)
            if isinstance(value, list):
                items = value
                break
        if items is None:
            items = [payload]
    else:
        items = []
    return [normalize_record(provider, item) for item in items if isinstance(item, dict)]
