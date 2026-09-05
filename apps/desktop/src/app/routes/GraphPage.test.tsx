import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  listScopes: vi.fn(),
  readGraph: vi.fn(),
  loadCatalog: vi.fn(),
  listDshMcpServers: vi.fn(),
  setDshMcpServer: vi.fn(),
}));

vi.mock("@/lib/webMode", () => ({ isGatewayWeb: false }));
vi.mock("@/components/graph/GraphCanvas", () => ({
  GraphCanvas: () => <div data-testid="graph-canvas" />,
}));
vi.mock("@/lib/runtime", () => {
  const state = {
    projects: [{ id: "project_1", name: "Project Alpha", createdAt: 10 }],
    sessions: [{ id: "session_1", title: "Conversation Beta", updated: 20 }],
    loadCatalog: mocks.loadCatalog,
  };
  return {
    getClient: () => ({ getMessages: vi.fn() }),
    useRuntimeStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});
vi.mock("@/lib/tauri", () => ({
  getGraphifyStatus: mocks.getStatus,
  listGraphifyScopes: mocks.listScopes,
  readGraphifyGraph: mocks.readGraph,
  setupGraphify: vi.fn(),
  indexGraphifyProject: vi.fn(),
  indexGraphifyConversation: vi.fn(),
  openGraphifySource: vi.fn(),
  watchSetupProgress: vi.fn(async () => vi.fn()),
  listDshMcpServers: mocks.listDshMcpServers,
  setDshMcpServer: mocks.setDshMcpServer,
}));

import { GraphPage } from "./GraphPage";

const scope = {
  id: "project_1",
  kind: "project" as const,
  title: "Project Alpha",
  indexedAt: 30,
  nodeCount: 2,
  edgeCount: 1,
  graphPath: "C:\\graphs\\project_1\\graph.json",
  projectPath: "C:\\graphs\\project_1",
  sourcePath: "C:\\source\\project_1",
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.getStatus.mockResolvedValue({
    installed: true,
    version: "0.9.39",
    busy: false,
    mcpCommand: "C:\\env\\graphify-mcp.exe",
  });
  mocks.listScopes.mockResolvedValue([scope]);
  mocks.listDshMcpServers.mockResolvedValue([]);
  mocks.readGraph.mockResolvedValue({
    scope,
    nodes: [
      {
        id: "a",
        label: "Parser",
        nodeType: "code",
        sourceFile: "src/parser.ts",
        sourceLocation: "L1",
        community: "0",
        communityName: "Community 0",
        role: null,
        degree: 1,
      },
    ],
    edges: [],
    totalNodes: 1,
    totalEdges: 0,
    truncated: false,
  });
});

describe("GraphPage", () => {
  it("shows project graphs and switches to the conversation catalog", async () => {
    render(
      <MemoryRouter>
        <GraphPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("graph-canvas")).toBeInTheDocument();
    expect(screen.getAllByText("Project Alpha").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(await screen.findByText("This conversation has no graph yet")).toBeInTheDocument();
    expect(screen.getAllByText("Conversation Beta").length).toBeGreaterThan(0);
  });
});
