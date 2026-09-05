import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from ase import Atom, Atoms

from materials_mcp.uma import (
    DEFAULT_MODEL,
    UMAError,
    _bottom_layer_indices,
    _resolve_local_checkpoint,
    adsorption_energy_ev,
    run_uma_adsorption_screen,
)


def _adsorption_atoms() -> tuple[Atoms, Atoms, Atoms]:
    slab = Atoms(
        "Cu6",
        positions=[[1.0, 1.0, float(index + 2)] for index in range(6)],
        cell=[12.0, 12.0, 20.0],
        pbc=True,
    )
    adsorbate = Atoms("H", positions=[[5.0, 5.0, 5.0]], cell=[12.0, 12.0, 12.0], pbc=False)
    adsorbed = slab.copy()
    adsorbed.append(Atom("H", position=[1.0, 1.0, 9.5]))
    return slab, adsorbate, adsorbed


def _provenance(_path: Path, expected_kind: str) -> dict:
    return {
        "manifest_path": "standardization-manifest.json",
        "manifest": {"surface": {"miller_index": [1, 1, 1], "layers": 6}},
        "artifact": {"kind": expected_kind},
    }


class UMAContractTests(unittest.TestCase):
    def test_adsorption_energy_uses_recorded_sign_convention(self):
        self.assertAlmostEqual(adsorption_energy_ev(-12.0, -10.0, -1.5), -0.5)

    def test_adsorption_energy_rejects_non_finite_values(self):
        with self.assertRaises(UMAError):
            adsorption_energy_ev(float("nan"), -1.0, -1.0)

    def test_local_checkpoint_override_is_used_for_legacy_model_name(self):
        with TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "uma-s-1p2p1.pt"
            checkpoint.write_bytes(b"checkpoint")
            with patch.dict("os.environ", {"NEBULAMAT_UMA_WEIGHTS": str(checkpoint)}):
                self.assertEqual(_resolve_local_checkpoint(DEFAULT_MODEL), checkpoint.resolve())

    def test_relax_false_is_rejected_before_any_energy_evaluation(self):
        with self.assertRaisesRegex(UMAError, "relaxation is mandatory"):
            run_uma_adsorption_screen("slab", "adsorbate", "adsorbed", relax=False)

    def test_default_constraint_fixes_bottom_three_real_planes(self):
        slab, _, _ = _adsorption_atoms()
        self.assertEqual(_bottom_layer_indices(slab, 3), [0, 1, 2])

    def test_all_structures_relax_before_energies_are_evaluated(self):
        with TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("slab.extxyz", "adsorbate.extxyz", "adsorbed.extxyz")]
            for path in paths:
                path.write_text("placeholder", encoding="utf-8")
            atoms = _adsorption_atoms()
            converged = {"status": "converged", "max_force_ev_per_angstrom": 0.01}
            with (
                patch("materials_mcp.uma.validate_standardized_artifact", side_effect=_provenance),
                patch("materials_mcp.uma._load_calculator", return_value=(object(), "test")),
                patch("materials_mcp.uma._read_atoms", side_effect=atoms),
                patch("materials_mcp.uma._relax", return_value=converged) as relax_mock,
                patch("materials_mcp.uma._energy", side_effect=[-10.0, -1.0, -12.0]) as energy_mock,
            ):
                result = run_uma_adsorption_screen(*paths)
            self.assertEqual(result["status"], "completed")
            self.assertTrue(result["protocol"]["relax"])
            self.assertEqual(result["protocol"]["fixed_bottom_layers"], 3)
            self.assertEqual(relax_mock.call_args_list[0].args[4], [0, 1, 2])
            self.assertIsNone(relax_mock.call_args_list[1].args[4])
            self.assertEqual(relax_mock.call_args_list[2].args[4], [0, 1, 2])
            self.assertEqual(energy_mock.call_count, 3)
            self.assertAlmostEqual(result["adsorption_energy_ev"], -1.0)

    def test_non_converged_relaxation_holds_and_never_calls_energy(self):
        with TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("slab.extxyz", "adsorbate.extxyz", "adsorbed.extxyz")]
            for path in paths:
                path.write_text("placeholder", encoding="utf-8")
            atoms = _adsorption_atoms()
            relaxation = [
                {"status": "converged"},
                {"status": "converged"},
                {"status": "not_converged"},
            ]
            with (
                patch("materials_mcp.uma.validate_standardized_artifact", side_effect=_provenance),
                patch("materials_mcp.uma._load_calculator", return_value=(object(), "test")),
                patch("materials_mcp.uma._read_atoms", side_effect=atoms),
                patch("materials_mcp.uma._relax", side_effect=relaxation),
                patch("materials_mcp.uma._energy") as energy_mock,
            ):
                result = run_uma_adsorption_screen(*paths)
            self.assertEqual(result["status"], "hold")
            self.assertNotIn("energies_ev", result)
            self.assertNotIn("adsorption_energy_ev", result)
            energy_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
