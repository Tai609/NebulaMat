import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResearchGraph } from "@ai4s/shared";
import { ResearchRuntime } from "@ai4s/sdk";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  runtime: null as ResearchRuntime | null,
  startDraft: vi.fn(),
  startDraftInCurrentWorkspace: vi.fn(),
  startDraftInWorkspace: vi.fn(async () => {}),
  resetLayout: vi.fn(),
  getClient: vi.fn(() => null),
}));

vi.mock("@/lib/webMode", () => ({ isGatewayWeb: false }));
vi.mock("@/components/research/ResearchGraphCanvas", () => ({
  ResearchGraphCanvas: () => <div data-testid="research-graph-canvas" />,
}));
vi.mock("@/lib/researchWorkspace", () => ({
  initializeResearchWorkspace: mocks.initialize,
  researchWorkspaceKey: () => "C:\\workspace",
}));
vi.mock("@/lib/runtime", () => ({
  getClient: mocks.getClient,
  draftKeyFor: (leafId: string) => `draft:${leafId}`,
  useRuntimeStore: {
    getState: () => ({
      startDraft: mocks.startDraft,
      startDraftInCurrentWorkspace: mocks.startDraftInCurrentWorkspace,
      startDraftInWorkspace: mocks.startDraftInWorkspace,
      refreshSessions: vi.fn(async () => {}),
    }),
  },
}));
vi.mock("@/lib/layout", () => ({
  useLayoutStore: {
    getState: () => ({ reset: mocks.resetLayout, focusedLeafId: "pane-autonomous" }),
  },
}));

import { ResearchPage } from "./ResearchPage";

describe("ResearchPage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mocks.startDraft.mockReset();
    mocks.startDraftInCurrentWorkspace.mockReset();
    mocks.startDraftInWorkspace.mockReset();
    mocks.resetLayout.mockReset();
    const runtime = new ResearchRuntime();
    runtime.hydrateResearch(createResearchGraph({
      researchId: "research-ui-1",
      title: "Mechanism study",
      objective: "Test one transferable mechanism",
      now: 1_700_000_000_000,
    }));
    mocks.runtime = runtime;
    mocks.initialize.mockResolvedValue(runtime);
  });

  it("loads a persisted graph and creates another graph through the runtime", async () => {
    render(
      <MemoryRouter>
        <ResearchPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("research-graph-canvas")).toBeInTheDocument();
    expect(screen.getAllByText("Mechanism study").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "New research" }));
    fireEvent.change(screen.getByPlaceholderText("A question worth testing"), { target: { value: "New graph" } });
    fireEvent.change(screen.getByPlaceholderText("What should this research establish or clarify?"), { target: { value: "Check a second claim" } });
    fireEvent.click(screen.getByRole("button", { name: "Create graph" }));

    expect((await screen.findAllByText("New graph")).length).toBeGreaterThan(0);
    expect(mocks.initialize).toHaveBeenCalled();
  });

  it("adds a hypothesis from the workbench and keeps it in the runtime graph", async () => {
    render(
      <MemoryRouter>
        <ResearchPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("research-graph-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Add node" }));
    fireEvent.change(screen.getByPlaceholderText("Short label"), { target: { value: "Alternative mechanism" } });
    fireEvent.change(screen.getByPlaceholderText("What should this node record?"), { target: { value: "A competing mechanism explains the same observation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.runtime!.getResearch("research-ui-1").nodes).toContainEqual(expect.objectContaining({
      kind: "hypothesis",
      label: "Alternative mechanism",
      statement: "A competing mechanism explains the same observation",
      status: "open",
    }));
  });

  it("starts autopilot in the current workspace so the graph remains visible", async () => {
    render(
      <MemoryRouter>
        <ResearchPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("research-graph-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Start autonomous research" }));

    await waitFor(() => expect(mocks.startDraftInWorkspace).toHaveBeenCalledTimes(1));
    expect(mocks.startDraftInWorkspace).toHaveBeenCalledWith("C:\\workspace", "draft:pane-autonomous");
    expect(mocks.startDraftInCurrentWorkspace).not.toHaveBeenCalled();
    expect(mocks.startDraft).not.toHaveBeenCalled();
    expect(mocks.resetLayout).toHaveBeenCalledWith(null);
  });

  it("creates the five InnoClaw roles as isolated branches", async () => {
    render(
      <MemoryRouter>
        <ResearchPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("research-graph-canvas");
    fireEvent.click(screen.getByRole("button", { name: "InnoClaw" }));
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    const branches = mocks.runtime!.getResearch("research-ui-1").branches.filter((branch) => branch.role);
    expect(branches.map((branch) => branch.role)).toEqual(["researcher", "skeptic", "librarian", "reproducer", "scribe"]);
    expect(mocks.runtime!.getResearch("research-ui-1").nodes.filter((node) => node.kind === "action"))
      .toHaveLength(5);
  });
});
