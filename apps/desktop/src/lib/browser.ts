// Browser control connector — wires the bundled agent-browser sidecar
// (github.com/vercel-labs/agent-browser) into DSH as a local MCP server.
// The desktop-side glue (sidecar path, Chrome/profile detection, Chrome
// download) lives in Rust (browser.rs); this file only shapes the MCP config.
import type { McpConfig } from "@ai4s/sdk";

/** MCP server name written into the DSH Cordis module state. */
export const BROWSER_MCP_ID = "browser-control";

/** Sentinel profile value meaning "use a separate downloaded browser, not the
 *  system Chrome" — selectable even when Chrome IS installed. */
export const PRIVATE_BROWSER = "__private__";

/** Upstream project, shown so users can vet it before enabling. */
export const BROWSER_SOURCE = "github.com/vercel-labs/agent-browser";

/** Proper display names for detected browsers (kind → brand name). */
export const BROWSER_DISPLAY_NAMES: Record<string, string> = {
  chrome: "Google Chrome",
  chromium: "Chromium",
  edge: "Microsoft Edge",
  brave: "Brave",
};

export interface BrowserMcpOptions {
  /** Absolute path to the bundled agent-browser binary (from agentBrowserBin). */
  bin: string;
  /** Chrome profile directory to reuse ("Default", "Profile 4"); empty/undefined
   *  ⇒ an isolated fresh profile (no existing logins). */
  profileDir?: string;
  /** Path to the detected system browser — reuses the user's Chrome instead of
   *  downloading Chrome for Testing (and decrypts its cookies cleanly on macOS). */
  executablePath?: string;
  /** Show a visible browser window instead of running headless. */
  headed?: boolean;
  /** Proxy URL the browser should route through (from the app proxy setting). */
  proxy?: string | null;
  /** Comma-separated agent-browser tool profile(s). Defaults to "core"
   *  (navigation, snapshots, interaction, screenshots, reads, JS eval). */
  tools?: string;
  /** Restrict browsing/reads to these domain patterns (e.g. "*.example.com").
   *  Empty ⇒ no restriction. Also disables WebRTC to prevent IP leakage. */
  allowedDomains?: string[];
}

/** Build the local-MCP config for agent-browser. Secrets never appear here —
 *  the browser reuses on-disk Chrome sessions, not stored keys. */
export function buildBrowserMcpConfig(opts: BrowserMcpOptions): McpConfig {
  const environment: Record<string, string> = {};
  if (opts.profileDir?.trim()) environment.AGENT_BROWSER_PROFILE = opts.profileDir.trim();
  if (opts.executablePath?.trim())
    environment.AGENT_BROWSER_EXECUTABLE_PATH = opts.executablePath.trim();
  if (opts.headed) environment.AGENT_BROWSER_HEADED = "true";
  if (opts.proxy?.trim()) environment.AGENT_BROWSER_PROXY = opts.proxy.trim();
  const domains = (opts.allowedDomains ?? []).map((d) => d.trim()).filter(Boolean);
  if (domains.length > 0) environment.AGENT_BROWSER_ALLOWED_DOMAINS = domains.join(",");

  const config: McpConfig = {
    type: "local",
    command: [opts.bin, "mcp", "--tools", opts.tools?.trim() || "core"],
    enabled: true,
  };
  if (Object.keys(environment).length > 0) config.environment = environment;
  return config;
}
