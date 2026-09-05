import type { AgentRuntime } from "./runtime";

/** Runtime extension context exposed to modular harness plugins. */
export interface HarnessPluginContext {
  /** The runtime instance being extended. */
  readonly runtime: AgentRuntime;
  /** Process-local metadata shared by plugins without coupling them together. */
  readonly metadata: ReadonlyMap<string, unknown>;
  /** Publish metadata for later plugins. */
  setMetadata(key: string, value: unknown): void;
}

/** A disposable extension mounted into the DeepSeek Harness host. */
export interface HarnessPlugin {
  /** Stable id used for diagnostics and duplicate detection. */
  readonly id: string;
  /** Mount the plugin and optionally return its disposer. */
  install(context: HarnessPluginContext): void | (() => void | Promise<void>);
}

/**
 * Small lifecycle host shared by every runtime implementation. The host keeps
 * extension ownership explicit: a plugin is installed once and disposed in
 * reverse order when the runtime closes.
 */
export class HarnessPluginHost {
  private readonly entries = new Map<string, () => void | Promise<void>>();
  private readonly values = new Map<string, unknown>();
  private closed = false;

  /** Mount one plugin. Duplicate ids are rejected to keep composition deterministic. */
  use(plugin: HarnessPlugin, runtime: AgentRuntime): () => Promise<void> {
    if (this.closed) throw new Error("cannot install a plugin after harness close");
    if (this.entries.has(plugin.id)) throw new Error(`harness plugin already installed: ${plugin.id}`);
    const context: HarnessPluginContext = {
      runtime,
      metadata: this.values,
      setMetadata: (key, value) => this.values.set(key, value),
    };
    const disposer = plugin.install(context);
    const dispose = async () => {
      if (!this.entries.delete(plugin.id)) return;
      await disposer?.();
    };
    this.entries.set(plugin.id, dispose);
    return dispose;
  }

  /** Dispose all mounted plugins in reverse installation order. */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const disposers = [...this.entries.values()].reverse();
    this.entries.clear();
    for (const dispose of disposers) await dispose();
    this.values.clear();
  }

  /** List mounted plugin ids for diagnostics and health reporting. */
  ids(): string[] {
    return [...this.entries.keys()];
  }
}

/** Core plugin marker for the DeepSeek Harness composition. */
export const coreHarnessPlugin: HarnessPlugin = {
  id: "dsh-core",
  install: ({ setMetadata }) => {
    setMetadata("harness", "deepseek-harness");
    setMetadata("architecture", "cordis-plugin-composition");
  },
};

/** @deprecated DSH is the production runtime; retained only for old SDK hosts. */
export const opencodeCompatibilityPlugin: HarnessPlugin = {
  id: "opencode-compat",
  install: ({ setMetadata }) => {
    setMetadata("compatibility", "opencode-http-sse");
  },
};
