"""Provision the bundled MatterGen source into NebulaMat's private env.

The desktop process exposes the resource and app-data paths through environment
variables. This helper is intentionally explicit: a model task may request it
with normal command approval, but the helper never touches a user Python or a
system-wide package directory.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


REVISION = "ac9ddd406171138c3f037d06b9b53fedbbb1c536"
PYTHON_VERSION = "3.10"


class SetupError(RuntimeError):
    """A recoverable application-environment setup error."""


def _required_path(name: str) -> Path:
    raw = os.environ.get(name, "").strip()
    if not raw:
        raise SetupError(f"{name} is not set; run this helper from the NebulaMat desktop runtime")
    return Path(raw).expanduser().resolve()


def _uv_path() -> Path:
    raw = os.environ.get("NEBULAMAT_UV_BIN", "").strip()
    if raw:
        candidate = Path(raw).expanduser()
        if candidate.is_file():
            return candidate
    found = shutil.which("uv")
    if found:
        return Path(found)
    raise SetupError("NebulaMat's bundled uv executable is unavailable")


def _python_path(venv: Path) -> Path:
    relative = Path("Scripts/python.exe") if os.name == "nt" else Path("bin/python")
    return venv / relative


def _run(command: list[str], *, env: dict[str, str], label: str) -> None:
    try:
        completed = subprocess.run(command, env=env, check=False)
    except OSError as error:
        raise SetupError(f"{label} could not start: {error}") from error
    if completed.returncode != 0:
        rendered = " ".join(command)
        raise SetupError(f"{label} failed with exit code {completed.returncode}: {rendered}")


def _copy_source(source: Path, destination: Path) -> None:
    if not (source / "pyproject.toml").is_file() or not (source / "mattergen").is_dir():
        raise SetupError(f"bundled MatterGen source is incomplete: {source}")
    marker = destination / ".nebulamat-mattergen-source"
    expected = f"{REVISION}\n"
    if destination.is_dir():
        try:
            if marker.read_text(encoding="utf-8").strip() == REVISION:
                return
        except OSError:
            pass
    if destination.exists():
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    marker.write_text(expected, encoding="utf-8")


def _status(home: Path, source: Path) -> dict[str, object]:
    venv = home / "venv"
    python = _python_path(venv)
    return {
        "revision": REVISION,
        "python_version": PYTHON_VERSION,
        "platform": platform.platform(),
        "source": str(source),
        "home": str(home),
        "python": str(python),
        "installed": python.is_file(),
    }


def _ready(python: Path) -> bool:
    if not python.is_file():
        return False
    probe = "import mattergen.scripts.generate, pymatgen, torch"
    try:
        completed = subprocess.run(
            [str(python), "-c", probe],
            env={**os.environ, "PYTHONNOUSERSITE": "1"},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return False
    return completed.returncode == 0


def setup() -> dict[str, object]:
    source = _required_path("NEBULAMAT_MATTERGEN_SOURCE")
    home = _required_path("NEBULAMAT_MATTERGEN_HOME")
    uv = _uv_path()
    home.mkdir(parents=True, exist_ok=True)
    source_copy = home / "source"
    venv = home / "venv"
    _copy_source(source, source_copy)
    python = _python_path(venv)
    if _ready(python):
        return _status(home, source)

    env = os.environ.copy()
    env["UV_CACHE_DIR"] = str(home / "uv-cache")
    _run(
        [str(uv), "venv", str(venv), "--python", PYTHON_VERSION, "--managed-python", "--allow-existing"],
        env=env,
        label="MatterGen Python environment creation",
    )
    _run(
        [str(uv), "pip", "install", "--python", str(python), str(source_copy)],
        env=env,
        label="MatterGen dependency installation",
    )
    result = _status(home, source)
    if not result["installed"]:
        raise SetupError(f"MatterGen Python was not created at {result['python']}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Set up the bundled MatterGen environment")
    parser.add_argument("--status", action="store_true", help="print status without installing")
    args = parser.parse_args()
    try:
        source = _required_path("NEBULAMAT_MATTERGEN_SOURCE")
        home = _required_path("NEBULAMAT_MATTERGEN_HOME")
        result = _status(home, source) if args.status else setup()
        print(json.dumps(result, indent=2))
        return 0
    except SetupError as error:
        print(f"MatterGen setup failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
