---
name: graph-context
description: Use the active Graphify knowledge graph before broad workspace scans when answering questions about architecture, dependencies, call paths, concepts, or change impact.
---

# Graph context

When the `graphify` MCP server is available, use it before reading many files:

1. Start with `query_graph` for the user's concrete question.
2. Use `get_node`, `get_neighbors`, or `shortest_path` to inspect a relationship.
3. Read the reported source files before making a code change or treating an inferred relationship as fact.

`EXTRACTED` relationships come from source structure. `INFERRED` and
`AMBIGUOUS` relationships are navigation hints and must be verified. If the MCP
server has no active graph, continue with normal workspace tools without error.
