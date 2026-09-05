import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

from materials_mcp.runtime_config import _configured_runtime_probe, probe_runtime_status, write_runtime_status


class RuntimeConfigTests(unittest.TestCase):
    def test_preflight_distinguishes_ready_runtime_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "materials").mkdir()
            checkpoint = root / "runtime" / "model.pth"
            checkpoint.parent.mkdir()
            checkpoint.write_bytes(b"model")
            import hashlib

            digest = hashlib.sha256(b"model").hexdigest()
            (root / "materials" / "runtime.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "tools": {
                            "mattersim": {
                                "runtime": {"active": sys.executable},
                                "required_modules": ["json"],
                                "checkpoint": "runtime/model.pth",
                                "sha256": digest,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            status = probe_runtime_status(root)
            self.assertEqual(status["tools"]["mattersim"]["status"], "ready")
            written = write_runtime_status(root)
            self.assertTrue(Path(written["status_path"]).is_file())

    def test_missing_module_is_not_reported_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "materials").mkdir()
            (root / "materials" / "runtime.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "tools": {
                            "uma": {
                                "runtime": {"active": sys.executable},
                                "required_modules": ["module_that_does_not_exist"],
                                "weight_source": "facebook/UMA",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            status = probe_runtime_status(root)
            self.assertEqual(status["tools"]["uma"]["status"], "missing")
            self.assertEqual(status["tools"]["uma"]["weights"]["status"], "not_probed")

    @patch(
        "materials_mcp.runtime_config.subprocess.run",
        return_value=SimpleNamespace(returncode=0, stdout='{"torch": true, "mattergen": true}\n'),
    )
    def test_wsl_runtime_is_probed_when_configured_on_windows(self, run):
        # The test suite runs in both native Linux/WSL and Windows. Force the
        # Windows branch so the configured POSIX interpreter is exercised as a
        # WSL2 command instead of being resolved as a local Linux path.
        root = Path("C:/workspace")
        with patch("materials_mcp.runtime_config.os.name", "nt"):
            result = _configured_runtime_probe(
                "/root/mattergen/venv/bin/python",
                root,
                ["torch", "mattergen"],
            )
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["platform"], "wsl2")
        run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
