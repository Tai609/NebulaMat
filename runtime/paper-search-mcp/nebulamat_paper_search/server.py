"""Expose the metadata-only subset of the pinned paper-search MCP.

The upstream server includes useful multi-source search alongside tools that
can write to caller-selected filesystem paths or use Sci-Hub. NebulaMat keeps
only metadata search and DOI lookup. Full-text retrieval stays in the separate
lawful downloader workflow, which owns workspace confinement and user gates.
"""
from __future__ import annotations

from typing import Any

from paper_search_mcp.server import mcp as upstream_mcp


REQUIRED_TOOLS = {"search_papers", "search_arxiv", "search_pubmed", "search_crossref"}
EXACT_SAFE_TOOLS = {"get_crossref_paper_by_doi"}


def _tool_map(server: Any) -> dict[str, Any]:
    manager = getattr(server, "_tool_manager", None)
    tools = getattr(manager, "_tools", None)
    if not isinstance(tools, dict):
        raise RuntimeError("paper-search-mcp tool registry is incompatible with this pinned wrapper")
    return tools


def apply_nebulamat_policy(server: Any) -> tuple[str, ...]:
    """Remove every non-search or filesystem-capable upstream tool."""
    tools = _tool_map(server)
    for name in tuple(tools):
        if not (name.startswith("search_") or name in EXACT_SAFE_TOOLS):
            tools.pop(name, None)
    missing = REQUIRED_TOOLS - set(tools)
    if missing:
        raise RuntimeError(f"paper-search-mcp is missing required tools: {sorted(missing)}")
    return tuple(sorted(tools))


SAFE_TOOL_NAMES = apply_nebulamat_policy(upstream_mcp)
mcp = upstream_mcp


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
