import tempfile
import unittest
from pathlib import Path

from materials_mcp.workflow import MaterialsDAGCoordinator


class WorkflowRouteTests(unittest.TestCase):
    def test_standard_route_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_dag("screen candidates")
            self.assertEqual(workflow["route"], "standard")
            self.assertEqual([task["task_id"] for task in workflow["tasks"]], ["plan", "discover", "validate", "screen", "complete"])

    def test_fast_route_has_no_provider_or_review_fanout(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_dag("answer locally", route="fast")
            self.assertEqual(workflow["route"], "fast")
            self.assertEqual(len(workflow["tasks"]), 2)

    def test_dft_promotes_to_high_risk(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = MaterialsDAGCoordinator(Path(directory)).create_dag("prepare VASP", include_dft=True)
            self.assertEqual(workflow["route"], "high-risk")
            self.assertTrue(any(task["task_id"] == "dft:human-review" for task in workflow["tasks"]))


if __name__ == "__main__":
    unittest.main()
