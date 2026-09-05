import unittest

from materials_mcp.human_review import _normalize_argv


class HumanReviewCliTests(unittest.TestCase):
    def test_accepts_workspace_before_command_from_legacy_desktop_build(self):
        workspace = r"C:\workspaces\session-a"
        self.assertEqual(
            _normalize_argv([workspace, "list", "--dft-only"]),
            ["--workspace", workspace, "list", "--dft-only"],
        )

    def test_preserves_canonical_invocation(self):
        workspace = r"C:\workspaces\session-a"
        self.assertEqual(
            _normalize_argv(["--workspace", workspace, "get", "mw_123"]),
            ["--workspace", workspace, "get", "mw_123"],
        )

    def test_does_not_treat_a_subcommand_as_a_workspace(self):
        self.assertEqual(_normalize_argv(["list", "--dft-only"]), ["list", "--dft-only"])


if __name__ == "__main__":
    unittest.main()
