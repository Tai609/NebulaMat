import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from ase import Atoms
from ase.calculators.calculator import Calculator, all_changes
from ase.io import read, write

from materials_mcp.uma import UMAError
from materials_mcp.uma_md import DEFAULT_TIMESTEP_FS, run_uma_surface_md
from materials_mcp.structure_standardizer import STANDARDIZER_VERSION


class _ZeroCalculator(Calculator):
    implemented_properties = ["energy", "forces"]

    def calculate(self, atoms=None, properties=None, system_changes=all_changes):
        super().calculate(atoms, properties, system_changes)
        self.results = {
            "energy": 0.0,
            "forces": np.zeros((len(atoms), 3), dtype=float),
        }


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_standardized_adsorbed_surface(root: Path) -> Path:
    positions = [
        [0.5, 0.5, 2.0],
        [2.5, 2.5, 2.0],
        [0.5, 0.5, 3.0],
        [2.5, 2.5, 3.0],
        [0.5, 0.5, 4.0],
        [2.5, 2.5, 4.0],
        [1.5, 1.5, 5.2],
    ]
    atoms = Atoms("Cu6H", positions=positions, cell=[4.0, 4.0, 12.0], pbc=(True, True, False))
    path = root / "adsorbed.extxyz"
    write(path, atoms)
    manifest = {
        "schema_version": 1,
        "standardizer_version": STANDARDIZER_VERSION,
        "status": "pass",
        "kind": "adsorption-set",
        "surface": {"miller_index": [1, 0, 0], "layers": 3},
        "screening_ready": {"bulk": False, "surface": True, "adsorption": True},
        "artifacts": [
            {
                "path": "adsorbed.extxyz",
                "kind": "surface",
                "role": "adsorbed",
                "sha256": _sha256(path),
                "natoms": 7,
            },
            {
                "path": "adsorbate.extxyz",
                "kind": "adsorbate",
                "role": "adsorbate",
                "sha256": "not-read-by-md-runner",
                "natoms": 1,
            },
        ],
    }
    (root / "standardization-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return path


class UMASurfaceMDTests(unittest.TestCase):
    def test_default_2x2x1_surface_md_writes_auditable_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = _write_standardized_adsorbed_surface(root)
            output = root / "md"
            with patch("materials_mcp.uma_md._load_calculator", return_value=(_ZeroCalculator(), "test")):
                result = run_uma_surface_md(
                    source,
                    output,
                    device="cpu",
                    equilibration_ps=0.0,
                    production_ps=0.001,
                    seeds=[7],
                    thermo_interval_steps=1,
                    trajectory_interval_steps=1,
                    collision_distance_angstrom=0.5,
                )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["protocol"]["engine"], "ase")
            self.assertEqual(DEFAULT_TIMESTEP_FS, 0.5)
            self.assertEqual(result["protocol"]["timestep_fs"], 0.5)
            self.assertEqual(result["expansion"]["supercell"], [2, 2, 1])
            self.assertEqual(result["expansion"]["factor"], 4)
            self.assertEqual(result["expansion"]["expanded_natoms"], 28)
            self.assertEqual(result["expansion"]["expanded_substrate_natoms"], 24)
            self.assertEqual(result["expansion"]["expanded_adsorbate_natoms"], 4)
            self.assertAlmostEqual(result["expansion"]["surface_area_angstrom2"], 64.0)
            self.assertEqual(result["expansion"]["pbc"], [True, True, False])
            self.assertEqual(result["constraints"]["fixed_bottom_layers"], 2)
            self.assertEqual(result["constraints"]["fixed_atom_count"], 16)
            self.assertEqual(result["pre_relaxation"]["status"], "converged")
            self.assertEqual(result["replicas"][0]["completed_steps"], 2)
            self.assertEqual(result["replicas"][0]["trajectory_preview_frames"], 3)
            preview = output / "seed-7" / "trajectory-preview.extxyz"
            self.assertTrue(preview.is_file())
            preview_text = preview.read_text(encoding="utf-8")
            self.assertIn("md_step=1", preview_text)
            self.assertIn("md_timestep_fs=0.5", preview_text)
            self.assertIn("md_phase=production", preview_text)
            self.assertIn("atom_role:S:1", preview_text)
            self.assertNotIn("momenta:R:3", preview_text)
            preview_atoms = read(preview, index=0)
            self.assertAlmostEqual(preview_atoms.info["md_timestep_fs"], 0.5)
            self.assertEqual(list(preview_atoms.arrays["atom_role"]).count("substrate"), 24)
            self.assertEqual(list(preview_atoms.arrays["atom_role"]).count("adsorbate"), 4)
            self.assertEqual(result["quality_gates"]["decision"], "pass")
            self.assertEqual(len(result["manifest_sha256"]), 64)
            self.assertTrue((output / "md-manifest.json").is_file())
            for artifact in result["artifacts"]:
                self.assertTrue((output / artifact["path"]).is_file(), artifact["path"])

    def test_raw_surface_is_rejected_before_model_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw.extxyz"
            write(raw, Atoms("CuH", positions=[[0, 0, 0], [0, 0, 1]], cell=[5, 5, 10], pbc=True))
            with patch("materials_mcp.uma_md._load_calculator") as load:
                with self.assertRaisesRegex(UMAError, "standardized adsorbed surface"):
                    run_uma_surface_md(raw, root / "md", device="cpu", production_ps=0.001, seeds=[1])
            load.assert_not_called()

    def test_vacuum_direction_cannot_be_replicated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = _write_standardized_adsorbed_surface(root)
            with self.assertRaisesRegex(UMAError, r"supercell\[2\] == 1"):
                run_uma_surface_md(
                    source,
                    root / "md",
                    device="cpu",
                    supercell=[2, 2, 2],
                    production_ps=0.001,
                    seeds=[1],
                )


if __name__ == "__main__":
    unittest.main()
