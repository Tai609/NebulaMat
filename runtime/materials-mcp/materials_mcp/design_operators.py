"""Explicit, deterministic material-design operator registry and executor."""
from __future__ import annotations

import copy
import re
from typing import Any


_ELEMENT = r"^[A-Z][a-z]?$"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


DESIGN_OPERATORS: dict[str, dict[str, Any]] = {
    "element_substitution": {
        "domain": "composition",
        "description": "Replace a declared fraction of one species on a crystallographic site.",
        "parameters": {
            "site": {"type": "string"},
            "from_element": {"type": "string", "pattern": _ELEMENT},
            "to_element": {"type": "string", "pattern": _ELEMENT},
            "fraction": {"type": "number", "exclusive_minimum": 0.0, "maximum": 1.0},
        },
        "validation_checks": ["site_exists", "source_occupancy_sufficient", "formula", "charge", "structure"],
    },
    "aliovalent_doping": {
        "domain": "composition",
        "description": "Introduce an aliovalent dopant with an explicit compensation strategy.",
        "parameters": {
            "site": {"type": "string"},
            "host_element": {"type": "string", "pattern": _ELEMENT},
            "dopant": {"type": "string", "pattern": _ELEMENT},
            "fraction": {"type": "number", "exclusive_minimum": 0.0, "maximum": 1.0},
            "compensation_strategy": {"type": "enum", "values": ["vacancy", "co_dopant", "redox", "unknown"]},
        },
        "validation_checks": ["site_exists", "charge_compensation", "formula", "charge", "structure"],
    },
    "vacancy_engineering": {
        "domain": "defect",
        "description": "Create a declared vacancy fraction on a specified occupied site.",
        "parameters": {
            "site": {"type": "string"},
            "species": {"type": "string", "pattern": _ELEMENT},
            "fraction": {"type": "number", "exclusive_minimum": 0.0, "maximum": 1.0},
        },
        "validation_checks": ["site_exists", "source_occupancy_sufficient", "charge", "defect_supercell", "structure"],
    },
    "interstitial_engineering": {
        "domain": "defect",
        "description": "Add an interstitial species at an explicitly named site and occupancy.",
        "parameters": {
            "site": {"type": "string"},
            "species": {"type": "string", "pattern": _ELEMENT},
            "fraction": {"type": "number", "exclusive_minimum": 0.0, "maximum": 1.0},
        },
        "validation_checks": ["interstitial_site", "charge", "minimum_distance", "structure"],
    },
    "phase_selection": {
        "domain": "crystal_structure",
        "description": "Select a target polymorph with an explicit processing control variable.",
        "parameters": {
            "from_phase": {"type": "string"},
            "to_phase": {"type": "string"},
            "control_variable": {"type": "enum", "values": ["temperature", "pressure", "atmosphere", "precursor", "quench_rate", "substrate"]},
        },
        "validation_checks": ["phase_identifier", "phase_stability", "structure"],
    },
    "strain_engineering": {
        "domain": "crystal_structure",
        "description": "Apply a bounded homogeneous strain descriptor.",
        "parameters": {
            "mode": {"type": "enum", "values": ["uniaxial", "biaxial", "hydrostatic"]},
            "strain_percent": {"type": "number", "minimum": -10.0, "maximum": 10.0},
            "axis": {"type": "enum", "values": ["a", "b", "c", "all"]},
        },
        "validation_checks": ["strain_bound", "relaxation_required", "structure"],
    },
    "surface_faceting": {
        "domain": "surface",
        "description": "Choose a Miller-index facet and explicit termination.",
        "parameters": {
            "miller_index": {"type": "integer_list", "length": 3},
            "termination": {"type": "string"},
        },
        "validation_checks": ["miller_index", "termination_stoichiometry", "surface_energy"],
    },
    "interface_construction": {
        "domain": "interface",
        "description": "Join two named phases with declared orientations and registry.",
        "parameters": {
            "material_a": {"type": "string"},
            "material_b": {"type": "string"},
            "orientation_a": {"type": "integer_list", "length": 3},
            "orientation_b": {"type": "integer_list", "length": 3},
            "registry": {"type": "string"},
        },
        "validation_checks": ["lattice_match", "termination", "interface_charge", "structure"],
    },
    "surface_coating": {
        "domain": "surface",
        "description": "Add a conformal coating with a declared material and thickness.",
        "parameters": {
            "coating_material": {"type": "string"},
            "thickness_nm": {"type": "number", "exclusive_minimum": 0.0, "maximum": 1000.0},
        },
        "validation_checks": ["coating_identity", "thickness", "interface_compatibility", "transport_tradeoff"],
    },
    "morphology_control": {
        "domain": "morphology",
        "description": "Set a morphology class and characteristic dimension.",
        "parameters": {
            "morphology": {"type": "enum", "values": ["bulk", "nanoparticle", "nanosheet", "nanowire", "porous", "core_shell"]},
            "characteristic_size_nm": {"type": "number", "exclusive_minimum": 0.0, "maximum": 1000000.0},
        },
        "validation_checks": ["size_distribution", "surface_area", "transport_tradeoff", "synthesis_feasibility"],
    },
}


def operator_catalog() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "operators": copy.deepcopy(DESIGN_OPERATORS),
        "boundary": "Operators transform an explicit design-state descriptor; atomistic structures still require deterministic generation and validation.",
    }


def _parameter_error(name: str, value: Any, spec: dict[str, Any]) -> str | None:
    kind = spec["type"]
    if kind == "string":
        if not isinstance(value, str) or not value.strip():
            return f"{name} must be a non-empty string"
        if spec.get("pattern") and not re.fullmatch(str(spec["pattern"]), value):
            return f"{name} has an invalid format"
    elif kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"{name} must be numeric"
        number = float(value)
        if "minimum" in spec and number < float(spec["minimum"]):
            return f"{name} is below its minimum"
        if "exclusive_minimum" in spec and number <= float(spec["exclusive_minimum"]):
            return f"{name} must be greater than its minimum"
        if "maximum" in spec and number > float(spec["maximum"]):
            return f"{name} exceeds its maximum"
    elif kind == "enum":
        if value not in spec["values"]:
            return f"{name} must be one of: {', '.join(spec['values'])}"
    elif kind == "integer_list":
        if (
            not isinstance(value, list)
            or len(value) != int(spec["length"])
            or any(isinstance(item, bool) or not isinstance(item, int) for item in value)
            or all(item == 0 for item in value)
        ):
            return f"{name} must be {spec['length']} non-all-zero integers"
    return None


def validate_operator_invocation(invocation: Any) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if not isinstance(invocation, dict):
        return [{"level": "error", "check": "operator", "message": "operator invocation must be an object"}]
    operator_id = str(invocation.get("operator_id") or "")
    definition = DESIGN_OPERATORS.get(operator_id)
    if definition is None:
        return [{"level": "error", "check": "operator", "message": f"unknown operator: {operator_id}"}]
    parameters = invocation.get("parameters")
    if not isinstance(parameters, dict):
        return [{"level": "error", "check": operator_id, "message": "parameters must be an object"}]
    expected = definition["parameters"]
    for name, spec in expected.items():
        if name not in parameters:
            findings.append({"level": "error", "check": operator_id, "message": f"missing parameter: {name}"})
            continue
        error = _parameter_error(name, parameters[name], spec)
        if error:
            findings.append({"level": "error", "check": operator_id, "message": error})
    for name in sorted(set(parameters) - set(expected)):
        findings.append({"level": "error", "check": operator_id, "message": f"unexpected parameter: {name}"})
    effects = invocation.get("expected_effects")
    if not isinstance(effects, list) or not effects:
        findings.append({"level": "error", "check": operator_id, "message": "expected_effects must be a non-empty list"})
    return findings


def _site_occupancies(state: dict[str, Any], site: str) -> dict[str, float]:
    sites = state.setdefault("site_occupancies", {})
    if not isinstance(sites, dict) or not isinstance(sites.get(site), dict):
        raise ValueError(f"design state does not contain site: {site}")
    return {str(key): float(value) for key, value in sites[site].items()}


def _replace_fraction(
    state: dict[str, Any], site: str, source: str, target: str, fraction: float
) -> None:
    occupancy = _site_occupancies(state, site)
    available = occupancy.get(source, 0.0)
    if available + 1e-12 < fraction:
        raise ValueError(f"site {site} has insufficient {source} occupancy")
    occupancy[source] = round(available - fraction, 12)
    occupancy[target] = round(occupancy.get(target, 0.0) + fraction, 12)
    state["site_occupancies"][site] = {
        key: value for key, value in occupancy.items() if value > 1e-12
    }


def apply_design_operators(
    base_state: dict[str, Any], invocations: list[dict[str, Any]]
) -> dict[str, Any]:
    """Apply operator semantics to a JSON design-state descriptor."""
    if not isinstance(base_state, dict):
        raise ValueError("base_state must be an object")
    if not isinstance(invocations, list) or not invocations:
        raise ValueError("operators must be a non-empty list")
    state = copy.deepcopy(base_state)
    lineage: list[dict[str, Any]] = []
    for index, invocation in enumerate(invocations):
        findings = validate_operator_invocation(invocation)
        errors = [item["message"] for item in findings if item["level"] == "error"]
        if errors:
            raise ValueError(f"operator {index} is invalid: {'; '.join(errors)}")
        operator_id = str(invocation["operator_id"])
        parameters = dict(invocation["parameters"])
        if operator_id == "element_substitution":
            _replace_fraction(
                state,
                str(parameters["site"]),
                str(parameters["from_element"]),
                str(parameters["to_element"]),
                float(parameters["fraction"]),
            )
        elif operator_id == "aliovalent_doping":
            _replace_fraction(
                state,
                str(parameters["site"]),
                str(parameters["host_element"]),
                str(parameters["dopant"]),
                float(parameters["fraction"]),
            )
            state.setdefault("charge_compensation", []).append(parameters["compensation_strategy"])
        elif operator_id == "vacancy_engineering":
            _replace_fraction(
                state,
                str(parameters["site"]),
                str(parameters["species"]),
                "Vac",
                float(parameters["fraction"]),
            )
        elif operator_id == "interstitial_engineering":
            state.setdefault("interstitials", []).append(parameters)
        elif operator_id == "phase_selection":
            state["phase"] = parameters["to_phase"]
            state["phase_control"] = parameters["control_variable"]
        elif operator_id == "strain_engineering":
            state["strain"] = {
                "mode": parameters["mode"],
                "strain_percent": float(parameters["strain_percent"]),
                "axis": parameters["axis"],
            }
        elif operator_id == "surface_faceting":
            state["surface"] = {
                "miller_index": list(parameters["miller_index"]),
                "termination": parameters["termination"],
            }
        elif operator_id == "interface_construction":
            state.setdefault("interfaces", []).append(parameters)
        elif operator_id == "surface_coating":
            state.setdefault("coatings", []).append(parameters)
        elif operator_id == "morphology_control":
            state["morphology"] = parameters
        lineage.append({
            "step": index + 1,
            "operator_id": operator_id,
            "domain": DESIGN_OPERATORS[operator_id]["domain"],
            "parameters": parameters,
        })
    return {"schema_version": 1, "derived_state": state, "operator_lineage": lineage}


def validate_design_candidate(
    candidate: dict[str, Any], evidence_graph: dict[str, Any]
) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    if not isinstance(candidate, dict):
        return {"valid": False, "findings": [{"level": "error", "check": "candidate", "message": "candidate must be an object"}]}
    candidate_id = str(candidate.get("candidate_id") or "")
    if not _SAFE_ID.fullmatch(candidate_id):
        findings.append({"level": "error", "check": "candidate_id", "message": "candidate_id is invalid"})
    parents = candidate.get("parent_materials")
    if not isinstance(parents, list) or not parents or any(not isinstance(item, dict) or not item.get("reference") for item in parents):
        findings.append({"level": "error", "check": "parent_materials", "message": "parent_materials require source references"})
    if not str(candidate.get("frozen_objective") or "").strip():
        findings.append({"level": "error", "check": "objective", "message": "frozen_objective is required"})
    if not isinstance(candidate.get("constraints"), dict):
        findings.append({"level": "error", "check": "constraints", "message": "constraints must be an object"})
    invocations = candidate.get("operators")
    if not isinstance(invocations, list) or not invocations:
        findings.append({"level": "error", "check": "operators", "message": "at least one design operator is required"})
        invocations = []
    for invocation in invocations:
        findings.extend(validate_operator_invocation(invocation))

    graph_nodes = {
        str(node.get("node_id")): node
        for node in evidence_graph.get("nodes", [])
        if isinstance(node, dict)
    }
    graph_edges = {
        str(edge.get("edge_id")): edge
        for edge in evidence_graph.get("edges", [])
        if isinstance(edge, dict)
    }
    for invocation in invocations:
        for effect in invocation.get("expected_effects", []) if isinstance(invocation, dict) else []:
            if not isinstance(effect, dict):
                findings.append({"level": "error", "check": "expected_effect", "message": "expected effect must be an object"})
                continue
            node_id = str(effect.get("target_node_id") or "")
            node = graph_nodes.get(node_id)
            if not node or node.get("node_type") not in {"mechanism", "failure_mode"}:
                findings.append({"level": "error", "check": "expected_effect", "message": f"invalid graph target: {node_id}"})
            direction = str(effect.get("direction") or "")
            if direction not in {"promote", "suppress", "mitigate", "aggravate", "probe"}:
                findings.append({"level": "error", "check": "expected_effect", "message": f"invalid effect direction: {direction}"})
            if direction in {"mitigate", "aggravate"} and node and node.get("node_type") != "failure_mode":
                findings.append({"level": "error", "check": "expected_effect", "message": f"{direction} must target a failure_mode"})
            rationale = effect.get("rationale_edge_ids")
            if not isinstance(rationale, list) or not rationale or any(edge_id not in graph_edges for edge_id in rationale):
                findings.append({"level": "error", "check": "expected_effect", "message": "rationale_edge_ids must reference graph edges"})
            elif not any(graph_edges[edge_id].get("target") == node_id for edge_id in rationale):
                findings.append({"level": "error", "check": "expected_effect", "message": "at least one rationale edge must terminate at the graph target"})
            if not str(effect.get("falsifier") or "").strip():
                findings.append({"level": "error", "check": "expected_effect", "message": "every expected effect requires a falsifier"})

    transformed = None
    if not any(item["level"] == "error" for item in findings):
        try:
            transformed = apply_design_operators(dict(candidate.get("base_state") or {}), invocations)
        except ValueError as exc:
            findings.append({"level": "error", "check": "operator_application", "message": str(exc)})
    return {
        "schema_version": 1,
        "candidate_id": candidate_id,
        "valid": not any(item["level"] == "error" for item in findings),
        "findings": findings,
        "derived_state": transformed["derived_state"] if transformed else None,
        "operator_lineage": transformed["operator_lineage"] if transformed else [],
        "requires_novelty_audit": True,
    }
