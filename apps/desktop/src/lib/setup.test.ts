// The setup store owns the long-running uv provisioning flows so they survive
// page navigation. These guard the two properties that broke before: a second
// concurrent start must not race the first into the same env dir, and the
// busy/generation lifecycle must be observable regardless of which page reads.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setDshMcpServer: vi.fn(async () => {}),
  loadCatalog: vi.fn(async () => {}),
  /** Resolves ⇒ an entry existed and was removed; rejects ⇒ nothing to remove. */
  removeDshMcpServer: vi.fn(async () => {}),
  agentBrowserBin: vi.fn(async () => "/bin/agent-browser"),
  detectChrome: vi.fn(async () => ({ path: "/Chrome", kind: "chrome" })),
  getProxySetting: vi.fn(async () => ({ effective: null })),
  /** Resolver for the in-flight setupJupyter promise, so tests hold it open. */
  resolveSetup: (() => {}) as () => void,
  setupJupyter: vi.fn(),
  setupScienceMcp: vi.fn(async () => "/env/bin/python"),
  setupMaterialsMcp: vi.fn(async () => "/materials-env/bin/python"),
  setupNovoMcp: vi.fn(async () => {}),
  startNovoMcp: vi.fn(async () => ({
    installed: true,
    running: true,
    url: "http://127.0.0.1:4567",
    mcp_url: "http://127.0.0.1:4567/mcp/",
  })),
}));

mocks.setupJupyter.mockImplementation(
  () => new Promise<void>((r) => (mocks.resolveSetup = () => r())),
);

vi.mock("./runtime", () => ({
  getClient: () => ({}),
  useRuntimeStore: {
    getState: () => ({ loadCatalog: mocks.loadCatalog }),
  },
}));
vi.mock("./tauri", () => ({
  setupJupyter: mocks.setupJupyter,
  startJupyter: async () => ({
    url: "http://127.0.0.1:9",
    token: "tok",
    mcp_command: "/env/bin/jupyter-mcp-server",
  }),
  setupScienceMcp: mocks.setupScienceMcp,
  setupMaterialsMcp: mocks.setupMaterialsMcp,
  setupNovoMcp: mocks.setupNovoMcp,
  startNovoMcp: mocks.startNovoMcp,
  watchSetupProgress: async () => () => {},
  setDshMcpServer: mocks.setDshMcpServer,
  removeDshMcpServer: mocks.removeDshMcpServer,
  agentBrowserBin: mocks.agentBrowserBin,
  detectChrome: mocks.detectChrome,
  getProxySetting: mocks.getProxySetting,
}));
vi.mock("./scienceConnectors", () => ({
  SCIENCE_CONNECTORS: [
    { id: "papers", label: "Papers", pkg: "nebulamat-paper-search", bundled: true },
    { id: "literature-ingest", label: "Literature", pkg: "openscience-literature-ingest-mcp", bundled: true },
    { id: "materials-mcp", label: "Materials", pkg: "openscience-materials-mcp", environment: "materials", bundled: true },
    { id: "novomcp", label: "NovoMCP", pkg: "novomcp", transport: "remote", managedService: "novomcp" },
  ],
  connectorConfig: (c: { transport?: string }, _python: string, _apiKey?: string, remoteUrl?: string) =>
    c.transport === "remote"
      ? { type: "remote", url: remoteUrl, enabled: true }
      : { type: "local", command: ["/env/bin/python"], enabled: true },
}));
vi.mock("./toast", () => ({ toast: { success: () => {}, error: () => {} } }));

import { useSetupStore } from "./setup";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setupJupyter.mockImplementation(
    () => new Promise<void>((r) => (mocks.resolveSetup = () => r())),
  );
  useSetupStore.setState({ jupyterBusy: false, connectorId: null, line: null, generation: 0 });
});

describe("setup store", () => {
  it("marks busy while provisioning Jupyter and clears + bumps generation after", async () => {
    const gen0 = useSetupStore.getState().generation;
    const run = useSetupStore.getState().enableJupyter();
    expect(useSetupStore.getState().jupyterBusy).toBe(true); // set synchronously

    mocks.resolveSetup();
    await run;

    const s = useSetupStore.getState();
    expect(s.jupyterBusy).toBe(false);
    expect(s.line).toBeNull();
    expect(s.generation).toBe(gen0 + 1);
    expect(mocks.setDshMcpServer).toHaveBeenCalledWith("jupyter", expect.anything());
  });

  it("ignores a second concurrent enableJupyter — no colliding provisioning run", async () => {
    const p1 = useSetupStore.getState().enableJupyter();
    const p2 = useSetupStore.getState().enableJupyter(); // guarded: returns at once
    await p2; // the guarded call resolves without waiting on the first
    expect(mocks.setupJupyter).toHaveBeenCalledTimes(1);

    mocks.resolveSetup();
    await p1;
    expect(mocks.setupJupyter).toHaveBeenCalledTimes(1);
  });

  it("tracks the connector being provisioned and clears it when done", async () => {
    const run = useSetupStore.getState().enableConnector("papers", "key123");
    expect(useSetupStore.getState().connectorId).toBe("papers");
    await run;
    expect(useSetupStore.getState().connectorId).toBeNull();
    expect(mocks.setDshMcpServer).toHaveBeenCalledWith("papers", expect.anything());
    expect(mocks.setupScienceMcp).toHaveBeenCalledWith("nebulamat-paper-search");
    expect(mocks.setupMaterialsMcp).not.toHaveBeenCalled();
  });

  it("provisions the materials connector in its dedicated environment", async () => {
    await useSetupStore.getState().enableConnector("materials-mcp", "mp-key");
    expect(mocks.setupMaterialsMcp).toHaveBeenCalledTimes(1);
    expect(mocks.setupScienceMcp).not.toHaveBeenCalled();
    expect(mocks.setDshMcpServer).toHaveBeenCalledWith("materials-mcp", expect.anything());
  });

  it("provisions the bundled literature-ingest connector in the shared science environment", async () => {
    await useSetupStore.getState().enableConnector("literature-ingest", "mineru-key");
    expect(mocks.setupScienceMcp).toHaveBeenCalledWith("openscience-literature-ingest-mcp");
    expect(mocks.setupMaterialsMcp).not.toHaveBeenCalled();
    expect(mocks.setDshMcpServer).toHaveBeenCalledWith("literature-ingest", expect.anything());
  });

  it("provisions, starts, and registers NovoMCP as a remote HTTP server", async () => {
    await useSetupStore.getState().enableConnector("novomcp");

    expect(mocks.setupNovoMcp).toHaveBeenCalledTimes(1);
    expect(mocks.startNovoMcp).toHaveBeenCalledTimes(1);
    expect(mocks.setupScienceMcp).not.toHaveBeenCalled();
    expect(mocks.setDshMcpServer).toHaveBeenCalledWith("novomcp", {
      type: "remote",
      url: "http://127.0.0.1:4567/mcp/",
      enabled: true,
    });
  });

  // The config PATCH deep-merges the nested `environment`, so a re-add can only
  // add/overwrite keys, never drop one. Turning "Show the browser window" off
  // just omits AGENT_BROWSER_HEADED — the merge would keep the stale "true".
  // Removing the entry first (then re-adding) rewrites the environment clean.
  it("rewrites the browser entry from scratch on reconfigure — removes before re-adding", async () => {
    await useSetupStore.getState().enableBrowser({ headed: false, useSystemChrome: true });

    expect(mocks.removeDshMcpServer).toHaveBeenCalledWith("browser-control");
    // Remove must precede the re-add, or a stale Cordis row could remain.
    expect(mocks.removeDshMcpServer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setDshMcpServer.mock.invocationCallOrder[0],
    );
    // The freshly written config carries no headed flag → it starts headless.
    const calls = mocks.setDshMcpServer.mock.calls as unknown as Array<
      [string, { environment?: Record<string, string> }]
    >;
    const [, config] = calls[calls.length - 1];
    expect(config.environment?.AGENT_BROWSER_HEADED).toBeUndefined();
  });

  it("first enable has no entry to remove — skips the sidecar wait, still adds", async () => {
    mocks.removeDshMcpServer.mockRejectedValueOnce(new Error("not configured"));

    await useSetupStore.getState().enableBrowser({ headed: true, useSystemChrome: true });

    expect(mocks.setDshMcpServer).toHaveBeenCalledWith("browser-control", expect.anything());
  });
});
