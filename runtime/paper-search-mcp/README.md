# NebulaMat paper search MCP

This package is the application-owned safety boundary around the pinned MIT
`paper-search-mcp==0.1.4` dependency. It exposes metadata search and DOI lookup
tools while removing upstream tools that can write to caller-selected paths or
retrieve full text through sources outside NebulaMat's lawful downloader
workflow.

The desktop application bundles this small wrapper as a Tauri resource and
installs it into the shared managed science-MCP Python environment on demand.
The pinned upstream dependency is resolved by `uv` from the configured Python
package index during setup.
