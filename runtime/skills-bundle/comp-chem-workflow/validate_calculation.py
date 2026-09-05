#!/usr/bin/env python3
"""Run a deployed AICC preflight/parser and emit NebulaMat validation JSON.

Exit codes: 0 passed, 1 review required, 2 failed or adapter unavailable.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

AICC_COMMIT = "c416a8ae8999aaba5faf0230ec052cd54a5ca0bb"

ADAPTERS: dict[tuple[str, str], dict[str, Any]] = {
    ("vasp", "preflight"): {"script": "check_inputs.py", "target": "directory", "review_codes": []},
    ("vasp", "result"): {"script": "parse_vasp.py", "target": "directory", "required": "OUTCAR", "review_codes": [1]},
    ("cp2k", "preflight"): {"script": "check_inputs.py", "target": "directory", "review_codes": []},
    ("cp2k", "result"): {"script": "parse_cp2k.py", "target": "one:*.out", "review_codes": [1]},
    ("gaussian", "result"): {"script": "parse_gaussian.py", "target": "one:*.log", "review_codes": [1]},
    ("gromacs", "preflight"): {"script": "check_gromacs_inputs.py", "target": "gromacs-inputs", "review_codes": [1]},
    ("gromacs", "result"): {"script": "parse_gromacs_log.py", "target": "preferred:md.log:*.log", "review_codes": [1], "extra_args": ["--json"]},
    ("lammps", "result"): {"script": "parse_lammps.py", "target": "preferred:log.lammps:log.*", "review_codes": [1]},
    ("deepmd", "result"): {
        "script": "check_deepmd_qa.py",
        "target": "deepmd-root",
        "review_codes": [],
        "required": [
            "analysis/deepmd_postprocess/postprocess_summary.json",
            "analysis/deepmd_descriptor_pca_dft_all/summary.json",
        ],
    },
    ("vaspkit", "preflight"): {"script": "check_vaspkit.py", "target": "directory", "review_codes": []},
}


def _one(run_dir: Path, pattern: str) -> Path:
    matches = sorted(path for path in run_dir.glob(pattern) if path.is_file())
    if len(matches) != 1:
        raise ValueError(f"expected exactly one {pattern} in {run_dir}, found {len(matches)}")
    return matches[0]


def _preferred(run_dir: Path, name: str, pattern: str) -> Path:
    preferred = run_dir / name
    return preferred if preferred.is_file() else _one(run_dir, pattern)


def _command_args(engine: str, phase: str, run_dir: Path, target: str, strict: bool) -> tuple[list[str], Path | None]:
    if target == "directory":
        args = [str(run_dir)]
        if strict and engine == "vasp" and phase == "preflight":
            args.insert(0, "--strict-performance")
        return args, run_dir / "OUTCAR" if phase == "result" and engine == "vasp" else None
    if target.startswith("one:"):
        evidence = _one(run_dir, target.split(":", 1)[1])
        return [str(evidence)], evidence
    if target.startswith("preferred:"):
        _, name, pattern = target.split(":", 2)
        evidence = _preferred(run_dir, name, pattern)
        return [str(evidence)], evidence
    if target == "gromacs-inputs":
        mdp = _one(run_dir, "*.mdp")
        gro = _one(run_dir, "*.gro")
        top = _preferred(run_dir, "topol.top", "*.top")
        return ["--mdp", str(mdp), "--gro", str(gro), "--top", str(top), "--json"], mdp
    if target == "deepmd-root":
        return ["--project-root", str(run_dir), "--json"], run_dir
    raise ValueError(f"unsupported adapter target {target}")


def _helper_json(stdout: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(stdout)
    except (json.JSONDecodeError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def _normal_termination(
    engine: str,
    raw_code: int,
    review_codes: list[int],
    stdout: str,
) -> bool | None:
    if engine == "deepmd":
        # The DeePMD helper audits a post-processing evidence package; it does
        # not inspect the training process or scheduler termination record.
        return None
    if raw_code not in {0, *review_codes}:
        return False
    if engine == "gromacs":
        payload = _helper_json(stdout)
        completed = payload.get("completed") if payload else None
        return completed if isinstance(completed, bool) else False
    if engine == "lammps":
        return "[INTERRUPTED]" not in stdout
    return True


def validate_calculation(
    phase: str,
    engine: str,
    run_dir: Path,
    *,
    skills_root: Path,
    strict: bool = False,
) -> tuple[dict[str, Any], int]:
    engine = engine.lower()
    spec = ADAPTERS.get((engine, phase))
    base: dict[str, Any] = {
        "schema_version": 1,
        "source": {"collection": "AICC", "commit": AICC_COMMIT, "engine_skill": engine},
        "phase": phase,
        "engine": engine,
        "run_dir": str(run_dir.resolve()),
        "scientific_validation": "pending_reviewer",
    }
    if phase == "preflight":
        base.update({"preflight_passed": False, "waiver_required": False})
    else:
        base["validation_rungs"] = {
            "files_exist": False,
            "normal_termination": None if engine == "deepmd" else False,
            "technically_converged": False,
            "scientifically_valid": None,
        }
    if spec is None:
        base.update({"status": "failed", "error": f"no {phase} adapter for {engine}"})
        return base, 2
    if not run_dir.is_dir():
        base.update({"status": "failed", "error": f"run directory does not exist: {run_dir}"})
        return base, 2

    script = skills_root / engine / "scripts" / spec["script"]
    if not script.is_file():
        base.update({"status": "failed", "error": f"AICC helper is missing: {script}"})
        return base, 2
    try:
        checker_args, evidence_file = _command_args(engine, phase, run_dir, spec["target"], strict)
    except ValueError as exc:
        base.update({"status": "failed", "error": str(exc)})
        return base, 2

    command = [sys.executable, str(script), *checker_args, *spec.get("extra_args", [])]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    raw_code = completed.returncode
    if raw_code == 0:
        status, exit_code = "passed", 0
    elif raw_code in spec["review_codes"]:
        status, exit_code = "review", 1
    else:
        status, exit_code = "failed", 2

    base.update(
        {
            "status": status,
            "helper": str(script),
            "command": command,
            "helper_exit_code": raw_code,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
        }
    )
    if phase == "preflight":
        base["preflight_passed"] = status in {"passed", "review"}
        base["waiver_required"] = status == "review"
    else:
        required = spec.get("required", [])
        if isinstance(required, str):
            required = [required]
        files_exist = (
            all((run_dir / relative).is_file() for relative in required)
            if required
            else evidence_file.exists() if evidence_file is not None else run_dir.exists()
        )
        base["validation_rungs"] = {
            "files_exist": files_exist,
            "normal_termination": _normal_termination(
                engine, raw_code, spec["review_codes"], completed.stdout
            ),
            "technically_converged": raw_code == 0,
            "scientifically_valid": None,
        }
    return base, exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["preflight", "result"])
    parser.add_argument("--engine", required=True, choices=sorted({key[0] for key in ADAPTERS}))
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--skills-root", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    configured_root = os.environ.get("NEBULAMAT_SKILLS_ROOT")
    if args.skills_root is not None:
        skills_root = args.skills_root
    elif configured_root:
        skills_root = Path(configured_root)
    else:
        skills_root = Path(__file__).resolve().parents[1]
    verdict, exit_code = validate_calculation(
        args.phase,
        args.engine,
        args.run_dir,
        skills_root=skills_root,
        strict=args.strict,
    )
    rendered = json.dumps(verdict, indent=2, sort_keys=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
