import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from pymatgen.core import Lattice, Structure


RUNNER_PATH = Path(__file__).resolve().parents[2] / "mattergen" / "mattergen_runner.py"
SPEC = importlib.util.spec_from_file_location("nebulamat_mattergen_runner_test", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class MatterGenRunnerStandardizationTests(unittest.TestCase):
    def test_generated_cif_is_standardized_before_run_completes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path = root / "request.json"
            model_root = root / "models" / "chemical_system"
            (model_root / "checkpoints").mkdir(parents=True)
            (model_root / "config.yaml").write_text("model: test\n", encoding="utf-8")
            (model_root / "checkpoints" / "last.ckpt").write_bytes(b"test-checkpoint")
            request_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "output_dir": "results",
                        "pretrained_name": "chemical_system",
                        "batch_size": 1,
                        "num_batches": 1,
                        "properties_to_condition_on": {"chemical_system": "Si"},
                        "target_compositions": [],
                        "record_trajectories": False,
                    }
                ),
                encoding="utf-8",
            )
            generated = Structure(Lattice.cubic(3.0), ["Si"], [[0, 0, 0]])
            mattergen_module = types.ModuleType("mattergen")
            scripts_module = types.ModuleType("mattergen.scripts")
            generate_module = types.ModuleType("mattergen.scripts.generate")
            generate_module.main = lambda **_kwargs: [generated]
            previous_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(
                    sys.modules,
                    {
                        "mattergen": mattergen_module,
                        "mattergen.scripts": scripts_module,
                        "mattergen.scripts.generate": generate_module,
                    },
                ), patch.dict(os.environ, {"NEBULAMAT_MATTERGEN_MODELS": str(root / "models")}):
                    result = RUNNER.run(request_path)
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(result["status"], "completed")
            self.assertTrue(result["standardization"]["screening_ready"]["bulk"])
            self.assertFalse(result["standardization"]["screening_ready"]["adsorption"])
            self.assertTrue((root / "results" / "standardized" / "standardization-manifest.json").is_file())
            self.assertTrue((root / "results" / "standardized" / "structure-0001" / "bulk.cif").is_file())
            self.assertTrue((root / "results" / "standardized" / "structure-0001" / "standardization-manifest.json").is_file())


if __name__ == "__main__":
    unittest.main()
