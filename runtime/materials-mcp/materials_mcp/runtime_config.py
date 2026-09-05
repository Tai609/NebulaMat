"""Machine-readable materials runtime configuration and a cheap preflight.

The checked-in JSON contains portable defaults. This module resolves those
defaults on the current machine and reports discovery separately from actual
Python-package readiness, so a model file is never mistaken for a usable
runtime.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CONFIG_RELATIVE = Path("materials") / "runtime.json"
STATUS_RELATIVE = Path(".openscience") / "materials-runtime.status.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_runtime_config(workspace_root: str | Path | None = None) -> tuple[Path, dict[str, Any]]:
    root = Path(workspace_root or Path.cwd()).resolve()
    path = root / CONFIG_RELATIVE
    if not path.is_file():
        return path, {"schema_version": 1, "tools": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid materials runtime config {path}: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("tools", {}), dict):
        raise ValueError(f"materials runtime config must contain an object at tools: {path}")
    return path, payload


def _expand_path(value: Any, root: Path) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    expanded = os.path.expandvars(value.strip()).replace("%APPDATA%", os.getenv("APPDATA", "%APPDATA%"))
    candidate = Path(expanded).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    return candidate.resolve()


def _active_runtime(path: Path) -> bool:
    try:
        return path == Path(sys.executable).resolve()
    except OSError:
        return False


def _runtime_probe(path: Path | None, modules: list[str]) -> dict[str, Any]:
    if path is None:
        return {"status": "missing", "reason": "no runtime path configured", "modules": {}}
    if not path.is_file():
        return {"status": "missing", "path": str(path), "reason": "python executable not found", "modules": {}}
    if not _active_runtime(path):
        return {
            "status": "discovered",
            "path": str(path),
            "reason": "runtime exists but is not the active MCP interpreter; package probe skipped",
            "modules": {name: "not_probed" for name in modules},
        }
    found = {name: bool(importlib.util.find_spec(name)) for name in modules}
    missing = [name for name, present in found.items() if not present]
    return {
        "status": "ready" if not missing else "missing",
        "path": str(path),
        "modules": found,
        **({"missing_modules": missing} if missing else {}),
    }


def _wsl_runtime_probe(raw_path: str, modules: list[str]) -> dict[str, Any]:
    """Probe a configured WSL interpreter without treating it as a Windows path."""
    module_json = json.dumps(modules, ensure_ascii=True)
    probe = (
        "import importlib.util,json; "
        f"print(json.dumps({{name: bool(importlib.util.find_spec(name)) for name in {module_json}}}))"
    )
    try:
        completed = subprocess.run(
            ["wsl.exe", "--exec", raw_path, "-c", probe],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {
            "status": "configured",
            "path": raw_path,
            "reason": f"WSL runtime probe unavailable: {exc}",
            "modules": {name: "not_probed" for name in modules},
        }
    if completed.returncode != 0:
        return {
            "status": "configured",
            "path": raw_path,
            "reason": "WSL runtime probe failed",
            "modules": {name: "not_probed" for name in modules},
        }
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    try:
        payload = json.loads(lines[-1])
        found = {name: bool(payload.get(name, False)) for name in modules}
    except (IndexError, json.JSONDecodeError, AttributeError):
        return {
            "status": "configured",
            "path": raw_path,
            "reason": "WSL runtime probe returned invalid module JSON",
            "modules": {name: "not_probed" for name in modules},
        }
    missing = [name for name, present in found.items() if not present]
    return {
        "status": "ready" if not missing else "missing",
        "path": raw_path,
        "platform": "wsl2",
        "modules": found,
        **({"missing_modules": missing} if missing else {}),
    }


def _configured_runtime_probe(raw_path: Any, root: Path, modules: list[str]) -> dict[str, Any]:
    # A POSIX path in the checked-in config denotes a WSL interpreter when the
    # MCP itself is running on Windows. Keep it as configured evidence instead
    # of coercing it into a misleading `C:\\root\\...` Windows path.
    if os.name == "nt" and isinstance(raw_path, str) and raw_path.startswith("/"):
        return _wsl_runtime_probe(raw_path, modules)
    return _runtime_probe(_expand_path(raw_path, root), modules)


def _checkpoint_probe(root: Path, tool: dict[str, Any]) -> dict[str, Any] | None:
    raw = tool.get("checkpoint")
    if not isinstance(raw, str) or not raw.strip():
        return None
    path = _expand_path(raw, root)
    expected = str(tool.get("sha256") or "").lower().strip()
    if path is None or not path.is_file():
        return {"status": "missing", "path": str(path) if path else raw, "expected_sha256": expected}
    actual = _sha256(path)
    return {
        "status": "ready" if not expected or actual == expected else "missing",
        "path": str(path),
        "expected_sha256": expected,
        "actual_sha256": actual,
        **({"reason": "sha256 mismatch"} if expected and actual != expected else {}),
    }


def probe_runtime_status(workspace_root: str | Path | None = None) -> dict[str, Any]:
    root = Path(workspace_root or Path.cwd()).resolve()
    config_path, config = load_runtime_config(root)
    tools: dict[str, Any] = {}
    for name, raw in config.get("tools", {}).items():
        if not isinstance(raw, dict):
            tools[str(name)] = {"status": "missing", "reason": "tool entry is not an object"}
            continue
        runtime = raw.get("runtime") if isinstance(raw.get("runtime"), dict) else {}
        modules = [str(item) for item in raw.get("required_modules", []) if str(item).strip()]
        runtimes = {
            key: _configured_runtime_probe(value, root, modules)
            for key, value in runtime.items()
        }
        checkpoint = _checkpoint_probe(root, raw)
        ready_runtime = any(item.get("status") == "ready" for item in runtimes.values())
        discovered_runtime = any(item.get("status") in {"ready", "discovered", "configured"} for item in runtimes.values())
        status = "ready" if ready_runtime else ("discovered" if discovered_runtime else "missing")
        if checkpoint is not None:
            status = "ready" if status == "ready" and checkpoint["status"] == "ready" else (
                "discovered" if status != "missing" and checkpoint["status"] == "ready" else "missing"
            )
        if name == "uma" and status == "ready":
            # UMA weights are gated and loaded lazily from Hugging Face; a
            # package probe cannot establish that the requested checkpoint is
            # available, so keep this state honest until a real load succeeds.
            status = "discovered"
        tools[str(name)] = {
            "status": status,
            "configured": True,
            "model": raw.get("model"),
            "task": raw.get("task"),
            "runtimes": runtimes,
            **({"checkpoint": checkpoint} if checkpoint is not None else {}),
            **({"weights": {"status": "not_probed", "source": raw.get("weight_source")}} if name == "uma" else {}),
        }
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "workspace": str(root),
        "config_path": str(config_path),
        "active_python": str(Path(sys.executable).resolve()),
        "tools": tools,
    }


def write_runtime_status(workspace_root: str | Path | None = None) -> dict[str, Any]:
    root = Path(workspace_root or Path.cwd()).resolve()
    status = probe_runtime_status(root)
    target = root / STATUS_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(status, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    temporary.replace(target)
    status["status_path"] = str(target)
    return status
