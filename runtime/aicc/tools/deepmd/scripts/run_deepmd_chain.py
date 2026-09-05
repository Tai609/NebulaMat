#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Run the fixed DeepMD train/freeze/test/postprocess/PCA chain.

The script is intentionally narrow: run it from a DeepMD-capable environment or
inside the project batch job after DFT labels have been converted and split into
DeepMD npy datasets.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DETAIL_SUFFIXES = (".e.out", ".e_peratom.out", ".f.out", ".v.out")
TEST_NAMES = {"test", "testing", "test_data"}


@dataclass(frozen=True)
class TestSystem:
    path: Path
    label: str


class StepFailure(RuntimeError):
    def __init__(self, name: str, returncode: int, log_path: Path):
        super().__init__(f"{name} failed with exit code {returncode}; see {log_path}")
        self.name = name
        self.returncode = returncode
        self.log_path = log_path


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def rel(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path)


def resolve_in_run(value: str | Path, run_dir: Path) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (run_dir / path).resolve()


def cmd_path(path: Path, cwd: Path) -> str:
    return rel(path, cwd) if path.is_absolute() else str(path)


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    return cleaned.strip("._") or "item"


def is_deepmd_npy_dir(path: Path) -> bool:
    return path.joinpath("set.000", "coord.npy").exists() and path.joinpath("type.raw").exists()


def infer_test_system(dataset_dir: Path, run_dir: Path) -> TestSystem | None:
    dataset_dir = dataset_dir.resolve()
    name = dataset_dir.name.lower()
    parent = dataset_dir.parent.name.lower()
    if name in TEST_NAMES:
        return TestSystem(path=dataset_dir, label=rel(dataset_dir, run_dir))
    if parent in TEST_NAMES:
        return TestSystem(path=dataset_dir, label=dataset_dir.name)
    return None


def discover_test_systems(data_roots: list[Path], explicit_systems: list[Path], run_dir: Path) -> list[TestSystem]:
    found: list[TestSystem] = []
    seen: set[Path] = set()

    def add(system: TestSystem) -> None:
        resolved = system.path.resolve()
        if resolved in seen:
            return
        if not is_deepmd_npy_dir(resolved):
            raise SystemExit(f"dp test system is not a deepmd/npy directory: {resolved}")
        found.append(TestSystem(path=resolved, label=system.label))
        seen.add(resolved)

    for path in explicit_systems:
        add(TestSystem(path=path, label=rel(path, run_dir)))

    if explicit_systems:
        return sorted(found, key=lambda item: item.label)

    for root in data_roots:
        root = root.resolve()
        candidates = [root] if is_deepmd_npy_dir(root) else []
        candidates.extend(p.parent.parent for p in root.rglob("set.000/coord.npy"))
        for candidate in candidates:
            system = infer_test_system(candidate, run_dir)
            if system is not None:
                add(system)
    return sorted(found, key=lambda item: item.label)


def command_record(
    name: str,
    cmd: list[str],
    cwd: Path,
    run_dir: Path,
    log_dir: Path,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    log_path = log_dir / f"{len(records) + 1:02d}_{safe_name(name)}.log"
    started = now_iso()
    start_time = time.monotonic()
    print(f"[DeepMD chain] {name}: {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
        check=False,
    )
    elapsed = time.monotonic() - start_time
    output = proc.stdout or ""
    log_path.write_text(output, encoding="utf-8", errors="replace")
    record = {
        "name": name,
        "status": "completed" if proc.returncode == 0 else "failed",
        "command": cmd,
        "cwd": rel(cwd, run_dir),
        "returncode": proc.returncode,
        "started_at": started,
        "ended_at": now_iso(),
        "elapsed_s": round(elapsed, 3),
        "stdout_log": rel(log_path, run_dir),
    }
    records.append(record)
    if proc.returncode != 0:
        raise StepFailure(name, proc.returncode, log_path)
    return record


def skipped_record(name: str, reason: str, records: list[dict[str, Any]]) -> None:
    print(f"[DeepMD chain] {name}: skipped ({reason})", flush=True)
    records.append(
        {
            "name": name,
            "status": "skipped",
            "reason": reason,
            "started_at": now_iso(),
            "ended_at": now_iso(),
        }
    )


def aggregate_detail_files(tmp_prefixes: list[tuple[str, Path, Path]], final_prefix: Path, run_dir: Path) -> list[str]:
    final_prefix.parent.mkdir(parents=True, exist_ok=True)
    created: list[str] = []
    for suffix in DETAIL_SUFFIXES:
        chunks: list[str] = []
        for label, system_path, prefix in tmp_prefixes:
            detail_path = Path(str(prefix) + suffix)
            if not detail_path.exists():
                continue
            lines = []
            for raw in detail_path.read_text(errors="ignore").splitlines():
                stripped = raw.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                lines.append(stripped)
            if not lines:
                continue
            chunks.append(f"# {label}: {rel(system_path, run_dir)}\n" + "\n".join(lines) + "\n")
        if not chunks:
            continue
        out_path = Path(str(final_prefix) + suffix)
        out_path.write_text("\n".join(chunks), encoding="utf-8")
        created.append(rel(out_path, run_dir))
    return created


def build_summary(args: argparse.Namespace, run_dir: Path, records: list[dict[str, Any]]) -> dict[str, Any]:
    model = resolve_in_run(args.model, run_dir)
    post_dir = resolve_in_run(args.postprocess_dir, run_dir)
    pca_dir = resolve_in_run(args.pca_dir, run_dir)
    return {
        "status": "running",
        "created_at": now_iso(),
        "run_dir": str(run_dir),
        "inputs": {
            "input_json": rel(resolve_in_run(args.input, run_dir), run_dir),
            "data_roots": [rel(resolve_in_run(path, run_dir), run_dir) for path in args.data_root],
            "test_systems": [rel(resolve_in_run(path, run_dir), run_dir) for path in args.test_system],
            "model": rel(model, run_dir),
        },
        "outputs": {
            "model": rel(model, run_dir),
            "detail_prefix": rel(resolve_in_run(args.detail_prefix, run_dir), run_dir),
            "postprocess_summary": rel(post_dir / "postprocess_summary.json", run_dir),
            "pca_summary": rel(pca_dir / "summary.json", run_dir),
            "qa_verdict": "analysis/deepmd_chain/logs/*_qa_check.log",
        },
        "commands": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", default=".", help="DeepMD run directory")
    parser.add_argument("--input", default="input.json", help="DeepMD input.json relative to run-dir")
    parser.add_argument("--data-root", action="append", help="Root containing train/val/test datasets")
    parser.add_argument("--test-system", action="append", default=[], help="Explicit deepmd/npy test system for dp test")
    parser.add_argument("--model", default="graph.pb", help="Frozen model path relative to run-dir")
    parser.add_argument("--detail-prefix", default="detail_file", help="Aggregated dp test detail prefix")
    parser.add_argument("--lcurve", default="lcurve.out")
    parser.add_argument("--fig-dir", default="figures")
    parser.add_argument("--postprocess-dir", default="analysis/deepmd_postprocess")
    parser.add_argument("--pca-dir", default="analysis/deepmd_descriptor_pca_dft_all")
    parser.add_argument("--pca-figure", default="figures/deepmd_descriptor_pca_dft_all.png")
    parser.add_argument("--chain-dir", default="analysis/deepmd_chain")
    parser.add_argument("--dp-bin", default="dp")
    parser.add_argument("--python", default=sys.executable, help="Default Python for helper scripts")
    parser.add_argument("--plot-python", help="Python for plot_deepmd_postprocess.py")
    parser.add_argument("--pca-python", help="Python for descriptor extraction/PCA")
    parser.add_argument("--pca-plot-python", help="Optional plotting Python when DeepMD Python lacks matplotlib")
    parser.add_argument("--check-python", help="Python for check_deepmd_qa.py")
    parser.add_argument("--n-test-frames", default="0", help="dp test -n value; 0 means all frames")
    parser.add_argument("--max-frames-per-split", type=int, default=0, help="PCA sampling limit; 0 means all frames")
    parser.add_argument("--batch-size", type=int, default=16, help="PCA descriptor eval batch size")
    parser.add_argument("--skip-train", action="store_true")
    parser.add_argument("--skip-freeze", action="store_true")
    parser.add_argument("--skip-test", action="store_true")
    parser.add_argument("--skip-postprocess", action="store_true")
    parser.add_argument("--skip-pca", action="store_true")
    parser.add_argument("--skip-check", action="store_true")
    parser.add_argument("--overwrite-model", action="store_true", help="Allow dp freeze to overwrite --model")
    args = parser.parse_args()
    if args.data_root is None:
        args.data_root = ["data"]

    run_dir = Path(args.run_dir).resolve()
    if not run_dir.exists():
        raise SystemExit(f"run directory does not exist: {run_dir}")

    script_dir = Path(__file__).resolve().parent
    chain_dir = resolve_in_run(args.chain_dir, run_dir)
    log_dir = chain_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    summary_path = chain_dir / "deepmd_chain_summary.json"
    records: list[dict[str, Any]] = []
    summary = build_summary(args, run_dir, records)

    plot_python = args.plot_python or args.python
    pca_python = args.pca_python or args.python
    pca_plot_python = args.pca_plot_python
    check_python = args.check_python or args.python
    model = resolve_in_run(args.model, run_dir)
    input_json = resolve_in_run(args.input, run_dir)
    data_roots = [resolve_in_run(path, run_dir) for path in args.data_root]
    test_systems = [resolve_in_run(path, run_dir) for path in args.test_system]
    detail_prefix = resolve_in_run(args.detail_prefix, run_dir)
    post_dir = resolve_in_run(args.postprocess_dir, run_dir)
    pca_dir = resolve_in_run(args.pca_dir, run_dir)
    pca_figure = resolve_in_run(args.pca_figure, run_dir)

    exit_code = 0
    try:
        if args.skip_train:
            skipped_record("dp_train", "--skip-train", records)
        else:
            if not input_json.exists():
                raise SystemExit(f"missing input.json: {input_json}")
            command_record("dp_train", [args.dp_bin, "train", cmd_path(input_json, run_dir)], run_dir, run_dir, log_dir, records)

        if args.skip_freeze:
            skipped_record("dp_freeze", "--skip-freeze", records)
        elif model.exists() and not args.overwrite_model:
            skipped_record("dp_freeze", f"{rel(model, run_dir)} already exists; pass --overwrite-model to replace it", records)
        else:
            command_record("dp_freeze", [args.dp_bin, "freeze", "-o", cmd_path(model, run_dir)], run_dir, run_dir, log_dir, records)

        if not model.exists():
            raise SystemExit(f"frozen model is missing before dp test/PCA: {model}")

        if args.skip_test:
            skipped_record("dp_test", "--skip-test", records)
        else:
            systems = discover_test_systems(data_roots, test_systems, run_dir)
            if not systems:
                roots = ", ".join(rel(path, run_dir) for path in data_roots)
                raise SystemExit(f"no DeepMD test systems found under: {roots}")
            tmp_prefixes: list[tuple[str, Path, Path]] = []
            tmp_dir = chain_dir / "dp_test_details"
            for i, system in enumerate(systems, start=1):
                prefix = tmp_dir / f"{i:03d}_{safe_name(system.label)}" / "detail"
                prefix.parent.mkdir(parents=True, exist_ok=True)
                command_record(
                    f"dp_test_{safe_name(system.label)}",
                    [
                        args.dp_bin,
                        "test",
                        "-m",
                        cmd_path(model, run_dir),
                        "-s",
                        cmd_path(system.path, run_dir),
                        "-n",
                        str(args.n_test_frames),
                        "-d",
                        cmd_path(prefix, run_dir),
                    ],
                    run_dir,
                    run_dir,
                    log_dir,
                    records,
                )
                tmp_prefixes.append((system.label, system.path, prefix))
            detail_files = aggregate_detail_files(tmp_prefixes, detail_prefix, run_dir)
            summary["outputs"]["detail_files"] = detail_files

        if args.skip_postprocess:
            skipped_record("postprocess_plots", "--skip-postprocess", records)
        else:
            command_record(
                "postprocess_plots",
                [
                    plot_python,
                    str(script_dir / "plot_deepmd_postprocess.py"),
                    "--work-dir",
                    ".",
                    "--lcurve",
                    args.lcurve,
                    "--detail-prefix",
                    cmd_path(detail_prefix, run_dir),
                    "--fig-dir",
                    cmd_path(resolve_in_run(args.fig_dir, run_dir), run_dir),
                    "--out-dir",
                    cmd_path(post_dir, run_dir),
                ],
                run_dir,
                run_dir,
                log_dir,
                records,
            )

        if args.skip_pca:
            skipped_record("descriptor_pca", "--skip-pca", records)
        else:
            pca_cmd = [
                pca_python,
                str(script_dir / "deepmd_descriptor_pca.py"),
                "--model",
                cmd_path(model, run_dir),
                "--out-dir",
                cmd_path(pca_dir, run_dir),
                "--figure",
                cmd_path(pca_figure, run_dir),
                "--max-frames-per-split",
                str(args.max_frames_per_split),
                "--batch-size",
                str(args.batch_size),
            ]
            for root in data_roots:
                pca_cmd.extend(["--data-root", cmd_path(root, run_dir)])
            if pca_plot_python:
                command_record("descriptor_pca_extract", pca_cmd + ["--skip-plot"], run_dir, run_dir, log_dir, records)
                command_record(
                    "descriptor_pca_plot",
                    [
                        pca_plot_python,
                        str(script_dir / "deepmd_descriptor_pca.py"),
                        "--out-dir",
                        cmd_path(pca_dir, run_dir),
                        "--figure",
                        cmd_path(pca_figure, run_dir),
                        "--skip-extract",
                        "--skip-pca",
                    ],
                    run_dir,
                    run_dir,
                    log_dir,
                    records,
                )
            else:
                command_record("descriptor_pca", pca_cmd, run_dir, run_dir, log_dir, records)

        if args.skip_check:
            skipped_record("qa_check", "--skip-check", records)
        else:
            command_record(
                "qa_check",
                [
                    check_python,
                    str(script_dir / "check_deepmd_qa.py"),
                    "--project-root",
                    ".",
                    "--model",
                    cmd_path(model, run_dir),
                    "--postprocess-summary",
                    cmd_path(post_dir / "postprocess_summary.json", run_dir),
                    "--pca-summary",
                    cmd_path(pca_dir / "summary.json", run_dir),
                    "--json",
                ],
                run_dir,
                run_dir,
                log_dir,
                records,
            )

        summary["status"] = "pass"
    except StepFailure as exc:
        summary["status"] = "failed"
        summary["error"] = str(exc)
        exit_code = exc.returncode or 1
    except SystemExit as exc:
        summary["status"] = "failed"
        summary["error"] = str(exc)
        exit_code = int(exc.code) if isinstance(exc.code, int) and exc.code else 1
    except Exception as exc:
        summary["status"] = "failed"
        summary["error"] = f"{type(exc).__name__}: {exc}"
        exit_code = 1
    finally:
        summary["finished_at"] = now_iso()
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"[DeepMD chain] summary: {summary_path}", flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
