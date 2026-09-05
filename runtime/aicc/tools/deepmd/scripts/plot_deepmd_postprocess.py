#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["matplotlib", "numpy"]
# ///
"""Plot DeePMD learning-curve and dp-test parity diagnostics.

Run after `dp test -d <detail_prefix>` from the DeepMD run directory.
The script writes figures plus a JSON summary that can be checked before
LAMMPS DPMD handoff or report assembly.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


LCURVE_KEYS = [
    "step",
    "rmse_val",
    "rmse_trn",
    "rmse_e_val",
    "rmse_e_trn",
    "rmse_f_val",
    "rmse_f_trn",
    "lr",
]


def rel(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path)


def read_lcurve(path: Path) -> dict[str, np.ndarray]:
    rows: list[list[float]] = []
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            rows.append([float(x) for x in line.split()])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"no numeric lcurve rows parsed from {path}")
    arr = np.asarray(rows, dtype=float)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    return {key: arr[:, i] for i, key in enumerate(LCURVE_KEYS[: arr.shape[1]])}


def read_grouped_pairs(path: Path, ncols: int) -> list[dict[str, object]]:
    groups: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for raw in path.read_text(errors="ignore").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            label = line[1:].strip() or path.stem
            current = {"label": label.split(":", 1)[0].strip(), "rows": []}
            groups.append(current)
            continue
        try:
            vals = [float(x) for x in line.split()]
        except ValueError:
            continue
        if len(vals) < ncols:
            continue
        if current is None:
            current = {"label": path.stem, "rows": []}
            groups.append(current)
        current["rows"].append(vals[:ncols])  # type: ignore[index]
    parsed = []
    for group in groups:
        arr = np.asarray(group["rows"], dtype=float)
        if arr.size:
            parsed.append({"label": str(group["label"]), "array": arr})
    return parsed


def rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def mae(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a - b)))


def axis_limits(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    lo = float(min(np.min(x), np.min(y)))
    hi = float(max(np.max(x), np.max(y)))
    pad = 0.04 * (hi - lo if hi > lo else 1.0)
    return lo - pad, hi + pad


def short_label(label: str) -> str:
    parts = [p for p in label.replace("\\", "/").split("/") if p]
    if len(parts) >= 2 and parts[-1] in {"train", "val", "valid", "validation", "test"}:
        return f"{parts[-2]}/{parts[-1]}"
    return parts[-1] if parts else label


def positive(values: np.ndarray) -> np.ndarray:
    return values[values > 0]


def plot_lcurve(lcurve: dict[str, np.ndarray], fig_dir: Path, root: Path) -> str:
    fig, axes = plt.subplots(1, 3, figsize=(13.2, 3.8))
    step = lcurve.get("step", np.arange(len(next(iter(lcurve.values())))))

    if {"rmse_e_trn", "rmse_e_val"}.issubset(lcurve):
        axes[0].plot(step, lcurve["rmse_e_trn"] * 1000, label="train", color="#4b78a8")
        axes[0].plot(step, lcurve["rmse_e_val"] * 1000, label="validation", color="#b25555")
        axes[0].set_ylabel("Energy RMSE (meV/atom)")
    else:
        if "rmse_trn" in lcurve:
            axes[0].plot(step, lcurve["rmse_trn"], label="train", color="#4b78a8")
        if "rmse_val" in lcurve:
            axes[0].plot(step, lcurve["rmse_val"], label="validation", color="#b25555")
        axes[0].set_ylabel("Total RMSE")
    if positive(np.concatenate([line.get_ydata() for line in axes[0].lines])).size:
        axes[0].set_yscale("log")
    axes[0].set_xlabel("Training step")
    axes[0].grid(alpha=0.25)
    axes[0].legend(frameon=False)

    if {"rmse_f_trn", "rmse_f_val"}.issubset(lcurve):
        axes[1].plot(step, lcurve["rmse_f_trn"], label="train", color="#4b78a8")
        axes[1].plot(step, lcurve["rmse_f_val"], label="validation", color="#b25555")
        axes[1].set_ylabel("Force RMSE (eV/A)")
        axes[1].set_yscale("log")
    axes[1].set_xlabel("Training step")
    axes[1].grid(alpha=0.25)

    if "lr" in lcurve:
        axes[2].plot(step, lcurve["lr"], color="#5f8f69")
        axes[2].set_yscale("log")
    axes[2].set_ylabel("Learning rate")
    axes[2].set_xlabel("Training step")
    axes[2].grid(alpha=0.25)

    fig.suptitle("DeePMD learning curve")
    fig.tight_layout()
    path = fig_dir / "deepmd_lcurve_energy_force_lr.png"
    fig.savefig(path, dpi=260)
    plt.close(fig)
    return rel(path, root)


def plot_energy(groups: list[dict[str, object]], fig_dir: Path, root: Path, per_atom: bool) -> tuple[str, list[dict[str, object]]]:
    fig, ax = plt.subplots(figsize=(5.4, 5.0))
    stats: list[dict[str, object]] = []
    all_ref, all_pred = [], []
    for group in groups:
        arr = group["array"]  # type: ignore[assignment]
        ref = arr[:, 0]
        pred = arr[:, 1]
        all_ref.append(ref)
        all_pred.append(pred)
        ax.scatter(ref, pred, s=11, alpha=0.65, label=short_label(str(group["label"])))
        key = "energy_per_atom" if per_atom else "energy"
        stats.append(
            {
                "system": str(group["label"]),
                "n_frames": int(len(ref)),
                f"{key}_rmse_eV": rmse(ref, pred),
                f"{key}_mae_eV": mae(ref, pred),
                f"{key}_bias_eV": float(np.mean(pred - ref)),
            }
        )
    ref_all = np.concatenate(all_ref)
    pred_all = np.concatenate(all_pred)
    lo, hi = axis_limits(ref_all, pred_all)
    ax.plot([lo, hi], [lo, hi], color="black", lw=1, alpha=0.75)
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_xlabel("DFT energy (eV/atom)" if per_atom else "DFT energy (eV)")
    ax.set_ylabel("DP energy (eV/atom)" if per_atom else "DP energy (eV)")
    ax.set_title("Held-out energy parity")
    ax.grid(alpha=0.25)
    ax.legend(frameon=False, fontsize=7)
    fig.tight_layout()
    path = fig_dir / "deepmd_dp_test_energy_parity.png"
    fig.savefig(path, dpi=260)
    plt.close(fig)
    key = "energy_per_atom" if per_atom else "energy"
    stats.append(
        {
            "system": "weighted_all",
            "n_frames": int(len(ref_all)),
            f"{key}_rmse_eV": rmse(ref_all, pred_all),
            f"{key}_mae_eV": mae(ref_all, pred_all),
            f"{key}_bias_eV": float(np.mean(pred_all - ref_all)),
        }
    )
    return rel(path, root), stats


def plot_force(groups: list[dict[str, object]], fig_dir: Path, root: Path) -> tuple[str, str, list[dict[str, object]]]:
    fig, ax = plt.subplots(figsize=(5.4, 5.0))
    fig_h, ax_h = plt.subplots(figsize=(6.2, 3.8))
    stats: list[dict[str, object]] = []
    all_ref, all_pred, all_resid = [], [], []
    for group in groups:
        arr = group["array"]  # type: ignore[assignment]
        ref = arr[:, :3].reshape(-1)
        pred = arr[:, 3:6].reshape(-1)
        resid = pred - ref
        all_ref.append(ref)
        all_pred.append(pred)
        all_resid.append(resid)
        sample = np.linspace(0, len(ref) - 1, min(len(ref), 12000), dtype=int)
        label = short_label(str(group["label"]))
        ax.scatter(ref[sample], pred[sample], s=2, alpha=0.15, label=label)
        ax_h.hist(resid, bins=90, alpha=0.42, density=True, label=label)
        stats.append(
            {
                "system": str(group["label"]),
                "n_force_components": int(len(ref)),
                "force_rmse_eV_per_A": rmse(ref, pred),
                "force_mae_eV_per_A": mae(ref, pred),
                "force_bias_eV_per_A": float(np.mean(resid)),
            }
        )
    ref_all = np.concatenate(all_ref)
    pred_all = np.concatenate(all_pred)
    resid_all = np.concatenate(all_resid)
    lo, hi = axis_limits(ref_all, pred_all)
    ax.plot([lo, hi], [lo, hi], color="black", lw=1, alpha=0.75)
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_xlabel("DFT force component (eV/A)")
    ax.set_ylabel("DP force component (eV/A)")
    ax.set_title("Held-out force parity")
    ax.grid(alpha=0.25)
    ax.legend(frameon=False, fontsize=7)
    fig.tight_layout()
    parity_path = fig_dir / "deepmd_dp_test_force_parity.png"
    fig.savefig(parity_path, dpi=260)
    plt.close(fig)

    ax_h.axvline(0, color="black", lw=1, alpha=0.75)
    ax_h.set_xlabel("DP - DFT force component residual (eV/A)")
    ax_h.set_ylabel("Density")
    ax_h.set_title("Held-out force residual distribution")
    ax_h.grid(alpha=0.25)
    ax_h.legend(frameon=False, fontsize=7)
    fig_h.tight_layout()
    hist_path = fig_dir / "deepmd_dp_test_force_residual_hist.png"
    fig_h.savefig(hist_path, dpi=260)
    plt.close(fig_h)

    stats.append(
        {
            "system": "weighted_all",
            "n_force_components": int(len(ref_all)),
            "force_rmse_eV_per_A": rmse(ref_all, pred_all),
            "force_mae_eV_per_A": mae(ref_all, pred_all),
            "force_bias_eV_per_A": float(np.mean(resid_all)),
        }
    )
    return rel(parity_path, root), rel(hist_path, root), stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", default=".", help="DeepMD run directory")
    parser.add_argument("--lcurve", default="lcurve.out")
    parser.add_argument("--detail-prefix", default="detail_file")
    parser.add_argument("--fig-dir", default="figures")
    parser.add_argument("--out-dir", default="analysis/deepmd_postprocess")
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()

    project = Path.cwd().resolve()
    run_dir = Path(args.work_dir).resolve()
    fig_dir = Path(args.fig_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    fig_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    figures: list[str] = []
    summary: dict[str, object] = {"status": "incomplete", "figures": figures, "notes": []}
    missing: list[str] = []

    lcurve_path = run_dir / args.lcurve
    if lcurve_path.exists():
        lcurve = read_lcurve(lcurve_path)
        figures.append(plot_lcurve(lcurve, fig_dir, project))
        summary["lcurve_final"] = {key: float(values[-1]) for key, values in lcurve.items()}
        summary["lcurve_path"] = rel(lcurve_path, project)
    else:
        missing.append(rel(lcurve_path, project))

    detail_arg = Path(args.detail_prefix)
    prefix = detail_arg if detail_arg.is_absolute() else run_dir / detail_arg
    energy_path = Path(str(prefix) + ".e_peratom.out")
    per_atom = True
    if not energy_path.exists():
        energy_path = Path(str(prefix) + ".e.out")
        per_atom = False
    if energy_path.exists():
        energy_groups = read_grouped_pairs(energy_path, 2)
        if energy_groups:
            energy_fig, energy_stats = plot_energy(energy_groups, fig_dir, project, per_atom)
            figures.append(energy_fig)
            summary["energy_parity"] = energy_stats
            summary["energy_detail_path"] = rel(energy_path, project)
        else:
            missing.append(f"{rel(energy_path, project)} numeric rows")
    else:
        missing.append(f"{args.detail_prefix}.e_peratom.out or {args.detail_prefix}.e.out")

    force_path = Path(str(prefix) + ".f.out")
    if force_path.exists():
        force_groups = read_grouped_pairs(force_path, 6)
        if force_groups:
            force_fig, force_hist, force_stats = plot_force(force_groups, fig_dir, project)
            figures.extend([force_fig, force_hist])
            summary["force_parity"] = force_stats
            summary["force_detail_path"] = rel(force_path, project)
        else:
            missing.append(f"{rel(force_path, project)} numeric rows")
    else:
        missing.append(f"{args.detail_prefix}.f.out")

    summary["missing"] = missing
    if not missing:
        summary["status"] = "ready_for_review"
    summary["notes"] = [
        "Learning-curve diagnostics are not a substitute for held-out dp test.",
        "Parity plots use dp test detail files and should be inspected for systematic bias by source.",
    ]
    summary_path = out_dir / "postprocess_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if (not missing or args.allow_missing) else 1


if __name__ == "__main__":
    sys.exit(main())
