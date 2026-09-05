import { afterEach, describe, expect, it, vi } from "vitest";

const tauriCore = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriCore);

describe("refreshModelCatalog", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    tauriCore.invoke.mockReset();
    vi.resetModules();
  });

  it("invokes the desktop model catalog refresh command", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const result = {
      changed: true,
      restarted: true,
      source: "https://models.dev/api.json + https://opencode.ai/zen/go/v1/models",
      routeCount: 12,
      modelCount: 48,
    };
    tauriCore.invoke.mockResolvedValue(result);

    const { refreshModelCatalog } = await import("./tauri");

    await expect(refreshModelCatalog()).resolves.toEqual(result);
    expect(tauriCore.invoke).toHaveBeenCalledOnce();
    expect(tauriCore.invoke).toHaveBeenCalledWith("refresh_model_catalog");
  });
});
