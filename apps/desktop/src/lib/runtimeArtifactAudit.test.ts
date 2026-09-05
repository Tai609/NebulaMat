import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordProvenance: vi.fn<() => Promise<boolean>>(),
  recordRun: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("./tauri", () => ({ isTauri: true, logDebug: vi.fn(async () => {}) }));
vi.mock("./provenance", () => ({
  provenanceInputsFromEvent: (event: { callId: string }) => [{
    eventId: `${event.callId}:result.json`,
    path: "result.json",
    tool: "write",
    log: "write -> result.json",
  }],
  recordProvenance: mocks.recordProvenance,
}));
vi.mock("./runs", () => ({
  runInputFromEvent: () => null,
  recordRun: mocks.recordRun,
}));

import { recordRuntimeToolArtifacts } from "./runtimeArtifactAudit";

describe("runtime artifact audit outbox", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    mocks.recordProvenance.mockReset();
    mocks.recordRun.mockReset();
  });

  it("keeps a failed append durable and retries the same source event", async () => {
    mocks.recordProvenance.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    recordRuntimeToolArtifacts({
      type: "tool.updated",
      sessionId: "session-1",
      callId: "call-1",
      tool: "write",
      status: "success",
    }, "session-1", "deepseek/model");

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recordProvenance).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("openscience.runtime-audit-outbox.v1")).toContain("call-1:result.json");

    await vi.advanceTimersByTimeAsync(600);
    expect(mocks.recordProvenance).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("openscience.runtime-audit-outbox.v1")).toBe("[]");
  });
});

