import { describe, expect, it, vi } from "vitest";
import { createResearchGraph } from "@ai4s/shared";

const mocks = vi.hoisted(() => ({
  workspacePath: vi.fn(),
  listResearchGraphs: vi.fn(),
  writeResearchGraph: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("./tauri", () => mocks);

import { initializeResearchWorkspace } from "./researchWorkspace";

describe("research workspace bridge", () => {
  it("hydrates the active workspace and serializes onGraphChanged writes", async () => {
    const persisted = createResearchGraph({
      researchId: "research-persisted",
      title: "Persisted study",
      objective: "Restore from the workspace store",
      now: 1_700_000_000_000,
    });
    mocks.workspacePath.mockResolvedValue("C:/workspace");
    mocks.listResearchGraphs.mockResolvedValue([persisted]);
    mocks.writeResearchGraph.mockResolvedValue(undefined);

    const runtime = await initializeResearchWorkspace();
    expect(runtime.getResearch(persisted.researchId)).toEqual(persisted);

    const created = runtime.createResearch({
      researchId: "research-written",
      title: "Written study",
      objective: "Append the new immutable graph version",
      now: 1_700_000_000_001,
    });
    await vi.waitFor(() => expect(mocks.writeResearchGraph).toHaveBeenCalledWith(created, "C:/workspace"));
    expect(mocks.writeResearchGraph).toHaveBeenCalledTimes(1);
  });
});
