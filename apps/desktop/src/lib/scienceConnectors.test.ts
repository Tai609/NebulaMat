import { describe, expect, it } from "vitest";
import { SCIENCE_CONNECTORS, connectorConfig } from "./scienceConnectors";

const byId = (id: string) => {
  const c = SCIENCE_CONNECTORS.find((x) => x.id === id);
  if (!c) throw new Error(`no connector ${id}`);
  return c;
};

describe("connectorConfig", () => {
  it("launches NebulaMat's governed paper-search wrapper", () => {
    const cfg = connectorConfig(byId("paper-search"), "/env/bin/python");
    expect(cfg).toMatchObject({
      type: "local",
      command: ["/env/bin/python", "-m", "nebulamat_paper_search.server"],
      enabled: true,
    });
    expect(byId("paper-search")).toMatchObject({
      pkg: "nebulamat-paper-search",
      bundled: true,
      licenseLabel: "MIT",
    });
    expect(cfg.type === "local" && cfg.environment).toBeUndefined();
  });

  it("launches the bundled materials MCP module in its isolated interpreter", () => {
    const cfg = connectorConfig(byId("materials-mcp"), "/env/bin/python");
    expect(cfg.type === "local" && cfg.command).toEqual([
      "/env/bin/python",
      "-m",
      "materials_mcp.server",
    ]);
  });

  it("passes an API key via environment, trimmed", () => {
    const cfg = connectorConfig(byId("materials-mcp"), "/env/bin/python", "  mp-secret  ");
    expect(cfg.type === "local" && cfg.environment).toEqual({ MP_API_KEY: "mp-secret" });
  });

  it("injects the MinerU token only into the literature-ingest environment", () => {
    const connector = byId("literature-ingest");
    const cfg = connectorConfig(connector, "/env/bin/python", "  mineru-secret  ");
    expect(cfg).toEqual({
      type: "local",
      command: ["/env/bin/python", "-m", "literature_ingest_mcp.server"],
      enabled: true,
      environment: { MINERU_API_KEY: "mineru-secret" },
    });
    expect(connector).toMatchObject({
      pkg: "openscience-literature-ingest-mcp",
      bundled: true,
      apiKeyUrl: "https://mineru.net/apiManage",
    });
  });

  it("every connector declares an id, discipline, package, and a launch path", () => {
    for (const c of SCIENCE_CONNECTORS) {
      expect(c.id && c.discipline && c.pkg && c.source).toBeTruthy();
      if (c.transport === "remote") {
        expect(Boolean(c.remoteUrl) || Boolean(c.managedService)).toBe(true);
      } else {
        expect(Boolean(c.bin) || Boolean(c.module)).toBe(true);
      }
      if (c.apiKeyEnv) expect(c.apiKeyUrl).toBeTruthy(); // key-needing → tell users where to get one
    }
  });

  it("keeps the packaged connector catalog limited to materials and literature", () => {
    expect(SCIENCE_CONNECTORS.map((c) => c.id)).toEqual([
      "paper-search",
      "literature-ingest",
      "materials-mcp",
    ]);
  });
});
