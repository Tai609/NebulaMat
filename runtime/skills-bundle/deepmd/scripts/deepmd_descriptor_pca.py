#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["deepmd-kit", "matplotlib", "numpy"]
# ///
"""Build a descriptor-PCA map for DeepMD DFT train/val/test splits.

The default scope is all DFT frames in train, val, and test split directories
under the supplied data roots. Run in an environment where the requested
DeepMD model can be loaded.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class DatasetBlock:
    split_dir: Path
    split: str
    system: str
    type_map: list[str]
    coords: np.ndarray
    cells: np.ndarray
    atom_types: np.ndarray
    indices: np.ndarray


@dataclass(frozen=True)
class DatasetRef:
    split_dir: Path
    split: str
    system: str


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def rel(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path)


def import_deeppotential():
    try:
        from deepmd.infer import DeepPotential

        return DeepPotential
    except Exception:
        from deepmd.tf.infer import DeepPotential

        return DeepPotential


def load_type_map(path: Path) -> list[str]:
    return path.joinpath("type_map.raw").read_text(encoding="utf-8").split()


def is_deepmd_npy_dir(path: Path) -> bool:
    return path.joinpath("set.000", "coord.npy").exists() and path.joinpath("type.raw").exists()


def infer_dataset_ref(dataset_dir: Path, splits: set[str]) -> DatasetRef | None:
    """Infer split/system from common DeepMD layouts.

    Supports both ``<system>/<split>/set.000`` and
    ``<split>/<system>/set.000`` without manual symlink staging.
    """

    dataset_dir = dataset_dir.resolve()
    if dataset_dir.name in splits:
        return DatasetRef(split_dir=dataset_dir, split=dataset_dir.name, system=dataset_dir.parent.name)
    if dataset_dir.parent.name in splits:
        return DatasetRef(split_dir=dataset_dir, split=dataset_dir.parent.name, system=dataset_dir.name)
    return None


def find_dataset_refs(roots: list[Path], splits: set[str]) -> list[DatasetRef]:
    found: list[DatasetRef] = []
    seen: set[Path] = set()
    for root in roots:
        root = root.resolve()
        candidates = [root] if is_deepmd_npy_dir(root) else []
        candidates.extend(p.parent.parent for p in root.rglob("set.000/coord.npy"))
        for dataset_dir in candidates:
            dataset_dir = dataset_dir.resolve()
            if dataset_dir in seen or not is_deepmd_npy_dir(dataset_dir):
                continue
            ref = infer_dataset_ref(dataset_dir, splits)
            if ref is None:
                continue
            found.append(ref)
            seen.add(dataset_dir)
    return sorted(found, key=lambda ref: (ref.split, ref.system, str(ref.split_dir)))


def deterministic_indices(n_frames: int, max_frames: int, key: str) -> np.ndarray:
    if max_frames <= 0 or n_frames <= max_frames:
        return np.arange(n_frames, dtype=int)
    seed = int.from_bytes(hashlib.sha256(key.encode("utf-8")).digest()[:8], "little") % (2**32)
    rng = np.random.default_rng(seed)
    return np.sort(rng.choice(n_frames, size=max_frames, replace=False))


def read_block(ref: DatasetRef, max_frames: int) -> DatasetBlock:
    split_dir = ref.split_dir
    set_dir = split_dir / "set.000"
    coords = np.load(set_dir / "coord.npy").astype(np.float32)
    cells = np.load(set_dir / "box.npy").astype(np.float32)
    atom_types = np.atleast_1d(np.loadtxt(split_dir / "type.raw", dtype=np.int32)).astype(np.int32)
    if coords.ndim != 2:
        coords = coords.reshape(coords.shape[0], -1)
    if cells.ndim != 2:
        cells = cells.reshape(cells.shape[0], -1)
    indices = deterministic_indices(coords.shape[0], max_frames, str(split_dir))
    return DatasetBlock(
        split_dir=split_dir,
        split=ref.split,
        system=ref.system,
        type_map=load_type_map(split_dir),
        coords=coords[indices],
        cells=cells[indices],
        atom_types=atom_types,
        indices=indices,
    )


def descriptor_features(high_d: np.ndarray, atom_types: np.ndarray, n_types: int, mode: str) -> np.ndarray:
    high_d = np.asarray(high_d)
    if high_d.ndim == 2 and mode == "pooled":
        n_atoms = len(atom_types)
        if high_d.shape[1] % n_atoms == 0:
            high_d = high_d.reshape(high_d.shape[0], n_atoms, high_d.shape[1] // n_atoms)
        else:
            mode = "flat"
    if high_d.ndim == 3 and mode == "pooled":
        chunks = []
        for type_id in range(n_types):
            mask = atom_types == type_id
            width = high_d.shape[-1]
            if not np.any(mask):
                chunks.append(np.zeros((high_d.shape[0], width), dtype=np.float32))
                chunks.append(np.zeros((high_d.shape[0], width), dtype=np.float32))
                continue
            selected = high_d[:, mask, :]
            chunks.append(selected.mean(axis=1).astype(np.float32))
            chunks.append(selected.std(axis=1).astype(np.float32))
        return np.concatenate(chunks, axis=1)
    return high_d.reshape(high_d.shape[0], -1).astype(np.float32)


def pad_and_concat(chunks: list[np.ndarray]) -> np.ndarray:
    max_width = max(chunk.shape[1] for chunk in chunks)
    padded = []
    for chunk in chunks:
        if chunk.shape[1] == max_width:
            padded.append(chunk)
            continue
        arr = np.zeros((chunk.shape[0], max_width), dtype=np.float32)
        arr[:, : chunk.shape[1]] = chunk
        padded.append(arr)
    return np.concatenate(padded, axis=0)


def pca_2d(features: np.ndarray) -> tuple[np.ndarray, list[float], np.ndarray, np.ndarray, np.ndarray]:
    x = features.astype(np.float64)
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std[std == 0.0] = 1.0
    x = (x - mean) / std
    _u, s, vt = np.linalg.svd(x, full_matrices=False)
    n_components = min(2, vt.shape[0])
    points = x @ vt[:n_components].T
    if n_components == 1:
        points = np.column_stack([points[:, 0], np.zeros(points.shape[0])])
    denom = float(np.sum(s**2))
    explained = ((s[:2] ** 2 / denom).tolist() if denom else [0.0, 0.0])
    if len(explained) == 1:
        explained.append(0.0)
    return points.astype(np.float32), explained, mean, std, s


def plot(points: np.ndarray, labels: list[dict[str, Any]], explained: list[float], fig_path: Path, title: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    groups = np.array([label["group"] for label in labels], dtype=object)
    colors = {"DFT train": "#3B82F6", "DFT val": "#10B981", "DFT test": "#F59E0B"}
    markers = {"DFT train": "o", "DFT val": "s", "DFT test": "^"}
    fig, ax = plt.subplots(figsize=(7.2, 5.4))
    for group in ["DFT train", "DFT val", "DFT test"]:
        idx = groups == group
        if not np.any(idx):
            continue
        ax.scatter(
            points[idx, 0],
            points[idx, 1],
            s=12,
            marker=markers[group],
            alpha=0.45,
            c=colors[group],
            linewidths=0.5,
            label=f"{group} (n={int(idx.sum())})",
        )
    ax.set_xlabel(f"PC1 ({explained[0] * 100:.1f}% variance)")
    ax.set_ylabel(f"PC2 ({explained[1] * 100:.1f}% variance)")
    ax.set_title(title)
    ax.legend(frameon=False, fontsize=9)
    ax.grid(True, color="#E5E7EB", linewidth=0.6)
    for spine in ax.spines.values():
        spine.set_linewidth(0.8)
        spine.set_color("#4B5563")
    fig.tight_layout()
    fig.savefig(fig_path, dpi=400, bbox_inches="tight")
    plt.close(fig)


def write_points_csv(path: Path, points: np.ndarray, labels: list[dict[str, Any]]) -> None:
    fields = ["pc1", "pc2", "group", "source_kind", "split", "system", "frame_index", "dataset_path"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for point, label in zip(points, labels, strict=True):
            row = dict(label)
            row["pc1"] = f"{float(point[0]):.10g}"
            row["pc2"] = f"{float(point[1]):.10g}"
            writer.writerow(row)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", help="Frozen DeepMD model used for eval_descriptor")
    parser.add_argument("--data-root", action="append", help="Root containing train/val/test deepmd/npy split dirs")
    parser.add_argument("--out-dir", default="analysis/deepmd_descriptor_pca_dft_all")
    parser.add_argument("--figure", default="figures/deepmd_descriptor_pca_dft_all.png")
    parser.add_argument("--title", default="DeepMD Descriptor PCA of All DFT Labels")
    parser.add_argument("--splits", default="train,val,test")
    parser.add_argument("--max-frames-per-split", type=int, default=0, help="0 means use all frames")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--feature-mode", choices=["pooled", "flat"], default="pooled")
    parser.add_argument("--allow-missing-splits", action="store_true")
    parser.add_argument("--skip-extract", action="store_true", help="reuse descriptor features and labels already in out-dir")
    parser.add_argument("--skip-pca", action="store_true", help="reuse X_2d.npy and summary.json already in out-dir")
    parser.add_argument("--skip-plot", action="store_true", help="write arrays and summary without importing matplotlib")
    args = parser.parse_args()

    project = Path.cwd().resolve()
    model = Path(args.model).resolve() if args.model else None
    out_dir = Path(args.out_dir).resolve()
    fig_path = Path(args.figure).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    fig_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path = out_dir / "summary.json"
    prior_summary: dict[str, Any] = {}
    if summary_path.exists():
        prior_summary = json.loads(summary_path.read_text(encoding="utf-8"))

    split_names = {x.strip() for x in args.splits.split(",") if x.strip()}
    excluded: list[dict[str, object]] = list(prior_summary.get("excluded_data", []))

    if not args.skip_extract:
        if model is None:
            parser.error("--model is required unless --skip-extract is used")
        if not args.data_root:
            parser.error("--data-root is required unless --skip-extract is used")
        dataset_refs = find_dataset_refs([Path(p) for p in args.data_root], split_names)
        if not dataset_refs:
            raise SystemExit("no deepmd/npy train/val/test split directories found")

        expected_type_map: list[str] | None = None
        blocks: list[DatasetBlock] = []
        excluded = []
        for ref in dataset_refs:
            try:
                block = read_block(ref, args.max_frames_per_split)
            except Exception as exc:
                excluded.append({"path": rel(ref.split_dir, project), "reason": f"read failed: {exc}"})
                continue
            if expected_type_map is None:
                expected_type_map = block.type_map
            if block.type_map != expected_type_map:
                excluded.append(
                    {
                        "path": rel(split_dir, project),
                        "reason": f"type_map {block.type_map} != {expected_type_map}",
                        "raw_frames": int(block.coords.shape[0]),
                    }
                )
                continue
            blocks.append(block)

        present_splits = {block.split for block in blocks}
        missing_splits = sorted(split_names - present_splits)
        if missing_splits and not args.allow_missing_splits:
            raise SystemExit(f"missing required DFT splits for PCA: {', '.join(missing_splits)}")
        if not blocks:
            raise SystemExit("no compatible DFT split directories remained after filtering")

        DeepPotential = import_deeppotential()
        dp = DeepPotential(str(model))
        feature_chunks: list[np.ndarray] = []
        labels: list[dict[str, Any]] = []
        frame_counts_by_group = {f"DFT {split}": 0 for split in sorted(split_names)}
        frame_counts_by_system_split: dict[str, dict[str, int]] = {}

        for block in blocks:
            block_features: list[np.ndarray] = []
            for start in range(0, block.coords.shape[0], args.batch_size):
                end = min(start + args.batch_size, block.coords.shape[0])
                high_d = dp.eval_descriptor(block.coords[start:end], block.cells[start:end], block.atom_types)
                block_features.append(
                    descriptor_features(np.asarray(high_d), block.atom_types, len(expected_type_map or []), args.feature_mode)
                )
            features_block = np.concatenate(block_features, axis=0)
            feature_chunks.append(features_block)
            group = f"DFT {block.split}"
            frame_counts_by_group[group] = frame_counts_by_group.get(group, 0) + int(features_block.shape[0])
            frame_counts_by_system_split.setdefault(block.system, {})[block.split] = int(features_block.shape[0])
            for frame_index in block.indices:
                labels.append(
                    {
                        "group": group,
                        "source_kind": "DFT label",
                        "split": block.split,
                        "system": block.system,
                        "frame_index": int(frame_index),
                        "dataset_path": rel(block.split_dir, project),
                    }
                )

        features = pad_and_concat(feature_chunks)
        np.save(out_dir / "pooled_descriptor_features.npy", features.astype(np.float32))
        (out_dir / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
        data_roots = [rel(Path(p), project) for p in args.data_root or []]
    else:
        features_path = out_dir / "pooled_descriptor_features.npy"
        labels_path = out_dir / "labels.json"
        if not features_path.exists() or not labels_path.exists():
            raise SystemExit("--skip-extract requires pooled_descriptor_features.npy and labels.json in out-dir")
        features = np.load(features_path).astype(np.float32)
        labels = json.loads(labels_path.read_text(encoding="utf-8"))
        expected_type_map = prior_summary.get("type_map")
        frame_counts_by_group = {f"DFT {split}": 0 for split in sorted(split_names)}
        frame_counts_by_system_split = {}
        for label in labels:
            group = str(label["group"])
            split = str(label["split"])
            system = str(label["system"])
            frame_counts_by_group[group] = frame_counts_by_group.get(group, 0) + 1
            frame_counts_by_system_split.setdefault(system, {})[split] = frame_counts_by_system_split.setdefault(system, {}).get(split, 0) + 1
        present_splits = {str(label["split"]) for label in labels}
        missing_splits = sorted(split_names - present_splits)
        data_roots = list(prior_summary.get("data_roots", []))
        if model is None and prior_summary.get("model"):
            model = resolve_prior_model = Path(str(prior_summary["model"]))
            if not resolve_prior_model.is_absolute():
                model = (project / resolve_prior_model).resolve()

    if not args.skip_pca:
        points, explained, mean, std, singular_values = pca_2d(features)
        np.save(out_dir / "X_2d.npy", points)
        np.savez_compressed(out_dir / "pca_scaler_and_singular_values.npz", mean=mean, std=std, singular_values=singular_values)
        write_points_csv(out_dir / "pca_points.csv", points, labels)
    else:
        points_path = out_dir / "X_2d.npy"
        if not points_path.exists():
            raise SystemExit("--skip-pca requires X_2d.npy in out-dir")
        points = np.load(points_path).astype(np.float32)
        explained = list(prior_summary.get("explained_variance_ratio_pc1_pc2", [0.0, 0.0]))

    if not args.skip_plot:
        plot(points, labels, explained, fig_path, args.title)

    figure_exists = fig_path.exists()
    status = "ready_for_review" if not missing_splits and figure_exists else "incomplete"
    summary_feature_mode = prior_summary.get("feature_mode", args.feature_mode) if args.skip_extract else args.feature_mode
    summary_max_frames = (
        prior_summary.get("max_frames_per_split", args.max_frames_per_split)
        if args.skip_extract
        else args.max_frames_per_split
    )
    summary = {
        "status": status,
        "created_at": now_iso(),
        "model": rel(model, project) if model else prior_summary.get("model"),
        "data_roots": data_roots,
        "type_map": expected_type_map,
        "feature_source": "DeepMD eval_descriptor from the supplied frozen model",
        "feature_mode": summary_feature_mode,
        "pca_scope": "all compatible DFT train/val/test frames under the supplied data roots",
        "max_frames_per_split": summary_max_frames,
        "n_frames": int(points.shape[0]),
        "n_features": int(features.shape[1]),
        "explained_variance_ratio_pc1_pc2": explained,
        "frame_counts_by_group": frame_counts_by_group,
        "frame_counts_by_system_split": frame_counts_by_system_split,
        "missing_splits": missing_splits,
        "excluded_data": excluded,
        "outputs": {
            "features": rel(out_dir / "pooled_descriptor_features.npy", project),
            "points": rel(out_dir / "X_2d.npy", project),
            "points_csv": rel(out_dir / "pca_points.csv", project),
            "labels": rel(out_dir / "labels.json", project),
            "summary": rel(out_dir / "summary.json", project),
            "figure": rel(fig_path, project) if figure_exists else None,
        },
        "interpretation_limits": [
            "Descriptor PCA is a dataset-distribution diagnostic, not an independent accuracy metric.",
            "A shared PCA plot is valid only for datasets compatible with the same model and type_map.",
            "Pooled descriptor statistics improve tractability but discard atom-resolved ordering information.",
        ],
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if status == "ready_for_review" or args.skip_plot else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
