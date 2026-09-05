#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Check that the fixed DeePMD QA package exists before DPMD handoff."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path, errors: list[str]) -> dict[str, Any]:
    if not path.exists():
        errors.append(f"missing {path}")
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"cannot parse {path}: {exc}")
        return {}


def resolve_artifact(root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def check_figure_list(root: Path, figures: list[Any], needle: str, errors: list[str]) -> None:
    matches = [str(fig) for fig in figures if needle in str(fig)]
    if not matches:
        errors.append(f"postprocess summary has no figure matching {needle}")
        return
    for match in matches:
        if not resolve_artifact(root, match).exists():
            errors.append(f"figure listed but missing: {match}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--model")
    parser.add_argument("--postprocess-summary", default="analysis/deepmd_postprocess/postprocess_summary.json")
    parser.add_argument("--pca-summary", default="analysis/deepmd_descriptor_pca_dft_all/summary.json")
    parser.add_argument("--json", action="store_true", help="print machine-readable verdict")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    errors: list[str] = []
    warnings: list[str] = []
    if args.model and not resolve_artifact(root, args.model).exists():
        errors.append(f"missing model {args.model}")

    post = load_json(resolve_artifact(root, args.postprocess_summary), errors)
    pca = load_json(resolve_artifact(root, args.pca_summary), errors)

    if post.get("status") != "ready_for_review":
        errors.append(f"postprocess summary status is {post.get('status')!r}, expected ready_for_review")
    figures = post.get("figures", []) if isinstance(post.get("figures", []), list) else []
    for key in ("lcurve_final", "energy_parity", "force_parity"):
        if key not in post:
            errors.append(f"postprocess summary missing {key}")
    check_figure_list(root, figures, "lcurve", errors)
    check_figure_list(root, figures, "energy_parity", errors)
    check_figure_list(root, figures, "force_parity", errors)
    check_figure_list(root, figures, "force_residual", errors)

    if pca.get("status") != "ready_for_review":
        errors.append(f"PCA summary status is {pca.get('status')!r}, expected ready_for_review")
    counts = pca.get("frame_counts_by_group", {})
    for group in ("DFT train", "DFT val", "DFT test"):
        if int(counts.get(group, 0) or 0) <= 0:
            errors.append(f"PCA summary has no frames for {group}")
    outputs = pca.get("outputs", {})
    for key in ("points_csv", "labels", "summary", "figure"):
        value = outputs.get(key)
        if not value:
            errors.append(f"PCA summary missing output path {key}")
        elif not resolve_artifact(root, str(value)).exists():
            errors.append(f"PCA output listed but missing: {value}")
    if pca.get("excluded_data"):
        warnings.append("PCA summary excluded some data; inspect excluded_data before using the model broadly")

    verdict = {"status": "pass" if not errors else "fail", "errors": errors, "warnings": warnings}
    if args.json:
        print(json.dumps(verdict, indent=2))
    else:
        print(f"DeepMD QA: {verdict['status']}")
        for item in errors:
            print(f"ERROR: {item}")
        for item in warnings:
            print(f"WARNING: {item}")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
