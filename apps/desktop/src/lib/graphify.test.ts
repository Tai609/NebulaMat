import type { HistoryMessage } from "@ai4s/sdk";
import { describe, expect, it } from "vitest";
import type { GraphDocument, GraphNode } from "./tauri";
import {
  activeGraphPath,
  conversationGraphInput,
  graphifyMcpConfig,
  graphNeighbors,
} from "./graphify";

const node = (id: string, label: string, degree: number): GraphNode => ({
  id,
  label,
  degree,
  nodeType: "symbol",
  sourceFile: null,
  sourceLocation: null,
  community: "0",
  communityName: "Community 0",
  role: null,
});

describe("Graphify chat integration", () => {
  it("keeps persisted message, tool, and input data for conversation indexing", () => {
    const messages: HistoryMessage[] = [
      {
        id: "msg_1",
        role: "assistant",
        completed: 123,
        parts: [
          { type: "text", text: "Reviewed the parser", synthetic: false },
          {
            type: "tool",
            tool: "read",
            state: { title: "Read parser", input: { filePath: "src/parser.ts" } },
          },
        ],
      },
    ];

    expect(conversationGraphInput(messages)).toEqual([
      {
        id: "msg_1",
        role: "assistant",
        completed: 123,
        parts: [
          { type: "text", text: "Reviewed the parser", synthetic: false },
          {
            type: "tool",
            tool: "read",
            state: { title: "Read parser", input: { filePath: "src/parser.ts" } },
          },
        ],
      },
    ]);
  });

  it("registers one explicit graph path with the local MCP server", () => {
    const config = graphifyMcpConfig("C:\\env\\graphify-mcp.exe", "C:\\graphs\\alpha\\graph.json");
    expect(config).toEqual({
      type: "local",
      command: ["C:\\env\\graphify-mcp.exe", "--graph", "C:\\graphs\\alpha\\graph.json"],
      enabled: true,
    });
    expect(activeGraphPath(config)).toBe("C:\\graphs\\alpha\\graph.json");
    expect(activeGraphPath({ type: "local", command: ["graphify-mcp"], enabled: true })).toBeNull();
  });

  it("returns incoming and outgoing neighbors ordered by connectivity", () => {
    const graph = {
      nodes: [node("a", "Alpha", 2), node("b", "Beta", 8), node("c", "Gamma", 3)],
      edges: [
        { source: "a", target: "b", relation: "calls", confidence: "EXTRACTED" },
        { source: "c", target: "a", relation: "imports", confidence: "INFERRED" },
      ],
    } as GraphDocument;

    expect(graphNeighbors(graph, "a").map(({ node: related, direction }) => [related.id, direction])).toEqual([
      ["b", "out"],
      ["c", "in"],
    ]);
  });
});
