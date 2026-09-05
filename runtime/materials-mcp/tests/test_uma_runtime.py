import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from materials_mcp.uma_runtime import _run_wsl_surface_md, _windows_path


class UMARuntimeBridgeTests(unittest.TestCase):
    def test_wsl_paths_are_returned_as_windows_workspace_paths(self):
        self.assertEqual(_windows_path("/mnt/c/work/run/md-manifest.json"), r"C:\work\run\md-manifest.json")
        self.assertEqual(_windows_path("/root/run.json"), "/root/run.json")

    def test_wsl_bridge_uses_configured_interpreter_and_complete_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            weights = root / "runtime" / "uma" / "models" / "uma.pt"
            weights.parent.mkdir(parents=True)
            weights.write_bytes(b"weights")
            config = root / "materials" / "runtime.json"
            config.parent.mkdir()
            config.write_text(
                json.dumps(
                    {
                        "tools": {
                            "uma": {
                                "runtime": {"wsl_python": "/root/fairchem/venv/bin/python"},
                                "weights": "runtime/uma/models/uma.pt",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            completed = SimpleNamespace(
                returncode=0,
                stdout=json.dumps(
                    {
                        "status": "completed",
                        "manifest": "/mnt/c/work/md/md-manifest.json",
                        "output_dir": "/mnt/c/work/md",
                        "input": {
                            "path": "/mnt/c/work/adsorbed.extxyz",
                            "standardization_manifest": "/mnt/c/work/standardization-manifest.json",
                        },
                        "artifacts": [],
                    }
                ),
                stderr="",
            )
            parameters = {
                "model_name": "uma-s-1p2p1",
                "task_name": "oc25",
                "device": "cuda",
                "supercell": [2, 2, 1],
                "ensemble": "nvt",
                "temperature_k": 300.0,
                "timestep_fs": 0.5,
                "equilibration_ps": 5.0,
                "production_ps": 20.0,
                "friction_per_fs": 0.01,
                "seeds": [1, 2, 3],
                "fixed_bottom_layers": 2,
                "freeze_indices": None,
                "layer_tolerance_angstrom": 0.25,
                "pre_relax": True,
                "fmax_ev_per_angstrom": 0.05,
                "max_relax_steps": 200,
                "thermo_interval_steps": 10,
                "trajectory_interval_steps": 10,
                "collision_distance_angstrom": 0.6,
            }
            with patch("materials_mcp.uma_runtime._wsl_path", side_effect=lambda path: f"/converted/{Path(path).name}"), patch(
                "materials_mcp.uma_runtime.subprocess.run", return_value=completed
            ) as run:
                result = _run_wsl_surface_md(
                    root / "adsorbed.extxyz",
                    root / "md",
                    root,
                    **parameters,
                )

            command = run.call_args.args[0]
            self.assertEqual(command[:4], ["wsl.exe", "--exec", "/usr/bin/env", f"PYTHONPATH=/converted/materials-mcp"])
            self.assertIn("NEBULAMAT_UMA_WEIGHTS=/converted/uma.pt", command)
            self.assertEqual(command[command.index("--supercell") + 1 : command.index("--supercell") + 4], ["2", "2", "1"])
            self.assertEqual(command.count("--seed"), 3)
            self.assertEqual(result["execution_runtime"]["kind"], "wsl2")
            self.assertEqual(result["output_dir"], r"C:\work\md")


if __name__ == "__main__":
    unittest.main()
