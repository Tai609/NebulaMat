"""Dependency-light active-learning and inverse-design planning helpers.

These functions select or generate candidates for later validation. They never
claim a predicted property and do not replace a trained surrogate model.
"""
from __future__ import annotations

import re
from itertools import product
from typing import Any


def _property(record: dict[str, Any], name: str) -> tuple[float, float]:
    value = (record.get("properties") or {}).get(name)
    if isinstance(value, dict):
        raw_value = value.get("predicted_value", value.get("value"))
        raw_uncertainty = value.get("uncertainty", 0.0)
    else:
        raw_value = value
        raw_uncertainty = record.get("uncertainty", 0.0)
    try:
        return float(raw_value), max(0.0, float(raw_uncertainty or 0.0))
    except (TypeError, ValueError):
        return float("nan"), 0.0


def select_active_learning_batch(
    records: list[dict[str, Any]],
    target_property: str,
    batch_size: int = 5,
    exploration_weight: float = 0.25,
    maximize: bool = True,
) -> dict[str, Any]:
    """Select high-value and uncertain records with simple diversity control."""
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    if exploration_weight < 0:
        raise ValueError("exploration_weight cannot be negative")
    ranked: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        value, uncertainty = _property(record, target_property)
        if value != value:  # NaN
            continue
        direction = 1.0 if maximize else -1.0
        ranked.append({
            "record": record,
            "score": direction * value + exploration_weight * uncertainty,
            "predicted_value": value,
            "uncertainty": uncertainty,
            "index": index,
        })
    ranked.sort(key=lambda item: (-item["score"], item["index"]))
    selected: list[dict[str, Any]] = []
    seen_formula: set[str] = set()
    for item in ranked:
        record = item["record"]
        formula = str(record.get("formula") or "")
        if formula and formula in seen_formula and len(selected) < batch_size:
            continue
        if formula:
            seen_formula.add(formula)
        selected.append({
            "provider": record.get("provider"),
            "material_id": record.get("material_id"),
            "formula": record.get("formula"),
            "score": item["score"],
            "predicted_value": item["predicted_value"],
            "uncertainty": item["uncertainty"],
            "selection_reason": "upper_confidence_bound" if maximize else "lower_confidence_bound",
        })
        if len(selected) >= batch_size:
            break
    # If diversity exhausted the first pass, fill the remainder by score.
    if len(selected) < batch_size:
        selected_ids = {(row.get("provider"), row.get("material_id")) for row in selected}
        for item in ranked:
            record = item["record"]
            key = (record.get("provider"), record.get("material_id"))
            if key in selected_ids:
                continue
            selected.append({
                "provider": record.get("provider"),
                "material_id": record.get("material_id"),
                "formula": record.get("formula"),
                "score": item["score"],
                "predicted_value": item["predicted_value"],
                "uncertainty": item["uncertainty"],
                "selection_reason": "score_fill",
            })
            if len(selected) >= batch_size:
                break
    return {
        "schema_version": 1,
        "mode": "active_learning_selection",
        "target_property": target_property,
        "selected": selected,
        "requires_validation": True,
        "model_claim": "selection only; no property prediction was performed",
    }


def generate_inverse_design_candidates(
    element_groups: list[list[str]],
    stoichiometries: list[list[int]],
    batch_size: int = 20,
) -> dict[str, Any]:
    """Generate formula proposals from explicit element and ratio grids."""
    if not element_groups or any(not group for group in element_groups):
        raise ValueError("element_groups must contain non-empty choices")
    if any(not re.fullmatch(r"[A-Z][a-z]?", str(element)) for group in element_groups for element in group):
        raise ValueError("element choices must be element symbols")
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    formulas: list[dict[str, Any]] = []
    for choices in product(*element_groups):
        for ratios in stoichiometries:
            if len(choices) != len(ratios) or any(int(amount) <= 0 for amount in ratios):
                continue
            formula = "".join(f"{element}{int(amount) if int(amount) != 1 else ''}" for element, amount in zip(choices, ratios))
            formulas.append({
                "formula": formula,
                "elements": list(choices),
                "ratios": [int(amount) for amount in ratios],
                "source": "template-combinatorial",
                "requires_validation": True,
            })
            if len(formulas) >= batch_size:
                return {
                    "schema_version": 1,
                    "mode": "inverse_design_proposals",
                    "candidates": formulas,
                    "model_claim": "template proposals only; validate before any scientific use",
                }
    return {
        "schema_version": 1,
        "mode": "inverse_design_proposals",
        "candidates": formulas,
        "model_claim": "template proposals only; validate before any scientific use",
    }
