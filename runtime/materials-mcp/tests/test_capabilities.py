import hashlib
import tempfile
import unittest
from pathlib import Path

from materials_mcp.capabilities import CapabilityError, capability_catalog, capability_plan_tasks, plan_risk
from materials_mcp.workflow import MaterialsDAGCoordinator, WorkflowError


class CapabilityPlanTests(unittest.TestCase):
    def test_catalog_contains_material_pipeline_capabilities(self):
        catalog = capability_catalog(Path(tempfile.mkdtemp()))
        rows = {row["id"]: row for row in catalog["capabilities"]}
        ids = set(rows)
        self.assertTrue({
            "structure.generate.mattergen",
            "structure.standardize.mattergen",
            "structure.edit.ase",
            "stability.screen.mattersim",
            "adsorption.screen.uma",
            "dynamics.run.uma",
            "property.compute.vasp",
            "materials.discover.database",
            "thermo.analyze.pymatgen",
            "alloy.sample.smol",
            "surface.construct.catkit",
            "adsorption.evidence.retrieve",
            "kinetics.complete.scaling_bep",
            "microkinetics.screen.catmap",
            "reactor.validate.cantera",
            "spatial.refine.kmos",
        }.issubset(ids))
        self.assertEqual(rows["structure.standardize.mattergen"]["tool"], "standardize_mattergen_structure")
        self.assertEqual(rows["dynamics.run.uma"]["tool"], "run_uma_surface_md")

    def test_plan_supports_parallel_screening_branches(self):
        plan = [
            {"task_id": "generate", "capability": "structure.generate.mattergen"},
            {"task_id": "validate", "capability": "structure.validate", "depends_on": ["generate"]},
            {"task_id": "mattersim", "capability": "stability.screen.mattersim", "depends_on": ["validate"]},
            {"task_id": "uma", "capability": "adsorption.screen.uma", "depends_on": ["validate"]},
        ]
        tasks, normalized = capability_plan_tasks(plan, Path(tempfile.mkdtemp()))
        self.assertEqual([task["task_id"] for task in tasks], ["generate", "validate", "mattersim", "uma"])
        self.assertEqual(tasks[2]["dependencies"], ["validate"])
        self.assertEqual(tasks[3]["dependencies"], ["validate"])
        self.assertEqual(normalized[1]["capability"], "structure.validate")
        self.assertEqual(plan_risk(plan, Path(tempfile.mkdtemp())), "medium")

    def test_unknown_and_duplicate_task_ids_are_rejected(self):
        with self.assertRaises(CapabilityError):
            capability_plan_tasks([{"task_id": "x", "capability": "missing.capability"}])
        with self.assertRaises(CapabilityError):
            capability_plan_tasks([
                {"task_id": "x", "capability": "structure.validate"},
                {"task_id": "x", "capability": "structure.edit.ase"},
            ])

    def test_cycles_are_rejected(self):
        with self.assertRaisesRegex(CapabilityError, "cyclic dependency"):
            capability_plan_tasks([
                {"task_id": "a", "capability": "structure.validate", "depends_on": ["b"]},
                {"task_id": "b", "capability": "structure.edit.ase", "depends_on": ["a"]},
            ])

    def test_vasp_plan_is_high_risk_and_does_not_append_hidden_tasks(self):
        plan = [
            {"task_id": "generate", "capability": "structure.generate.mattergen"},
            {"task_id": "vasp", "capability": "property.compute.vasp", "depends_on": ["generate"]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_dag(
                "validate candidate", capability_plan=plan
            )
        self.assertEqual(workflow["route"], "high-risk")
        self.assertEqual(workflow["plan_source"], "agent")
        self.assertEqual([task["task_id"] for task in workflow["tasks"]], ["generate", "vasp"])
        self.assertEqual(workflow["tasks"][1]["capability_id"], "property.compute.vasp")

    def test_agent_plan_is_the_only_task_source(self):
        plan = [{"task_id": "edit", "capability": "structure.edit.ase"}]
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_dag(
                "edit structure", capability_plan=plan
            )
        self.assertEqual(workflow["route"], "agent")
        self.assertEqual([task["task_id"] for task in workflow["tasks"]], ["edit"])

    def test_agent_route_requires_a_capability_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(WorkflowError):
                MaterialsDAGCoordinator(Path(directory)).create_dag("missing plan", route="agent")

    def test_electrocatalysis_template_skips_optional_stages_without_prerequisites(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_discovery_dag(
                "screen alkaline HER candidates",
                chemical_system="Ni-Fe-Co-O",
                reaction="alkaline HER",
                include_spatial=True,
            )
        self.assertEqual(workflow["workflow_template"], "electrocatalysis-discovery-v1")
        task_ids = [task["task_id"] for task in workflow["tasks"]]
        self.assertEqual(task_ids, [
            "generate", "references", "standardize", "validate", "thermo",
            "surfaces", "mattersim", "adsorption", "evidence", "scaling_bep",
            "catmap", "report",
        ])
        skipped = {item["stage"]: item["reason"] for item in workflow["optional_stages"]}
        self.assertEqual(skipped["alloy.sample.smol"], "existing_cluster_expansion_missing")
        self.assertEqual(skipped["reactor.validate.cantera"], "reactor_conditions_not_requested")
        self.assertEqual(skipped["spatial.refine.kmos"], "shortlisted_candidate_count_missing")
        report = next(task for task in workflow["tasks"] if task["task_id"] == "report")
        self.assertEqual(report["dependencies"], ["catmap", "thermo", "mattersim"])

    def test_electrocatalysis_template_enables_smol_reactor_and_small_spatial_branch(self):
        with tempfile.TemporaryDirectory() as directory:
            ce = Path(directory) / "ce.mson"
            ce.write_text("existing cluster expansion", encoding="utf-8")
            workflow = MaterialsDAGCoordinator(Path(directory)).create_discovery_dag(
                "screen alloy HER candidates",
                chemical_system="Ni-Fe-O",
                reaction="HER",
                existing_cluster_expansion=str(ce),
                include_reactor=True,
                include_spatial=True,
                shortlisted_candidate_count=4,
            )
        task_ids = [task["task_id"] for task in workflow["tasks"]]
        self.assertIn("smol", task_ids)
        self.assertIn("reactor", task_ids)
        self.assertIn("kmos", task_ids)
        self.assertEqual(next(task for task in workflow["tasks"] if task["task_id"] == "surfaces")["dependencies"], ["smol"])
        self.assertEqual(next(task for task in workflow["tasks"] if task["task_id"] == "kmos")["dependencies"], ["reactor"])
        self.assertEqual(workflow["optional_stages"], [])
        expected_hash = hashlib.sha256(b"existing cluster expansion").hexdigest()
        self.assertEqual(workflow["workflow_scope"]["existing_cluster_expansion_sha256"], expected_hash)
        smol = next(task for task in workflow["tasks"] if task["task_id"] == "smol")
        self.assertEqual(smol["capability_parameters"]["existing_cluster_expansion_sha256"], expected_hash)

    def test_electrocatalysis_template_records_invalid_cluster_expansion(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_discovery_dag(
                "screen alloy candidates",
                chemical_system="Ni-Fe-O",
                reaction="HER",
                existing_cluster_expansion="missing/ce.mson",
            )
        skipped = {item["stage"]: item for item in workflow["optional_stages"]}
        self.assertEqual(skipped["alloy.sample.smol"]["status"], "skipped")
        self.assertEqual(skipped["alloy.sample.smol"]["reason"], "existing_cluster_expansion_invalid")
        self.assertNotIn("smol", [task["task_id"] for task in workflow["tasks"]])

    def test_electrocatalysis_template_rejects_invalid_numeric_inputs(self):
        coordinator = MaterialsDAGCoordinator(Path(tempfile.mkdtemp()))
        with self.assertRaisesRegex(WorkflowError, "must be integers"):
            coordinator.create_discovery_dag(
                "screen candidates",
                chemical_system="Ni-O",
                reaction="HER",
                shortlisted_candidate_count="many",
            )
        with self.assertRaisesRegex(WorkflowError, "cannot be negative"):
            coordinator.create_discovery_dag(
                "screen candidates",
                chemical_system="Ni-O",
                reaction="HER",
                shortlisted_candidate_count=-1,
            )


if __name__ == "__main__":
    unittest.main()
