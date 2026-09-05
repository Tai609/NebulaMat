"""Deterministic pre-DFT physics and chemistry screening.

This module deliberately separates database observations, transparent physical
proxies, and missing evidence. It can reject hard inconsistencies, but it does
not claim that a proxy proves synthesizability or electrocatalytic activity.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
from typing import Any

from .validation import parse_formula


SCREEN_SCHEMA_VERSION = 1
E_OER_THERMODYNAMIC = 1.23
OER_TOTAL_FREE_ENERGY = 4.92
# HER is thermoneutral when the hydrogen adsorption free energy is near zero.
# These thresholds are transparent routing heuristics, not activity guarantees.
HER_HIGH_OVERPOTENTIAL_EV = 0.50
HER_HIGH_WATER_DISSOCIATION_BARRIER_EV = 0.80

# A small, explicit reference table for common alkaline-OER cations. Values are
# Shannon-like six-coordinate radii in Angstrom and are only a fallback. A
# candidate-supplied radius with a source always takes precedence.
REFERENCE_IONIC_RADII: dict[str, float] = {
    "Ni2+": 0.69,
    "Ni3+": 0.56,
    "Fe2+": 0.78,
    "Fe3+": 0.645,
    "Co2+": 0.745,
    "Co3+": 0.61,
    "Mn2+": 0.83,
    "Mn3+": 0.645,
    "Mn4+": 0.53,
    "Cr3+": 0.615,
    "Mo6+": 0.59,
    "W6+": 0.60,
    "O2-": 1.40,
    "H+": 0.00,
}


class PhysicsScreenError(ValueError):
    """The pre-DFT screen input is not a typed material descriptor."""


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise PhysicsScreenError(f"{field} must be numeric")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PhysicsScreenError(f"{field} must be numeric") from exc
    if not math.isfinite(result):
        raise PhysicsScreenError(f"{field} must be finite")
    return result


def _bounded(value: Any, field: str, low: float, high: float) -> float:
    result = _number(value, field)
    if not low <= result <= high:
        raise PhysicsScreenError(f"{field} must be between {low:g} and {high:g}")
    return result


def _list(value: Any, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise PhysicsScreenError(f"{field} must be a list")
    return value


def _source_value(value: Any, default_class: str = "assumption") -> tuple[float | None, dict[str, Any]]:
    if isinstance(value, dict):
        raw = value.get("value")
        if raw is None:
            return None, {
                "evidence_class": str(value.get("evidence_class") or default_class),
                "source": str(value.get("source") or ""),
                "uncertainty": value.get("uncertainty"),
            }
        try:
            number = _number(raw, "value")
        except PhysicsScreenError:
            return None, {
                "evidence_class": str(value.get("evidence_class") or default_class),
                "source": str(value.get("source") or ""),
                "uncertainty": value.get("uncertainty"),
            }
        return number, {
            "evidence_class": str(value.get("evidence_class") or default_class),
            "source": str(value.get("source") or ""),
            "uncertainty": value.get("uncertainty"),
            "unit": str(value.get("unit") or ""),
        }
    if value is None:
        return None, {"evidence_class": "missing", "source": "", "uncertainty": None}
    try:
        return _number(value, "value"), {
            "evidence_class": default_class,
            "source": "",
            "uncertainty": None,
        }
    except PhysicsScreenError:
        return None, {"evidence_class": default_class, "source": "", "uncertainty": None}


def _uncertainty_bounds(value: Any) -> tuple[float, float] | None:
    number, meta = _source_value(value)
    if number is None:
        return None
    uncertainty = meta.get("uncertainty")
    if uncertainty is None:
        return number, number
    try:
        delta = abs(_number(uncertainty, "uncertainty"))
    except PhysicsScreenError:
        return number, number
    return number - delta, number + delta


def _finding(
    level: str,
    category: str,
    check: str,
    message: str,
    *,
    evidence_class: str = "assumption",
    confidence: float = 0.5,
    blocks: bool = False,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "level": level,
        "category": category,
        "check": check,
        "message": message,
        "evidence_class": evidence_class,
        "confidence": round(max(0.0, min(1.0, confidence)), 6),
        "blocks": bool(blocks),
        "details": details or {},
    }


def _state_bounds(value: Any, field: str) -> tuple[float, float]:
    if isinstance(value, dict):
        if "min" in value or "max" in value:
            low = _number(value.get("min", value.get("max")), f"{field}.min")
            high = _number(value.get("max", value.get("min")), f"{field}.max")
        else:
            value = value.get("value")
            low = high = _number(value, field)
    elif isinstance(value, (list, tuple)) and value:
        states = [_number(item, field) for item in value]
        low, high = min(states), max(states)
    else:
        low = high = _number(value, field)
    if low > high:
        raise PhysicsScreenError(f"{field} has min greater than max")
    return low, high


def _charge_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any]) -> None:
    formula = candidate.get("formula")
    oxidation = candidate.get("oxidation_states")
    if not isinstance(formula, str) or not formula.strip():
        findings.append(_finding("error", "hard_constraint", "formula", "formula is required", evidence_class="missing", confidence=1.0, blocks=True))
        return
    try:
        amounts = parse_formula(formula)
    except ValueError as exc:
        findings.append(_finding("error", "hard_constraint", "formula", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
        return
    normalized["formula"] = {"text": formula, "amounts": amounts}
    if not isinstance(oxidation, dict) or not oxidation:
        findings.append(_finding("warn", "hard_constraint", "oxidation_states", "oxidation-state assignments are missing; charge neutrality is unresolved", evidence_class="missing", confidence=1.0, blocks=True))
        return
    low_charge = 0.0
    high_charge = 0.0
    unknown: list[str] = []
    bounds: dict[str, list[float]] = {}
    for element, amount in amounts.items():
        if element not in oxidation:
            unknown.append(element)
            continue
        try:
            low, high = _state_bounds(oxidation[element], f"oxidation_states.{element}")
        except PhysicsScreenError as exc:
            findings.append(_finding("error", "hard_constraint", "oxidation_states", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
            continue
        bounds[element] = [low, high]
        low_charge += amount * low
        high_charge += amount * high
    normalized["charge_bounds"] = {"min": low_charge, "max": high_charge, "states": bounds}
    if unknown:
        findings.append(_finding("warn", "hard_constraint", "charge_neutrality", f"missing oxidation states for: {', '.join(sorted(unknown))}", evidence_class="missing", confidence=1.0, blocks=True))
    elif low_charge > 1e-6 or high_charge < -1e-6:
        findings.append(_finding("error", "hard_constraint", "charge_neutrality", f"oxidation-state interval [{low_charge:g}, {high_charge:g}] cannot contain neutral charge", evidence_class="computed", confidence=1.0, blocks=True))
    elif not math.isclose(low_charge, high_charge, abs_tol=1e-6):
        findings.append(_finding("warn", "local_chemistry", "mixed_valence", f"neutrality depends on a mixed-valence assignment in [{low_charge:g}, {high_charge:g}]", evidence_class="computed", confidence=0.85))
    else:
        findings.append(_finding("info", "hard_constraint", "charge_neutrality", "formal charge is neutral for the declared oxidation states", evidence_class="computed", confidence=0.98))


def _occupancy_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any], limits: dict[str, float]) -> None:
    occupancies = candidate.get("site_occupancies")
    if occupancies is None and isinstance(candidate.get("base_state"), dict):
        occupancies = candidate["base_state"].get("site_occupancies")
    if not isinstance(occupancies, dict) or not occupancies:
        findings.append(_finding("warn", "hard_constraint", "site_occupancy", "site occupancies are missing; constructibility cannot be established", evidence_class="missing", confidence=1.0, blocks=True))
        return
    normalized_sites: dict[str, dict[str, float]] = {}
    for site, species in occupancies.items():
        if not isinstance(species, dict) or not species:
            findings.append(_finding("error", "hard_constraint", "site_occupancy", f"site {site} must contain species occupancies", evidence_class="computed", confidence=1.0, blocks=True))
            continue
        total = 0.0
        normalized_sites[str(site)] = {}
        for element, raw_fraction in species.items():
            try:
                fraction = _bounded(raw_fraction, f"site_occupancies.{site}.{element}", 0.0, 1.0)
            except PhysicsScreenError as exc:
                findings.append(_finding("error", "hard_constraint", "site_occupancy", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
                continue
            total += fraction
            normalized_sites[str(site)][str(element)] = fraction
        if total > 1.0 + 1e-8:
            findings.append(_finding("error", "hard_constraint", "site_occupancy", f"site {site} occupancy sum {total:g} exceeds 1", evidence_class="computed", confidence=1.0, blocks=True))
        elif total < 1.0 - 1e-8:
            vacancy = 1.0 - total
            if vacancy > limits["max_vacancy_fraction"]:
                findings.append(_finding("error", "hard_constraint", "vacancy_fraction", f"site {site} vacancy {vacancy:.3f} exceeds configured limit", evidence_class="computed", confidence=1.0, blocks=True))
            else:
                findings.append(_finding("warn", "defect", "vacancy_fraction", f"site {site} has declared vacancy fraction {vacancy:.3f}", evidence_class="computed", confidence=0.95))
    normalized["site_occupancies"] = normalized_sites


def _operator_bounds(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any], limits: dict[str, float]) -> None:
    operators = candidate.get("operators")
    if not isinstance(operators, list):
        return
    normalized_ops: list[dict[str, Any]] = []
    for index, invocation in enumerate(operators):
        if not isinstance(invocation, dict):
            findings.append(_finding("error", "hard_constraint", "operator_parameters", f"operator {index} is not an object", evidence_class="computed", confidence=1.0, blocks=True))
            continue
        operator_id = str(invocation.get("operator_id") or "")
        parameters = invocation.get("parameters") if isinstance(invocation.get("parameters"), dict) else {}
        normalized_ops.append({"operator_id": operator_id, "parameters": dict(parameters)})
        fraction = parameters.get("fraction")
        if fraction is not None:
            try:
                fraction_value = _bounded(fraction, f"operators[{index}].fraction", 0.0, 1.0)
                if operator_id in {"element_substitution", "aliovalent_doping"} and fraction_value > limits["max_dopant_fraction"]:
                    findings.append(_finding("error", "hard_constraint", "dopant_fraction", f"{operator_id} fraction {fraction_value:g} exceeds configured limit", evidence_class="computed", confidence=1.0, blocks=True))
                if operator_id == "vacancy_engineering" and fraction_value > limits["max_vacancy_fraction"]:
                    findings.append(_finding("error", "hard_constraint", "vacancy_fraction", f"vacancy fraction {fraction_value:g} exceeds configured limit", evidence_class="computed", confidence=1.0, blocks=True))
            except PhysicsScreenError as exc:
                findings.append(_finding("error", "hard_constraint", "operator_parameters", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
        if operator_id == "strain_engineering":
            try:
                strain = abs(_number(parameters.get("strain_percent"), "strain_percent"))
                if strain > limits["max_strain_percent"]:
                    findings.append(_finding("error", "hard_constraint", "strain_bound", f"strain {strain:g}% exceeds configured limit", evidence_class="computed", confidence=1.0, blocks=True))
            except PhysicsScreenError as exc:
                findings.append(_finding("error", "hard_constraint", "strain_bound", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
        if operator_id == "surface_coating":
            try:
                thickness = _number(parameters.get("thickness_nm"), "thickness_nm")
                if thickness > limits["max_coating_thickness_nm"]:
                    findings.append(_finding("error", "hard_constraint", "coating_thickness", f"coating thickness {thickness:g} nm exceeds configured limit", evidence_class="computed", confidence=1.0, blocks=True))
            except PhysicsScreenError as exc:
                findings.append(_finding("error", "hard_constraint", "coating_thickness", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
    normalized["operators"] = normalized_ops


def _cartesian(site: dict[str, Any], lattice: list[list[float]] | None) -> tuple[float, float, float] | None:
    if isinstance(site.get("cartesian"), list) and len(site["cartesian"]) == 3:
        return tuple(_number(value, "cartesian") for value in site["cartesian"])  # type: ignore[return-value]
    if isinstance(site.get("frac_coords"), list) and len(site["frac_coords"]) == 3 and lattice:
        frac = [_number(value, "frac_coords") for value in site["frac_coords"]]
        return tuple(sum(frac[row] * lattice[row][col] for row in range(3)) for col in range(3))
    return None


def _distance_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any], limits: dict[str, float]) -> None:
    structure = candidate.get("structure")
    if not isinstance(structure, dict):
        findings.append(_finding("warn", "constructibility", "structure", "structure coordinates are missing; periodic minimum distance is unresolved", evidence_class="missing", confidence=1.0, blocks=True))
        return
    raw_minimum = structure.get("minimum_distance_angstrom")
    minimum: float | None = None
    if raw_minimum is not None:
        try:
            minimum = _number(raw_minimum, "structure.minimum_distance_angstrom")
        except PhysicsScreenError as exc:
            findings.append(_finding("error", "hard_constraint", "minimum_distance", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
    sites = structure.get("sites")
    lattice_raw = structure.get("lattice")
    lattice: list[list[float]] | None = None
    if isinstance(lattice_raw, list) and len(lattice_raw) == 3 and all(isinstance(row, list) and len(row) == 3 for row in lattice_raw):
        lattice = [[_number(value, "structure.lattice") for value in row] for row in lattice_raw]
    if isinstance(sites, list) and sites:
        coords = [_cartesian(site, lattice) for site in sites if isinstance(site, dict)]
        coords = [coord for coord in coords if coord is not None]
        if len(coords) >= 2:
            distances: list[float] = []
            translations = [(0, 0, 0)]
            if lattice:
                translations = list(itertools.product((-1, 0, 1), repeat=3))
            for index, point in enumerate(coords):
                for other_index in range(index, len(coords)):
                    for translation in translations:
                        if index == other_index and translation == (0, 0, 0):
                            continue
                        shift = tuple(sum(translation[row] * lattice[row][col] for row in range(3)) for col in range(3)) if lattice else (0.0, 0.0, 0.0)
                        other = coords[other_index]
                        distance = math.sqrt(sum((point[col] - other[col] - shift[col]) ** 2 for col in range(3)))
                        if distance > 1e-8:
                            distances.append(distance)
            if distances:
                minimum = min(distances) if minimum is None else min(minimum, min(distances))
    if minimum is None:
        findings.append(_finding("warn", "constructibility", "minimum_distance", "minimum interatomic distance could not be computed", evidence_class="missing", confidence=1.0, blocks=True))
        return
    normalized["minimum_distance_angstrom"] = minimum
    if minimum < limits["min_distance_angstrom"]:
        findings.append(_finding("error", "hard_constraint", "minimum_distance", f"minimum distance {minimum:.4f} A is below {limits['min_distance_angstrom']:.4f} A", evidence_class="computed", confidence=1.0, blocks=True))
    else:
        findings.append(_finding("info", "constructibility", "minimum_distance", f"minimum distance {minimum:.4f} A passes the configured bound", evidence_class="computed", confidence=0.98))


def _radius_for(element: str, oxidation: Any, radii: dict[str, Any]) -> tuple[float | None, dict[str, Any]]:
    try:
        low, high = _state_bounds(oxidation, "oxidation_state")
        state = (low + high) / 2.0
    except PhysicsScreenError:
        state = None
    keys: list[str] = []
    if state is not None and math.isclose(state, round(state), abs_tol=1e-6):
        keys.extend((f"{element}{int(round(state)):+d}", f"{element}{int(round(state))}{'+' if state >= 0 else '-'}"))
    keys.append(element)
    for key in keys:
        if key in radii:
            number, meta = _source_value(radii[key], "database_record")
            if number is not None:
                return number, meta
    for key in keys:
        if key in REFERENCE_IONIC_RADII:
            return REFERENCE_IONIC_RADII[key], {"evidence_class": "embedded_reference", "source": "REFERENCE_IONIC_RADII", "uncertainty": 0.05}
    return None, {"evidence_class": "missing", "source": "", "uncertainty": None}


def _local_chemistry_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any]) -> None:
    physics = candidate.get("physics") if isinstance(candidate.get("physics"), dict) else {}
    radii = physics.get("ionic_radii") if isinstance(physics.get("ionic_radii"), dict) else {}
    coordination_sites = physics.get("coordination_sites")
    if not isinstance(coordination_sites, list) or not coordination_sites:
        findings.append(_finding("warn", "local_chemistry", "coordination", "coordination environments are missing; ionic-radius and bond-valence checks are unresolved", evidence_class="missing", confidence=1.0, blocks=True))
        return
    results: list[dict[str, Any]] = []
    for entry in coordination_sites:
        if not isinstance(entry, dict):
            findings.append(_finding("error", "local_chemistry", "coordination", "coordination site must be an object", evidence_class="computed", confidence=1.0, blocks=True))
            continue
        element = str(entry.get("element") or "")
        if not element:
            findings.append(_finding("error", "local_chemistry", "coordination", "coordination site requires an element", evidence_class="computed", confidence=1.0, blocks=True))
            continue
        radius, radius_meta = _radius_for(element, entry.get("oxidation_state"), radii)
        result: dict[str, Any] = {"site": str(entry.get("site") or ""), "element": element, "coordination": entry.get("coordination"), "ionic_radius_angstrom": radius, "radius_provenance": radius_meta}
        if radius is None:
            findings.append(_finding("warn", "local_chemistry", "ionic_radius", f"no ionic radius is available for {element}", evidence_class="missing", confidence=1.0, blocks=True))
        bonds = entry.get("bonds")
        target_state = entry.get("oxidation_state")
        if isinstance(bonds, list) and bonds and target_state is not None:
            try:
                target_low, target_high = _state_bounds(target_state, "oxidation_state")
                target = (target_low + target_high) / 2.0
                bond_sum = 0.0
                for bond in bonds:
                    if not isinstance(bond, dict):
                        raise PhysicsScreenError("bond must be an object")
                    length = _number(bond.get("length_angstrom"), "bond.length_angstrom")
                    r0 = _number(bond.get("r0_angstrom"), "bond.r0_angstrom")
                    b = _number(bond.get("b"), "bond.b")
                    if b <= 0:
                        raise PhysicsScreenError("bond.b must be positive")
                    bond_sum += math.exp((r0 - length) / b)
                residual = bond_sum - target
                result["bond_valence_sum"] = bond_sum
                result["bond_valence_residual"] = residual
                if abs(residual) > 1.0:
                    findings.append(_finding("error", "local_chemistry", "bond_valence", f"bond-valence residual {residual:.3f} is chemically inconsistent", evidence_class="computed", confidence=0.9, blocks=True, details={"site": entry.get("site")}))
                elif abs(residual) > 0.5:
                    findings.append(_finding("warn", "local_chemistry", "bond_valence", f"bond-valence residual {residual:.3f} is outside a comfortable range", evidence_class="computed", confidence=0.85, details={"site": entry.get("site")}))
            except PhysicsScreenError as exc:
                findings.append(_finding("error", "local_chemistry", "bond_valence", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
        else:
            findings.append(_finding("warn", "local_chemistry", "bond_valence", f"bond-valence data are missing for site {entry.get('site') or element}", evidence_class="missing", confidence=1.0, blocks=False))
        results.append(result)
    normalized["coordination_sites"] = results


def _interface_and_strain_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any], limits: dict[str, float]) -> None:
    strain = candidate.get("strain")
    if isinstance(strain, dict):
        try:
            value = abs(_number(strain.get("strain_percent"), "strain.strain_percent"))
            normalized["strain_percent"] = value
            if value > limits["max_strain_percent"]:
                findings.append(_finding("error", "hard_constraint", "strain_bound", f"strain {value:g}% exceeds configured bound", evidence_class="computed", confidence=1.0, blocks=True))
        except PhysicsScreenError as exc:
            findings.append(_finding("error", "hard_constraint", "strain_bound", str(exc), evidence_class="computed", confidence=1.0, blocks=True))
    interface = candidate.get("interface")
    if not isinstance(interface, dict):
        return
    a = interface.get("lattice_a") or interface.get("a_lengths")
    b = interface.get("lattice_b") or interface.get("b_lengths")
    if not isinstance(a, list) or not isinstance(b, list) or len(a) < 2 or len(b) < 2:
        findings.append(_finding("warn", "constructibility", "lattice_mismatch", "interface lattice lengths are missing", evidence_class="missing", confidence=1.0, blocks=True))
        return
    mismatches = []
    for left, right in zip(a, b):
        left_value = _number(left, "interface.lattice_a")
        right_value = _number(right, "interface.lattice_b")
        if right_value <= 0:
            raise PhysicsScreenError("interface lattice length must be positive")
        mismatches.append(abs(left_value - right_value) / right_value)
    maximum = max(mismatches)
    normalized["lattice_mismatch_fraction"] = maximum
    if maximum > limits["max_lattice_mismatch_fraction"]:
        findings.append(_finding("error", "hard_constraint", "lattice_mismatch", f"maximum interface mismatch {maximum:.3f} exceeds configured bound", evidence_class="computed", confidence=1.0, blocks=True))
    elif maximum > limits["warn_lattice_mismatch_fraction"]:
        findings.append(_finding("warn", "constructibility", "lattice_mismatch", f"maximum interface mismatch is {maximum:.3f}; coherency is uncertain", evidence_class="computed", confidence=0.9))


def _thermodynamic_screen(candidate: dict[str, Any], conditions: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any], limits: dict[str, float]) -> None:
    physics = candidate.get("physics") if isinstance(candidate.get("physics"), dict) else {}
    database = physics.get("database") if isinstance(physics.get("database"), dict) else {}
    energy, energy_meta = _source_value(database.get("energy_above_hull"), "database_record")
    if energy is None:
        findings.append(_finding("warn", "thermodynamics", "energy_above_hull", "energy above hull is missing; phase persistence is unresolved", evidence_class="missing", confidence=1.0, blocks=True))
    else:
        normalized["energy_above_hull"] = {"value": energy, "provenance": energy_meta}
        if energy > limits["max_energy_above_hull_ev_per_atom"]:
            findings.append(_finding("warn", "thermodynamics", "energy_above_hull", f"energy above hull {energy:.3f} eV/atom is a high metastability proxy", evidence_class=energy_meta["evidence_class"], confidence=0.85, blocks=True))
        elif energy > limits["stable_energy_above_hull_ev_per_atom"]:
            findings.append(_finding("warn", "thermodynamics", "energy_above_hull", f"energy above hull {energy:.3f} eV/atom indicates metastability; synthesis pathway is required", evidence_class=energy_meta["evidence_class"], confidence=0.8))
        else:
            findings.append(_finding("info", "thermodynamics", "energy_above_hull", f"energy above hull {energy:.3f} eV/atom is within the configured proxy window", evidence_class=energy_meta["evidence_class"], confidence=0.8))
    phase_exists = database.get("phase_exists")
    if phase_exists is False:
        findings.append(_finding("warn", "thermodynamics", "phase_existence", "the searched database reports no matching phase; this is not proof of impossibility", evidence_class="database_record", confidence=0.8, blocks=True))
    elif phase_exists is None:
        findings.append(_finding("warn", "thermodynamics", "phase_existence", "phase existence is not established by a database record", evidence_class="missing", confidence=1.0, blocks=True))
    stability = database.get("aqueous_stability") or database.get("pourbaix_stability")
    if stability is None:
        findings.append(_finding("warn", "thermodynamics", "aqueous_stability", "pH/potential-conditioned aqueous stability is missing", evidence_class="missing", confidence=1.0, blocks=True))
    else:
        risk = str(stability.get("risk") if isinstance(stability, dict) else stability).lower()
        normalized["aqueous_stability"] = stability
        if risk in {"high", "unstable", "dissolves"}:
            findings.append(_finding("warn", "thermodynamics", "aqueous_stability", f"aqueous dissolution risk is {risk}", evidence_class="database_record", confidence=0.8, blocks=True))
        elif risk in {"medium", "metastable", "conditional"}:
            findings.append(_finding("warn", "thermodynamics", "aqueous_stability", f"aqueous stability is conditional: {risk}", evidence_class="database_record", confidence=0.7))
        else:
            findings.append(_finding("info", "thermodynamics", "aqueous_stability", f"aqueous stability record: {risk}", evidence_class="database_record", confidence=0.7))
    normalized["conditions"] = dict(conditions)


def _descriptor_value(physics: dict[str, Any], key: str) -> Any:
    descriptors = physics.get("oer_descriptors")
    return descriptors.get(key) if isinstance(descriptors, dict) else None


def _oer_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any]) -> None:
    physics = candidate.get("physics") if isinstance(candidate.get("physics"), dict) else {}
    descriptors = physics.get("oer_descriptors") if isinstance(physics.get("oer_descriptors"), dict) else {}
    descriptor_names = ("delta_g_oh", "delta_g_o", "delta_g_ooh")
    values: dict[str, Any] = {name: descriptors.get(name) for name in descriptor_names}
    relation = physics.get("scaling_relation")
    if values["delta_g_ooh"] is None and isinstance(relation, dict) and values["delta_g_oh"] is not None:
        slope = relation.get("ooh_vs_oh_slope")
        intercept = relation.get("ooh_vs_oh_intercept")
        if slope is not None and intercept is not None:
            oh, oh_meta = _source_value(values["delta_g_oh"], "computed")
            if oh is not None:
                values["delta_g_ooh"] = {"value": _number(slope, "scaling_relation.ooh_vs_oh_slope") * oh + _number(intercept, "scaling_relation.ooh_vs_oh_intercept"), "uncertainty": relation.get("uncertainty", 0.2), "evidence_class": "scaling_relation", "source": str(relation.get("source") or "")}
    bounds: dict[str, tuple[float, float]] = {}
    missing: list[str] = []
    for name, value in values.items():
        interval = _uncertainty_bounds(value)
        if interval is None:
            missing.append(name)
        else:
            bounds[name] = interval
    if missing:
        findings.append(_finding("warn", "electrocatalysis", "oer_descriptors", f"missing OER descriptors: {', '.join(missing)}; adsorption energetics require DFT or a calibrated proxy", evidence_class="missing", confidence=1.0, blocks=False))
        normalized["oer_descriptors"] = {"status": "incomplete", "bounds": bounds, "missing": missing}
        return
    corners = itertools.product(*(bounds[name] for name in descriptor_names))
    overpotentials: list[float] = []
    limiting_potentials: list[float] = []
    step_ranges: list[list[float]] = []
    for goh, go, gooh in corners:
        steps = [goh, go - goh, gooh - go, OER_TOTAL_FREE_ENERGY - gooh]
        limiting = max(steps)
        limiting_potentials.append(limiting)
        overpotentials.append(limiting - E_OER_THERMODYNAMIC)
        step_ranges.append(steps)
    lower = min(overpotentials)
    upper = max(overpotentials)
    normalized["oer_descriptors"] = {
        "status": "complete",
        "bounds": bounds,
        "limiting_potential_v": {"min": min(limiting_potentials), "max": max(limiting_potentials)},
        "theoretical_overpotential_v": {"min": lower, "max": upper},
        "step_free_energy_corners_ev": step_ranges,
    }
    if lower > 0.5:
        findings.append(_finding("warn", "electrocatalysis", "sabatier_proxy", f"descriptor bounds imply a high OER overpotential range [{lower:.3f}, {upper:.3f}] V", evidence_class="computed", confidence=0.85, blocks=True))
    elif upper - lower > 0.25:
        findings.append(_finding("warn", "electrocatalysis", "descriptor_uncertainty", f"OER overpotential uncertainty is wide: [{lower:.3f}, {upper:.3f}] V", evidence_class="computed", confidence=0.8))
    else:
        findings.append(_finding("info", "electrocatalysis", "sabatier_proxy", f"descriptor-based OER overpotential interval is [{lower:.3f}, {upper:.3f}] V", evidence_class="computed", confidence=0.75))


def _absolute_interval(bounds: tuple[float, float]) -> tuple[float, float]:
    """Return the interval of absolute values for a signed descriptor interval."""
    lower, upper = bounds
    return (0.0 if lower <= 0.0 <= upper else min(abs(lower), abs(upper)), max(abs(lower), abs(upper)))


def _her_screen(candidate: dict[str, Any], findings: list[dict[str, Any]], normalized: dict[str, Any]) -> None:
    """Screen HER with a hydrogen-binding descriptor and optional alkaline proxy."""
    physics = candidate.get("physics") if isinstance(candidate.get("physics"), dict) else {}
    descriptors = physics.get("her_descriptors") if isinstance(physics.get("her_descriptors"), dict) else {}
    delta_g_h = descriptors.get("delta_g_h")
    delta_bounds = _uncertainty_bounds(delta_g_h)
    barrier_value = descriptors.get("water_dissociation_barrier_ev")
    barrier_bounds = _uncertainty_bounds(barrier_value)

    if delta_bounds is None:
        missing = ["delta_g_h"]
        incomplete: dict[str, Any] = {"status": "incomplete", "bounds": {}, "missing": missing}
        if barrier_bounds is not None:
            incomplete["water_dissociation_barrier_ev"] = {
                "bounds": list(barrier_bounds),
                "provenance": _source_value(barrier_value, "computed")[1],
            }
        normalized["her_descriptors"] = incomplete
        findings.append(_finding(
            "warn",
            "electrocatalysis",
            "her_descriptors",
            "missing HER descriptor: delta_g_h; hydrogen adsorption energetics require DFT or a calibrated proxy",
            evidence_class="missing",
            confidence=1.0,
            blocks=False,
        ))
        return

    absolute_bounds = _absolute_interval(delta_bounds)
    result: dict[str, Any] = {
        "status": "complete",
        "bounds": {"delta_g_h": list(delta_bounds)},
        "absolute_delta_g_h_ev": {"min": absolute_bounds[0], "max": absolute_bounds[1]},
        # Numerically eV per elementary charge is volts; this is only a
        # thermodynamic descriptor proxy and omits kinetics, coverage, and pH.
        "theoretical_overpotential_v": {"min": absolute_bounds[0], "max": absolute_bounds[1]},
        "provenance": {"delta_g_h": _source_value(delta_g_h, "computed")[1]},
    }
    if barrier_bounds is not None:
        result["water_dissociation_barrier_ev"] = {
            "bounds": list(barrier_bounds),
            "provenance": _source_value(barrier_value, "computed")[1],
        }
    normalized["her_descriptors"] = result

    lower, upper = absolute_bounds
    if lower > HER_HIGH_OVERPOTENTIAL_EV:
        findings.append(_finding(
            "warn",
            "electrocatalysis",
            "her_sabatier_proxy",
            f"descriptor bounds imply a high HER overpotential range [{lower:.3f}, {upper:.3f}] V",
            evidence_class="computed",
            confidence=0.85,
            blocks=True,
        ))
    elif upper - lower > 0.25:
        findings.append(_finding(
            "warn",
            "electrocatalysis",
            "her_descriptor_uncertainty",
            f"HER overpotential uncertainty is wide: [{lower:.3f}, {upper:.3f}] V",
            evidence_class="computed",
            confidence=0.8,
        ))
    else:
        findings.append(_finding(
            "info",
            "electrocatalysis",
            "her_sabatier_proxy",
            f"descriptor-based HER overpotential interval is [{lower:.3f}, {upper:.3f}] V",
            evidence_class="computed",
            confidence=0.75,
        ))

    if barrier_bounds is not None:
        barrier_lower, barrier_upper = barrier_bounds
        if barrier_lower > HER_HIGH_WATER_DISSOCIATION_BARRIER_EV:
            findings.append(_finding(
                "warn",
                "electrocatalysis",
                "water_dissociation_barrier",
                f"water-dissociation barrier proxy is high: [{barrier_lower:.3f}, {barrier_upper:.3f}] eV",
                evidence_class="computed",
                confidence=0.75,
                blocks=True,
            ))
        elif barrier_upper - barrier_lower > 0.25:
            findings.append(_finding(
                "warn",
                "electrocatalysis",
                "water_dissociation_barrier_uncertainty",
                f"water-dissociation barrier uncertainty is wide: [{barrier_lower:.3f}, {barrier_upper:.3f}] eV",
                evidence_class="computed",
                confidence=0.7,
            ))


def _fingerprint(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def pre_dft_physics_screen(
    candidate: dict[str, Any],
    conditions: dict[str, Any] | None = None,
    output_path: str | None = None,
    candidate_sha256: str = "",
    evidence_graph_hash: str = "",
) -> dict[str, Any]:
    """Run hard-constraint, local-chemistry, thermodynamic, HER, and OER proxy checks."""
    if not isinstance(candidate, dict):
        raise PhysicsScreenError("candidate must be an object")
    if conditions is not None and not isinstance(conditions, dict):
        raise PhysicsScreenError("conditions must be an object")
    limits = {
        "min_distance_angstrom": 0.8,
        "max_vacancy_fraction": 0.30,
        "max_dopant_fraction": 0.30,
        "max_strain_percent": 8.0,
        "max_coating_thickness_nm": 100.0,
        "warn_lattice_mismatch_fraction": 0.05,
        "max_lattice_mismatch_fraction": 0.15,
        "stable_energy_above_hull_ev_per_atom": 0.05,
        "max_energy_above_hull_ev_per_atom": 0.30,
    }
    supplied_limits = candidate.get("physics_limits")
    if isinstance(supplied_limits, dict):
        for key in tuple(limits):
            if key in supplied_limits:
                limits[key] = _number(supplied_limits[key], f"physics_limits.{key}")
    findings: list[dict[str, Any]] = []
    normalized: dict[str, Any] = {"limits": limits}
    _charge_screen(candidate, findings, normalized)
    _occupancy_screen(candidate, findings, normalized, limits)
    _operator_bounds(candidate, findings, normalized, limits)
    _distance_screen(candidate, findings, normalized, limits)
    _local_chemistry_screen(candidate, findings, normalized)
    _interface_and_strain_screen(candidate, findings, normalized, limits)
    _thermodynamic_screen(candidate, dict(conditions or {}), findings, normalized, limits)
    _oer_screen(candidate, findings, normalized)
    _her_screen(candidate, findings, normalized)

    blocking_hard = [finding for finding in findings if finding["blocks"] and finding["level"] == "error"]
    blocking_unknowns = [finding for finding in findings if finding["blocks"] and finding["evidence_class"] == "missing"]
    high_risk = [finding for finding in findings if finding["blocks"] and finding["level"] == "warn"]
    if blocking_hard:
        decision = "reject"
    elif blocking_unknowns or high_risk:
        decision = "hold"
    else:
        decision = "promote_to_dft"
    counts = {
        "errors": sum(1 for finding in findings if finding["level"] == "error"),
        "warnings": sum(1 for finding in findings if finding["level"] == "warn"),
        "missing": sum(1 for finding in findings if finding["evidence_class"] == "missing"),
        "heuristic_or_proxy": sum(1 for finding in findings if finding["evidence_class"] in {"assumption", "embedded_reference", "scaling_relation"}),
    }
    result = {
        "schema_version": SCREEN_SCHEMA_VERSION,
        "screen_type": "pre_dft_physics_chemistry",
        "decision": decision,
        "candidate_id": str(candidate.get("candidate_id") or ""),
        "candidate_sha256": candidate_sha256 or str((candidate.get("provenance") or {}).get("candidate_sha256") or ""),
        "evidence_graph_hash": evidence_graph_hash or str((candidate.get("provenance") or {}).get("evidence_graph_hash") or ""),
        "candidate_fingerprint": _fingerprint(candidate),
        "conditions": dict(conditions or {}),
        "findings": findings,
        "normalized": normalized,
        "uncertainty": {
            "counts": counts,
            "interpretation": "Database records are observations; proxies and scaling relations bound hypotheses; missing evidence is not a negative result.",
        },
        "limitations": [
            "The screen does not prove phase synthesizability.",
            "Energy-above-hull and aqueous-risk inputs are only as reliable as their source conditions.",
            "OER and HER descriptor intervals do not replace explicit surface, coverage, solvent, reconstruction, or kinetic calculations.",
            "For alkaline HER, water-dissociation barriers are an optional Volmer-step proxy and do not replace explicit solvent or AIMD/DFT kinetics.",
        ],
    }
    if output_path:
        from pathlib import Path

        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(json.dumps(result, indent=2, ensure_ascii=True), encoding="utf-8")
        temporary.replace(target)
        result["artifact"] = str(target)
    return result
