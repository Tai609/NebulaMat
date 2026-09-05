import type { HistoryMessage, McpConfig } from "@ai4s/sdk";
import type {
  GraphConversationMessage,
  GraphDocument,
  GraphEdge,
  GraphNode,
} from "./tauri";

export function conversationGraphInput(messages: HistoryMessage[]): GraphConversationMessage[] {
  return messages.map((message) => ({
    ...(message.id ? { id: message.id } : {}),
    role: message.role,
    ...(message.completed ? { completed: message.completed } : {}),
    parts: message.parts.map((part) => ({
      type: part.type,
      ...(part.text != null ? { text: part.text } : {}),
      ...(part.synthetic != null ? { synthetic: part.synthetic } : {}),
      ...(part.tool != null ? { tool: part.tool } : {}),
      ...(part.state != null ? { state: part.state } : {}),
    })),
  }));
}

export function graphifyMcpConfig(command: string, graphPath: string): McpConfig {
  return {
    type: "local",
    command: [command, "--graph", graphPath],
    enabled: true,
  };
}

export function activeGraphPath(config?: McpConfig): string | null {
  if (!config || config.type !== "local") return null;
  const index = config.command.indexOf("--graph");
  return index >= 0 ? config.command[index + 1] ?? null : null;
}

export function graphNeighbors(
  graph: GraphDocument,
  nodeId: string,
): Array<{ node: GraphNode; edge: GraphEdge; direction: "in" | "out" }> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors: Array<{ node: GraphNode; edge: GraphEdge; direction: "in" | "out" }> = [];
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      const node = byId.get(edge.target);
      if (node) neighbors.push({ node, edge, direction: "out" });
    } else if (edge.target === nodeId) {
      const node = byId.get(edge.source);
      if (node) neighbors.push({ node, edge, direction: "in" });
    }
  }
  return neighbors.sort((a, b) => b.node.degree - a.node.degree || a.node.label.localeCompare(b.node.label));
}

