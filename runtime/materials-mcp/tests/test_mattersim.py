import tempfile
import unittest
from pathlib import Path

from materials_mcp.mattersim_adapter import MatterSimError, _resolve_checkpoint


class MatterSimContractTests(unittest.TestCase):
    def test_resolves_explicit_checkpoint_without_importing_torch(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "mattersim-v1.0.0-5M.pth"
            checkpoint.write_bytes(b"checkpoint")
            self.assertEqual(_resolve_checkpoint(checkpoint, None), checkpoint.resolve())

    def test_missing_checkpoint_is_actionable(self):
        with self.assertRaises(MatterSimError) as context:
            _resolve_checkpoint("missing-mattersim.pth", None)
        self.assertIn("NEBULAMAT_MATTERSIM_MODEL", str(context.exception))


if __name__ == "__main__":
    unittest.main()
