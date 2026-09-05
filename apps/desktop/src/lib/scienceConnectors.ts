// Curated open-source science MCP connectors (P1-2). These are existing,
// maintained open-source MCP servers — we one-click provision them into a
// shared isolated env (bundled uv) and register them; we do not reimplement
// literature/database access ourselves. Keep this list small and vetted.
import type { McpConfig } from "@ai4s/sdk";

export interface ScienceConnector {
  /** MCP server name written into the DSH Cordis module state. */
  id: string;
  label: string;
  /** Short discipline chip, e.g. "materials", "economics". */
  discipline: string;
  description: string;
  /** Package identifier used by provisioning (PyPI for external connectors). */
  pkg: string;
  /** A connector exposed by an app-managed HTTP service rather than stdio. */
  transport?: "local" | "remote";
  /** Default endpoint for a remote connector. Managed services may override it. */
  remoteUrl?: string;
  /** App-managed service id used for provisioning and lifecycle supervision. */
  managedService?: "novomcp";
  /** Provisioning environment. Materials is intentionally isolated. */
  environment?: "science" | "materials";
  /** This connector's source is shipped with the app and installed from a bundled path. */
  bundled?: boolean;
  /** Console script the package installs (resolved next to the managed python).
   *  Preferred when set — many MCP servers ship a script, not a `-m` module. */
  bin?: string;
  /** Fallback: Python `-m` module the server runs as, plus any args. */
  module?: string;
  args?: string[];
  /** Env var the server reads its API key from (free keys; never logged). */
  apiKeyEnv?: string;
  /** Some unified connectors can use public providers without this key. */
  apiKeyOptional?: boolean;
  /** Where the user gets a free key. */
  apiKeyUrl?: string;
  /** Shown before Enable when the install is large. */
  installNote?: string;
  /** Short source/license chip. Defaults to the translated open-source label. */
  licenseLabel?: string;
  /** Precise upstream license detail shown beside the source. */
  licenseNote?: string;
  /** Upstream project, shown so users can vet it before enabling. */
  source: string;
}

export const SCIENCE_CONNECTORS: ScienceConnector[] = [
  {
    id: "paper-search",
    label: "Literature search",
    discipline: "all fields",
    description:
      "Metadata search across arXiv, PubMed/PMC, Crossref, OpenAlex, Semantic Scholar, bioRxiv/medRxiv, CORE, Europe PMC, OpenAIRE, DOAJ, BASE, Zenodo, HAL, SSRN, and more",
    pkg: "nebulamat-paper-search",
    module: "nebulamat_paper_search.server",
    bundled: true,
    installNote: "bundled governed wrapper; installs a pinned MIT upstream package",
    licenseLabel: "MIT",
    licenseNote: "NebulaMat wrapper + openags/paper-search-mcp 0.1.4",
    source: "github.com/openags/paper-search-mcp",
  },
  {
    id: "literature-ingest",
    label: "Literature knowledge ingestion",
    discipline: "all fields",
    description:
      "Parse lawful literature URLs or workspace files with MinerU, preserve complete Markdown and assets, and index them in the workspace knowledge base",
    pkg: "openscience-literature-ingest-mcp",
    module: "literature_ingest_mcp.server",
    bundled: true,
    apiKeyEnv: "MINERU_API_KEY",
    apiKeyUrl: "https://mineru.net/apiManage",
    installNote: "first-party workspace-local ingestion; MinerU precise parsing token required",
    licenseLabel: "MIT",
    source: "runtime/literature-ingest-mcp (first-party)",
  },
  {
    id: "materials-mcp",
    label: "Materials discovery",
    discipline: "materials",
    description:
      "Unified Materials Project, OQMD, AFLOW, and NOMAD search plus deterministic structure and DFT validation",
    pkg: "openscience-materials-mcp",
    module: "materials_mcp.server",
    environment: "materials",
    bundled: true,
    apiKeyEnv: "MP_API_KEY",
    apiKeyOptional: true,
    apiKeyUrl: "https://next-gen.materialsproject.org/api",
    installNote: "isolated materials environment - installs pymatgen + ASE + RDKit",
    source: "runtime/materials-mcp (first-party)",
  },
];

/** Resolve a console script that sits next to the managed python interpreter
 *  (unix: `<env>/bin/<script>`; Windows: `<env>/Scripts/<script>.exe`). */
function scriptBeside(python: string, bin: string): string {
  const sep = python.includes("\\") ? "\\" : "/";
  const dir = python.slice(0, python.lastIndexOf(sep));
  const exe = python.toLowerCase().endsWith(".exe") ? ".exe" : "";
  return `${dir}${sep}${bin}${exe}`;
}

/** Local-MCP config for a connector, given the managed interpreter path and an
 *  optional API key (passed via env, never written to provenance/logs). */
export function connectorConfig(
  c: ScienceConnector,
  python: string,
  apiKey?: string,
  remoteUrl?: string,
): McpConfig {
  if (c.transport === "remote") {
    const url = (remoteUrl ?? c.remoteUrl)?.trim();
    if (!url) throw new Error(`${c.id} remote endpoint is not configured`);
    return { type: "remote", url, enabled: true };
  }
  const command = c.bin
    ? [scriptBeside(python, c.bin)]
    : [python, "-m", c.module ?? "", ...(c.args ?? [])];
  const config: McpConfig = { type: "local", command, enabled: true };
  if (c.apiKeyEnv && apiKey && apiKey.trim()) {
    config.environment = { [c.apiKeyEnv]: apiKey.trim() };
  }
  return config;
}
