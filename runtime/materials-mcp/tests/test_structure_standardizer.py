import json
import tempfile
import unittest
from pathlib import Path

from pymatgen.core import Lattice, Structure
from pymatgen.io.cif import CifWriter

from materials_mcp.mattersim_adapter import MatterSimError, run_mattersim_stability_screen
from materials_mcp.structure_standardizer import (
    STANDARDIZER_VERSION,
    StandardizationError,
    _layer_count,
    standardize_adsorption_set,
    standardize_structure,
    validate_standardized_artifact,
)
from materials_mcp.uma import UMAError, run_uma_adsorption_screen


def _write_structure(path: Path, natoms: int) -> None:
    coords = [
        (((index * 0.137) % 0.8) + 0.05, ((index * 0.271) % 0.8) + 0.05, ((index * 0.419) % 0.8) + 0.05)
        for index in range(natoms)
    ]
    CifWriter(Structure(Lattice.cubic(20), ["Si"] * natoms, coords)).write_file(path)


def _write_fcc_structure(path: Path) -> None:
    structure = Structure(
        Lattice.cubic(3.6),
        ["Cu"] * 4,
        [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
    )
    CifWriter(structure).write_file(path)


class StructureStandardizerTests(unittest.TestCase):
    def test_small_cells_expand_into_common_bulk_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected_counts = {3: 39, 8: 40, 20: 40}
            for natoms in (3, 8, 20):
                source = root / f"raw-{natoms}.cif"
                _write_structure(source, natoms)
                result = standardize_structure(source, root / f"standardized-{natoms}")
                self.assertEqual(result["bulk"]["natoms"], expected_counts[natoms])
                self.assertTrue(result["screening_ready"]["bulk"])
                self.assertTrue((root / f"standardized-{natoms}" / "standardization-manifest.json").is_file())

    def test_surface_layers_and_in_plane_atoms_are_fixed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.cif"
            _write_fcc_structure(source)
            result = standardize_structure(
                source,
                root / "standardized",
                {"surface_miller_index": [1, 1, 1], "surface_layers": 6},
            )
            self.assertEqual(result["surface"]["layers"], 6)
            self.assertEqual(result["surface"]["atomic_plane_count"], 6)
            self.assertEqual(result["surface"]["layer_count"], 6)
            self.assertTrue(76.8 <= result["surface"]["natoms"] <= 115.2)
            self.assertEqual(result["surface"]["miller_index"], [1, 1, 1])
            self.assertGreaterEqual(min(result["surface"]["in_plane_lengths_angstrom"]), 12.0)
            self.assertLessEqual(result["surface"]["cell_aspect_ratio"], 4.0)
            self.assertLessEqual(result["surface"]["slab_thickness_angstrom"], 20.0)
            self.assertAlmostEqual(result["surface"]["total_vacuum_angstrom"], 15.0, places=6)
            validate_standardized_artifact(root / "standardized" / "surface.cif", "surface")

    def test_layer_count_uses_true_surface_normal_for_skewed_c(self):
        structure = Structure(
            Lattice([[3, 0, 0], [0, 3, 0], [6, 0, 10]]),
            ["Si", "Si"],
            [[0, 0, 0.1], [0.3, 0, 0.1]],
        )
        self.assertEqual(_layer_count(structure), 1)

    def test_surface_policy_cannot_guess_missing_layer_count(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "raw.cif"
            _write_structure(source, 3)
            with self.assertRaises(StandardizationError):
                standardize_structure(source, Path(directory) / "out", {"surface_miller_index": [1, 0, 0]})

    def test_tampered_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.cif"
            _write_structure(source, 8)
            standardize_structure(source, root / "out")
            artifact = root / "out" / "bulk.cif"
            artifact.write_text(artifact.read_text(encoding="utf-8") + "\n# tampered\n", encoding="utf-8")
            with self.assertRaises(StandardizationError):
                validate_standardized_artifact(artifact, "bulk")

    def test_old_standardizer_manifest_requires_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.cif"
            _write_structure(source, 8)
            standardize_structure(source, root / "out")
            manifest_path = root / "out" / "standardization-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["standardizer_version"] = "1.0.0"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertEqual(STANDARDIZER_VERSION, "1.1.0")
            with self.assertRaisesRegex(StandardizationError, "rebuild"):
                validate_standardized_artifact(root / "out" / "bulk.cif", "bulk")

    def test_explicit_adsorption_set_gets_one_composition_checked_manifest(self):
        from ase import Atom, Atoms
        from ase.io import read, write

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.cif"
            _write_fcc_structure(source)
            standardize_structure(
                source,
                root / "surface-source",
                {"surface_miller_index": [1, 1, 1], "surface_layers": 6},
            )
            slab_path = root / "surface-source" / "surface.cif"
            slab = read(slab_path)
            adsorbate = Atoms("H", positions=[[0, 0, 0]], cell=[20, 20, 20], pbc=False)
            adsorbate_path = root / "adsorbate.extxyz"
            write(adsorbate_path, adsorbate)
            adsorbed = slab.copy()
            adsorbed.append(Atom("H", position=slab.get_positions().mean(axis=0) + [0, 0, 1.5]))
            adsorbed_path = root / "adsorbed.extxyz"
            write(adsorbed_path, adsorbed)
            result = standardize_adsorption_set(slab_path, adsorbate_path, adsorbed_path, root / "cohort")
            self.assertTrue(result["screening_ready"]["adsorption"])
            self.assertTrue(result["cohort_checks"]["composition_conserved"])
            validate_standardized_artifact(root / "cohort" / "adsorbate.extxyz", "adsorbate")
            validate_standardized_artifact(root / "cohort" / "adsorbed.extxyz", "surface")

    def test_raw_structure_cannot_enter_mattersim_or_uma(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw.cif"
            _write_structure(raw, 3)
            with self.assertRaises(MatterSimError):
                run_mattersim_stability_screen(raw, model_path=root / "missing.pth", device="cpu")
            with self.assertRaises(UMAError):
                run_uma_adsorption_screen(raw, raw.with_name("adsorbate.cif"), raw.with_name("adsorbed.cif"), device="cpu")


if __name__ == "__main__":
    unittest.main()
