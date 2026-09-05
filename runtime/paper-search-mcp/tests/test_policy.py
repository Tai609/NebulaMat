from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
import tomllib

from nebulamat_paper_search.server import apply_nebulamat_policy


class PolicyTests(unittest.TestCase):
    def server(self, names: set[str]) -> SimpleNamespace:
        tools = {name: object() for name in names}
        return SimpleNamespace(_tool_manager=SimpleNamespace(_tools=tools))

    def test_removes_non_search_and_filesystem_tools(self) -> None:
        server = self.server(
            {
                "search_papers",
                "search_arxiv",
                "search_pubmed",
                "search_crossref",
                "get_crossref_paper_by_doi",
                "download_paper",
                "list_downloaded_papers",
            }
        )

        names = apply_nebulamat_policy(server)

        self.assertEqual(
            names,
            (
                "get_crossref_paper_by_doi",
                "search_arxiv",
                "search_crossref",
                "search_papers",
                "search_pubmed",
            ),
        )

    def test_rejects_an_incompatible_upstream_registry(self) -> None:
        server = self.server({"search_papers"})

        with self.assertRaisesRegex(RuntimeError, "missing required tools"):
            apply_nebulamat_policy(server)

    def test_package_metadata_keeps_the_upstream_legacy_api_compatible(self) -> None:
        pyproject = Path(__file__).parents[1] / "pyproject.toml"
        dependencies = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"][
            "dependencies"
        ]

        self.assertIn("paper-search-mcp==0.1.4", dependencies)
        self.assertIn("mcp>=1.6,<2", dependencies)
        self.assertIn("fastmcp<4", dependencies)


if __name__ == "__main__":
    unittest.main()
