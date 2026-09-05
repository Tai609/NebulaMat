"""Deterministic mechanism and failure evidence graph contracts."""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any


NODE_TYPES = {
    "material_state",
    "mechanism",
    "failure_mode",
    "observable",
    "evidence",
    "design_target",
}
EDGE_TYPES = {
    "supports",
    "contradicts",
    "causes",
    "aggravates",
    "mitigates",
    "transforms_to",
    "observed_as",
    "applies_to",
}
EVIDENCE_LEVEL_WEIGHTS = {
    "experimental_record": 1.0,
    "full_text": 0.9,
    "database_record": 0.8,
    "computed": 0.7,
    "abstract_only": 0.4,
    "metadata_only": 0.0,
}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


class EvidenceGraphError(ValueError):
    """The graph cannot support deterministic evidence computation."""


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EvidenceGraphError(f"{field} is required")
    return value.strip()


def _bounded(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise EvidenceGraphError(f"{field} must be a number between 0 and 1") from exc
    if not 0.0 <= number <= 1.0:
        raise EvidenceGraphError(f"{field} must be between 0 and 1")
    return number


def _string_list(value: Any, field: str, *, required: bool = False) -> list[str]:
    if value is None and not required:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise EvidenceGraphError(f"{field} must be a list of non-empty strings")
    result = [item.strip() for item in value]
    if required and not result:
        raise EvidenceGraphError(f"{field} must not be empty")
    return result


def _normalize_node(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise EvidenceGraphError("every graph node must be an object")
    node_id = _required_text(raw.get("node_id"), "node.node_id")
    if not _SAFE_ID.fullmatch(node_id):
        raise EvidenceGraphError(f"invalid node id: {node_id}")
    node_type = _required_text(raw.get("node_type"), f"node {node_id}.node_type")
    if node_type not in NODE_TYPES:
        raise EvidenceGraphError(f"unsupported node type: {node_type}")
    node = {
        "node_id": node_id,
        "node_type": node_type,
        "label": _required_text(raw.get("label"), f"node {node_id}.label"),
        "description": str(raw.get("description") or "").strip(),
    }
    if node_type == "evidence":
        source = raw.get("source")
        if not isinstance(source, dict):
            raise EvidenceGraphError(f"evidence node {node_id} requires source")
        level = _required_text(source.get("evidence_level"), f"node {node_id}.source.evidence_level")
        if level not in EVIDENCE_LEVEL_WEIGHTS:
            raise EvidenceGraphError(f"unsupported evidence level: {level}")
        reference = _required_text(source.get("reference"), f"node {node_id}.source.reference")
        anchor = str(source.get("anchor") or "").strip()
        if level in {"experimental_record", "full_text", "database_record", "computed"} and not anchor:
            raise EvidenceGraphError(f"evidence node {node_id} requires an exact source anchor")
        node["source"] = {
            "evidence_level": level,
            "reference": reference,
            "anchor": anchor,
            "method": str(source.get("method") or "").strip(),
            "conditions": dict(source.get("conditions") or {}),
        }
        node["confidence"] = _bounded(raw.get("confidence"), f"node {node_id}.confidence")
    if node_type in {"mechanism", "failure_mode"}:
        node["falsifiers"] = _string_list(
            raw.get("falsifiers"), f"node {node_id}.falsifiers", required=True
        )
    if node_type == "failure_mode":
        node["severity"] = _bounded(raw.get("severity"), f"node {node_id}.severity")
    return node


def _normalize_edge(raw: Any, nodes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise EvidenceGraphError("every graph edge must be an object")
    edge_id = _required_text(raw.get("edge_id"), "edge.edge_id")
    if not _SAFE_ID.fullmatch(edge_id):
        raise EvidenceGraphError(f"invalid edge id: {edge_id}")
    source = _required_text(raw.get("source"), f"edge {edge_id}.source")
    target = _required_text(raw.get("target"), f"edge {edge_id}.target")
    if source not in nodes or target not in nodes:
        raise EvidenceGraphError(f"edge {edge_id} references an unknown node")
    relation = _required_text(raw.get("relation"), f"edge {edge_id}.relation")
    if relation not in EDGE_TYPES:
        raise EvidenceGraphError(f"unsupported edge relation: {relation}")
    if relation in {"supports", "contradicts"} and nodes[source]["node_type"] != "evidence":
        raise EvidenceGraphError(f"edge {edge_id} must originate from an evidence node")
    evidence_ids = _string_list(raw.get("evidence_ids"), f"edge {edge_id}.evidence_ids")
    if relation in {"causes", "aggravates", "mitigates", "transforms_to"}:
        if not evidence_ids:
            raise EvidenceGraphError(f"causal edge {edge_id} requires evidence_ids")
        if any(
            evidence_id not in nodes or nodes[evidence_id]["node_type"] != "evidence"
            for evidence_id in evidence_ids
        ):
            raise EvidenceGraphError(f"edge {edge_id} has an invalid evidence reference")
    return {
        "edge_id": edge_id,
        "source": source,
        "target": target,
        "relation": relation,
        "weight": _bounded(raw.get("weight", 1.0), f"edge {edge_id}.weight"),
        "evidence_ids": evidence_ids,
        "conditions": dict(raw.get("conditions") or {}),
    }


def _evidence_weight(node: dict[str, Any]) -> float:
    source = node.get("source") or {}
    return EVIDENCE_LEVEL_WEIGHTS[str(source.get("evidence_level"))] * float(node.get("confidence", 0.0))


def compile_evidence_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Validate a property graph and compute auditable mechanism/failure scores."""
    if not isinstance(graph, dict):
        raise EvidenceGraphError("graph must be an object")
    raw_nodes = graph.get("nodes")
    raw_edges = graph.get("edges")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise EvidenceGraphError("graph.nodes must be a non-empty list")
    if not isinstance(raw_edges, list):
        raise EvidenceGraphError("graph.edges must be a list")
    normalized_nodes = [_normalize_node(node) for node in raw_nodes]
    nodes = {node["node_id"]: node for node in normalized_nodes}
    if len(nodes) != len(normalized_nodes):
        raise EvidenceGraphError("graph node ids must be unique")
    normalized_edges = [_normalize_edge(edge, nodes) for edge in raw_edges]
    edge_ids = [edge["edge_id"] for edge in normalized_edges]
    if len(set(edge_ids)) != len(edge_ids):
        raise EvidenceGraphError("graph edge ids must be unique")

    incoming: dict[str, list[dict[str, Any]]] = defaultdict(list)
    evidence_paths: list[dict[str, Any]] = []
    for edge in normalized_edges:
        incoming[edge["target"]].append(edge)
        if edge["relation"] in {"supports", "contradicts"}:
            evidence_paths.append({
                "evidence_node": edge["source"],
                "edge_id": edge["edge_id"],
                "target_node": edge["target"],
                "polarity": 1 if edge["relation"] == "supports" else -1,
            })

    scores: dict[str, dict[str, Any]] = {}
    missing_evidence: list[str] = []
    for node in normalized_nodes:
        if node["node_type"] not in {"mechanism", "failure_mode"}:
            continue
        contributions: list[dict[str, Any]] = []
        for edge in incoming[node["node_id"]]:
            if edge["relation"] not in {"supports", "contradicts"}:
                continue
            evidence = nodes[edge["source"]]
            polarity = 1.0 if edge["relation"] == "supports" else -1.0
            magnitude = _evidence_weight(evidence) * edge["weight"]
            contributions.append({
                "evidence_node": evidence["node_id"],
                "edge_id": edge["edge_id"],
                "contribution": round(polarity * magnitude, 6),
            })
        denominator = sum(abs(item["contribution"]) for item in contributions)
        score = sum(item["contribution"] for item in contributions) / denominator if denominator else 0.0
        coverage = min(1.0, denominator / 2.0)
        status = "supported" if score >= 0.25 else "contradicted" if score <= -0.25 else "unresolved"
        value = {
            "node_id": node["node_id"],
            "node_type": node["node_type"],
            "support_score": round(score, 6),
            "evidence_coverage": round(coverage, 6),
            "status": status,
            "contributions": contributions,
        }
        if node["node_type"] == "failure_mode":
            value["failure_priority"] = round(max(score, 0.0) * coverage * node["severity"], 6)
        scores[node["node_id"]] = value
        if not contributions:
            missing_evidence.append(node["node_id"])

    causal_edges = []
    for edge in normalized_edges:
        if edge["relation"] not in {"causes", "aggravates", "mitigates", "transforms_to"}:
            continue
        support = [nodes[evidence_id] for evidence_id in edge["evidence_ids"]]
        confidence = sum(_evidence_weight(node) for node in support) / len(support)
        causal_edges.append({**edge, "evidence_confidence": round(confidence * edge["weight"], 6)})

    compiled = {
        "schema_version": 1,
        "graph_type": "mechanism_failure_evidence",
        "nodes": normalized_nodes,
        "edges": normalized_edges,
        "scores": scores,
        "causal_edges": causal_edges,
        "evidence_paths": evidence_paths,
        "missing_evidence": sorted(missing_evidence),
        "computability": {
            "score_range": [-1.0, 1.0],
            "failure_priority_range": [0.0, 1.0],
            "source_weights": EVIDENCE_LEVEL_WEIGHTS,
        },
    }
    fingerprint = json.dumps(compiled, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    compiled["graph_hash"] = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    return compiled
