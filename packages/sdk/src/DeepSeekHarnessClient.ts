import { BaseAgentRuntime } from "./base-runtime";
import { stableEventId } from "@ai4s/shared";
import type { AgentRuntime } from "./runtime";
import type {
  AgentInfo,
  CommandInfo,
  HistoryMessage,
  RuntimeMessageEvent,
  RuntimeCapabilities,
  PermissionAskedEvent,
  PermissionReply,
  ProviderAuthMethod,
  ProviderCatalogEntry,
  ProviderInfo,
  OAuthAuthorization,
  QuestionAskedEvent,
  McpServer,
  SessionMeta,
  SubagentInfo,
  CostMeterActionResult,
  CostMeterState,
  ContextUsage,
  SessionPage,
  SessionQuery,
  SkillInfo,
} from "./types";
import { HarnessPluginHost, coreHarnessPlugin } from "./plugins";

export interface DeepSeekHarnessClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocket;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  directory?: string;
  password?: string;
  username?: string;
}

type RpcResult = { ok: true; value: unknown } | { ok: false; error?: { message?: string; code?: string } };
type RpcResponse = { type?: string; rpcId?: string; result?: RpcResult };
type DshFrame = { type?: string; rpcId?: string; method?: string; payload?: unknown };
type RecordValue = Record<string, unknown>;

const DEFAULT_DSH_URL = "http://127.0.0.1:4096";
const STREAM_RECONNECT_ATTEMPTS = 8;
const STREAM_RECONNECT_INITIAL_DELAY_MS = 250;
const STREAM_RECONNECT_MAX_DELAY_MS = 4_000;

/** Provider ids owned by the bundled DSH profile. They remain reserved for
 * custom-provider creation, but the bundled route itself is configurable: the
 * user must be able to enter its credential and choose one of its models. */
export const APPLICATION_OWNED_PROVIDER_IDS = ["deepseek-official"] as const;

export function isApplicationOwnedProvider(providerID: string): boolean {
  return (APPLICATION_OWNED_PROVIDER_IDS as readonly string[]).includes(providerID);
}

export function isApplicationOwnedModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const slash = model.indexOf("/");
  return isApplicationOwnedProvider(slash > 0 ? model.slice(0, slash) : model);
}

// DSH's prompt contract currently has no system-message field. Keep the
// client instruction in a clearly delimited suffix so the model receives it,
// while history restoration can remove it from the user-visible transcript.
const LANGUAGE_POLICY_START = "\n\n[NEBULAMAT_INTERNAL_LANGUAGE_POLICY]\n";
const LANGUAGE_POLICY_END = "\n[/NEBULAMAT_INTERNAL_LANGUAGE_POLICY]";
const RESEARCH_CONTEXT_START = "\n\n[NEBULAMAT_INTERNAL_RESEARCH_CONTEXT]\n";
const RESEARCH_CONTEXT_END = "\n[/NEBULAMAT_INTERNAL_RESEARCH_CONTEXT]";
const KNOWLEDGE_CONTEXT_START = "\n\n[NEBULAMAT_INTERNAL_KNOWLEDGE_CONTEXT]\n";
const KNOWLEDGE_CONTEXT_END = "\n[/NEBULAMAT_INTERNAL_KNOWLEDGE_CONTEXT]";
const DEEP_RESEARCH_CONTEXT_START = "\n\n[NEBULAMAT_INTERNAL_DEEP_RESEARCH]\n";
const DEEP_RESEARCH_CONTEXT_END = "\n[/NEBULAMAT_INTERNAL_DEEP_RESEARCH]";
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English (en)",
  "zh-Hans": "Simplified Chinese (zh-Hans)",
  ja: "Japanese (ja)",
  es: "Spanish (es)",
  de: "German (de)",
  fr: "French (fr)",
  ko: "Korean (ko)",
  "pt-BR": "Brazilian Portuguese (pt-BR)",
  ar: "Arabic (ar)",
};

const BROWSER_TOOL_POLICY = `Web research policy (highest priority):
- Never call the built-in web_search or web_fetch tools; they are disabled in this application.
- For current web information, use the browser-control MCP tools exposed by the project, such as mcp__browser-control__agent_browser_open, mcp__browser-control__agent_browser_snapshot, mcp__browser-control__agent_browser_read, and the related interaction tools.
- If browser-control is unavailable, tell the user to enable it in Settings > Browser. Do not fall back to web_search, web_fetch, or a direct search provider.`;

/** AgentRuntime adapter for the DeepSeek Harness Web/API contract. */
export class DeepSeekHarnessClient extends BaseAgentRuntime implements AgentRuntime {
  readonly runtimeId = "deepseek-harness" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly directory: string | null;
  private readonly bearerToken: string | null;
  private readonly plugins = new HarnessPluginHost();
  private abort: AbortController | null = null;
  private connecting: Promise<void> | null = null;
  private reconnecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectWake: (() => void) | null = null;
  private closed = false;
  private activeSessionId: string | null = null;
  /** Sessions created through the user-facing API during this client
   * lifetime. DSH reports a freshly-created session as `blank` until its
   * first user message is persisted; keep that optimistic session visible so
   * the desktop refresh/prune pass cannot remove the pane while the first
   * prompt is being sent. */
  private readonly userSessionIds = new Set<string>();
  /** DSH scopes a few discovery RPCs to a session. Keep one blank carrier
   * across catalog calls, including concurrent calls, instead of creating a
   * new empty conversation every time the client reconnects or reloads. */
  private carrierSessionId: string | null = null;
  private carrierSessionPromise: Promise<string> | null = null;
  private skillSessionPromise: Promise<string> | null = null;
  private defaultModel: string | null = null;
  private readonly pending = new Map<string, {
    sessionId: string;
    kind: "question" | "permission";
    approvalId?: string;
    questions?: RecordValue[];
    tool?: string;
    input?: RecordValue;
  }>();
  private readonly sessionTitles = new Map<string, string>();
  /** Tool-call headers arrive before their results on the mux stream. */
  private readonly toolCalls = new Map<string, {
    tool: string;
    input?: RecordValue;
    childSessionId?: string;
  }>();
  /** DSH streams deltas; the app contract emits full values under stable ids. */
  private readonly chunks = new Map<string, string>();
  /** Once a reasoning part is identified as a public action update, keep the
   *  remainder of that part out of the private reasoning lane. DSH can split a
   *  single sentence across token-sized deltas, so classifying only the latest
   *  delta would otherwise leak the first few words into a folded thought. */
  private readonly publicProgressParts = new Set<string>();
  /** A committed text-only assistant block may still be a tool preface on old
   *  DSH logs where the following tool/call is stored as a separate event. */
  private readonly candidateTexts = new Map<string, { partId: string; text: string }>();
  /** DSH keeps archive state in the workspace module rather than on the
   * session summary itself. Cache the authoritative ids so the generic
   * session query contract can still filter active and archived rows. */
  private archivedSessions = new Set<string>();
  private readonly contextUsage = new Map<string, ContextUsage>();
  private readonly compactedIds = new Set<string>();

  constructor(options: DeepSeekHarnessClientOptions = {}) {
    super();
    this.baseUrl = (options.baseUrl ?? DEFAULT_DSH_URL).replace(/\/$/, "");
    this.fetchImpl = (options.fetchImpl ?? globalThis.fetch).bind(globalThis);
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    // Startup connects to a loopback bridge. A short probe lets the desktop
    // retry while the sidecar warms instead of parking the UI on one long
    // request timeout. Established stream recovery uses the same bounded probe.
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20000;
    this.directory = options.directory ?? null;
    this.bearerToken = options.password?.trim() || null;
    this.plugins.use(coreHarnessPlugin, this);
  }

  pluginIds(): string[] { return this.plugins.ids(); }

  /** The DSH core contract, including explicit unsupported operations. */
  getCapabilities(): RuntimeCapabilities {
    return {
      runtime: "dsh",
      // DSH does not expose destructive session deletion. The UI's delete
      // action is implemented as a durable archive (the same user-visible
      // behavior as removing a conversation from the active history).
      sessions: { create: true, archive: true, unarchive: false, delete: true, revert: true, fork: true },
      interaction: { questions: true, permissions: true, persistentRules: false },
      configuration: { providers: true, oauth: false, mcp: false },
      // DSH's server-side governance plugin is the authoritative pre-dispatch
      // boundary. The adapter still mirrors decisions for UI/audit purposes.
      execution: { shell: true, commands: true, toolAdmission: "server" },
      surfaces: { desktop: true, web: true, readOnlyWeb: true },
    };
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("DeepSeek Harness client is closed");
    if (this.getStatus() === "ready") return;
    if (this.connecting) return this.connecting;
    if (this.reconnecting) return this.reconnecting;
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  close(): void {
    this.closed = true;
    this.cancelReconnect();
    this.abort?.abort();
    this.abort = null;
    this.setStatus("offline");
    void this.plugins.dispose();
  }

  async createSession(title?: string, parentId?: string): Promise<string> {
    const value = parentId
      ? await this.call("session.fork", { sessionId: parentId })
      : await this.call("session.create", {
          ...(this.directory ? { cwd: this.directory } : {}),
        });
    const result = asRecord(value);
    const id = stringAt(result, "sessionId") ?? stringAt(result, "id");
    if (!id) throw new Error(`DSH ${parentId ? "session.fork" : "session.create"} returned no sessionId`);
    this.userSessionIds.add(id);
    this.activeSessionId = id;
    if (title) await this.renameSession(id, title);
    return id;
  }

  private async sessionRows(): Promise<RecordValue[]> {
    const value = asRecord(await this.call("session.list", {}));
    return (Array.isArray(value.items) ? value.items : [])
      .map(asRecord)
      .filter((row) => !!sessionRowId(row));
  }

  /** Return a session id for DSH RPCs that require one even before the user has
   * opened a conversation. Reuse an existing blank session from this workspace
   * first; the server's session list is authoritative across client rebuilds. */
  private async ensureCarrierSession(existingRows?: RecordValue[]): Promise<string> {
    if (this.activeSessionId) return this.activeSessionId;
    if (this.carrierSessionId) {
      return this.carrierSessionId;
    }
    if (this.carrierSessionPromise) return this.carrierSessionPromise;

    const promise = (async () => {
      const rows = existingRows ?? await this.sessionRows();
      // A user can create the first real conversation while the discovery
      // list is in flight. Do not create a carrier after that conversation
      // has become active.
      if (this.activeSessionId) return this.activeSessionId;
      if (this.carrierSessionId) {
        return this.carrierSessionId;
      }
      const existing = rows
        .filter((row) => sessionRowIsBlank(row) && this.sessionRowMatchesDirectory(row))
        .map(sessionRowId)
        .find((id): id is string => !!id);
      // Do not go through the public createSession() path here. A discovery
      // carrier is an implementation detail and must never become the
      // desktop's active/user session or participate in the user send
      // lifecycle.
      const id = existing ?? await this.createInternalSession();
      this.carrierSessionId = id;
      return id;
    })();
    this.carrierSessionPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.carrierSessionPromise === promise) this.carrierSessionPromise = null;
    }
  }

  private async createInternalSession(): Promise<string> {
    const value = await this.call("session.create", {
      ...(this.directory ? { cwd: this.directory } : {}),
    });
    const result = asRecord(value);
    const id = stringAt(result, "sessionId") ?? stringAt(result, "id");
    if (!id) throw new Error("DSH session.create returned no sessionId");
    return id;
  }

  /** Skill discovery is read-only, so an existing real session is a better
   * carrier than creating an empty one. Fall back to the reusable blank carrier
   * only on a genuinely fresh profile with no sessions at all. */
  private async ensureSkillSession(): Promise<string> {
    if (this.activeSessionId) return this.activeSessionId;
    if (this.skillSessionPromise) return this.skillSessionPromise;
    const promise = (async () => {
      const rows = await this.sessionRows();
      const existing = rows
        .filter((row) => !sessionRowIsBlank(row) && this.sessionRowMatchesDirectory(row))
        .map(sessionRowId)
        .find((id): id is string => !!id);
      return existing ?? this.ensureCarrierSession(rows);
    })();
    this.skillSessionPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.skillSessionPromise === promise) this.skillSessionPromise = null;
    }
  }

  private sessionRowMatchesDirectory(row: RecordValue): boolean {
    const rowDirectory = stringAt(row, "cwd") ?? stringAt(row, "directory");
    if (!this.directory || !rowDirectory) return true;
    return normalizeSessionDirectory(rowDirectory) === normalizeSessionDirectory(this.directory);
  }

  async listSessions(): Promise<SessionMeta[]> {
    const page = await this.querySessions({ limit: 200 });
    return page.sessions;
  }

  async listSubagents(parentSessionId: string): Promise<SubagentInfo[]> {
    const value = asRecord(await this.call("subagent.list", { parentSessionId }));
    const entries = Array.isArray(value.entries) ? value.entries : [];
    return entries
      .map((entry) => asRecord(entry))
      .filter((entry) => entry.kind === "child" && typeof entry.id === "string")
      .map((entry) => ({
        id: String(entry.id),
        mode: entry.mode === "continuable" ? "continuable" : "one-shot",
        activity: entry.activity === "running" ? "running" : "inactive",
        ...(typeof entry.label === "string" && entry.label ? { label: entry.label } : {}),
        ...(typeof entry.hasChildren === "boolean" ? { hasChildren: entry.hasChildren } : {}),
      }));
  }

  async getCostMeterState(): Promise<CostMeterState> {
    return await this.call("costMeter/getState", { args: {} }) as CostMeterState;
  }

  async updateCostMeterConfig(patch: Record<string, unknown>): Promise<CostMeterState> {
    return await this.call("costMeter/updateConfig", { args: { patch } }) as CostMeterState;
  }

  async fetchCostMeterPrices(): Promise<CostMeterActionResult> {
    return await this.call("costMeter/fetchPrices", { args: {} }) as CostMeterActionResult;
  }

  async refreshCostMeterBalance(): Promise<CostMeterActionResult> {
    return await this.call("costMeter/refreshBalance", { args: {} }) as CostMeterActionResult;
  }

  async refreshCostMeterGoQuota(): Promise<CostMeterActionResult> {
    return await this.call("costMeter/refreshGoQuota", { args: {} }) as CostMeterActionResult;
  }

  async resetCostMeterHistory(): Promise<CostMeterState> {
    return await this.call("costMeter/resetHistory", { args: {} }) as CostMeterState;
  }

  async querySessions(query: SessionQuery = {}): Promise<SessionPage> {
    const [rawValue, workspace] = await Promise.all([
      this.call("session.list", {}),
      this.call("workspace.list", {}).catch(() => null),
    ]);
    const value = asRecord(rawValue);
    const workspaceRecord = asRecord(workspace);
    const archivedIds = Array.isArray(workspaceRecord.archivedSessionIds)
      ? workspaceRecord.archivedSessionIds.filter((id): id is string => typeof id === "string")
      : [];
    if (archivedIds.length > 0 || workspace !== null) {
      this.archivedSessions = new Set(archivedIds);
    }
    const rows = Array.isArray(value.items) ? value.items : [];
    const sessions = rows
      .map((row) => asRecord(row))
      // Carrier sessions exist only to satisfy scoped DSH discovery RPCs. They
      // have no user-authored turn and must never appear as conversations.
      .filter((row) => {
        const id = sessionRowId(row);
        // Only hide known discovery carriers. A real session can legitimately
        // be blank for the short interval between session.create and the first
        // prompt; retaining user-created ids prevents refreshSessions() from
        // pruning its live pane and making the turn appear terminated.
        return !sessionRowIsBlank(row) || (id ? this.userSessionIds.has(id) : false);
      })
      .map((row) => sessionMeta(row))
      .filter((s): s is SessionMeta => !!s);
    const filtered = sessions
      .filter((s) => query.archived
        ? this.archivedSessions.has(s.id) || s.archived != null
        : !this.archivedSessions.has(s.id) && s.archived == null)
      .filter((s) => !query.topLevelOnly || !s.parentId)
      .filter((s) => !query.search || s.title.toLowerCase().includes(query.search.toLowerCase()))
      .sort((a, b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0));
    const limit = query.limit ?? 200;
    return { sessions: filtered.slice(0, limit), nextCursor: null };
  }

  async setSessionArchived(sessionId: string, archived: boolean): Promise<void> {
    if (!archived) throw unsupported("DSH has no unarchive RPC; restore is an explicit workspace module operation");
    const value = asRecord(await this.call("workspace.archiveSession", { sessionId }));
    const ids = Array.isArray(value.archivedSessionIds)
      ? value.archivedSessionIds.filter((id): id is string => typeof id === "string")
      : [];
    this.archivedSessions = new Set(ids);
  }

  async deleteSession(sessionId: string): Promise<void> {
    // DSH intentionally retains session logs and files. Archive is its
    // supported durable removal operation and keeps the action recoverable
    // from the archived-history view.
    await this.setSessionArchived(sessionId, true);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const value = await this.call("session.rename", { sessionId, title });
    this.sessionTitles.set(sessionId, stringAt(asRecord(value), "title") ?? title);
  }

  async getMessages(sessionId: string): Promise<HistoryMessage[]> {
    this.activeSessionId = sessionId;
    const value = asRecord(await this.call("session.history", { sessionId, maxMessages: 200 }));
    this.cacheContextUsage(sessionId, value);
    const entries = Array.isArray(value.events) ? value.events : [];
    // Some DSH deployments put the sequence on the history row wrapper while
    // others put it on the nested event. Preserve either shape: revert needs a
    // durable sequence anchor and must never guess one from array position.
    const normalizedEvents = entries.map((entry) => {
      const wrapper = asRecord(entry);
      const event = asRecord(wrapper.event ?? entry);
      return event.seq === undefined && typeof wrapper.seq === "number"
        ? { ...event, seq: wrapper.seq }
        : event;
    });
    const messages = historyMessages(normalizedEvents);
    const plan = asRecord(asRecord(asRecord(value.projections).values).plan);
    if (typeof plan.active === "boolean" || typeof plan.pending === "boolean") {
      const mode = plan.active === true || plan.pending === true ? "plan" : "build";
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role !== "user") continue;
        messages[index].agent = mode;
        break;
      }
    }
    return messages;
  }

  async getContextUsage(sessionId: string): Promise<ContextUsage | null> {
    const value = asRecord(await this.call("session.history", { sessionId, maxMessages: 200 }));
    return this.cacheContextUsage(sessionId, value);
  }

  private cacheContextUsage(sessionId: string, value: RecordValue): ContextUsage | null {
    const projections = asRecord(value.projections);
    const values = asRecord(projections.values);
    const pressure = asRecord(values.contextPressure);
    const breakdown = asRecord(values.contextBreakdown);
    const rawUsage = asRecord(values.tokenUsage);
    const numberAt = (record: RecordValue, key: string): number | undefined =>
      typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] as number : undefined;
    const projectedTokens = numberAt(pressure, "projectedTokens");
    const pressureTokens = numberAt(pressure, "pressureTokens");
    const contextWindow = numberAt(pressure, "contextWindow");
    const systemTokens = numberAt(breakdown, "systemTokens");
    const toolsTokens = numberAt(breakdown, "toolsTokens");
    const messageTokens = numberAt(breakdown, "messageTokens");
    const tokenUsage = Object.fromEntries(Object.entries(rawUsage).filter(([, raw]) => typeof raw === "number" && Number.isFinite(raw))) as Record<string, number>;
    const hasData = [projectedTokens, pressureTokens, contextWindow, systemTokens, toolsTokens, messageTokens].some((item) => item !== undefined)
      || Object.keys(tokenUsage).length > 0;
    if (!hasData) {
      this.contextUsage.delete(sessionId);
      return null;
    }
    const usage: ContextUsage = {
      ...(projectedTokens !== undefined || pressureTokens !== undefined
        ? { usedTokens: projectedTokens ?? pressureTokens }
        : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(pressureTokens !== undefined ? { pressureTokens } : {}),
      ...(projectedTokens !== undefined ? { projectedTokens } : {}),
      ...(systemTokens !== undefined ? { systemTokens } : {}),
      ...(toolsTokens !== undefined ? { toolsTokens } : {}),
      ...(messageTokens !== undefined ? { messageTokens } : {}),
      ...(Object.keys(tokenUsage).length > 0 ? { tokenUsage } : {}),
      estimated: true,
      ...(typeof projections.asOfSeq === "number" ? { asOfSeq: projections.asOfSeq } : {}),
    };
    this.contextUsage.set(sessionId, usage);
    return usage;
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    agent?: string,
    model?: string | null,
    variant?: string | null,
    language?: string | null,
  ): Promise<void> {
    await this.connect();
    if (model) await this.selectModel(sessionId, model, variant);
    this.activeSessionId = sessionId;
    this.emit({ type: "turn.started", sessionId });
    // DSH plan mode is a command/plugin state, not an OpenCode-style per-turn
    // agent field. Prefixing the prompt preserves the UI's plan/build switch
    // while keeping the actual wire request within the DSH contract.
    const prompt = agent === "plan" && !/^\/plan(?:\s|$)/.test(text)
      ? `/plan ${text}`
      : text;
    // `! command` is a DSH shell shortcut, not a model turn. Keep the exact
    // command payload so the shortcut parser never receives policy text as an
    // extra shell argument.
    const promptText = /^!\s/.test(prompt) ? prompt : appendLanguagePolicy(prompt, language);
    await this.call("session.prompt", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: promptText }],
    });
  }

  async steerSession(sessionId: string, text: string, language?: string | null): Promise<void> {
    const content = text.trim();
    if (!content) throw new Error("Steering message cannot be empty");
    await this.connect();
    this.activeSessionId = sessionId;
    // DSH's steer mode is an inbox for the next model step. It is not a turn
    // lifecycle event and must never emit `turn.started` or touch running locks.
    await this.call("session.prompt", {
      sessionId,
      mode: "steer",
      content: [{ type: "text", text: appendLanguagePolicy(content, language) }],
    });
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.call("session.cancel", { sessionId });
  }

  /** DSH has no in-place history deletion. Revert by forking a new session
   * from the completed turn immediately before the selected user message.
   * The source session remains intact as a recoverable history copy. */
  async revert(sessionId: string, messageID: string, _partID?: string): Promise<string> {
    const messages = await this.getMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.role === "user" && message.id === messageID);
    if (targetIndex < 0) throw new Error(`DSH could not find message ${messageID} in session ${sessionId}`);
    const previousUsers = messages.slice(0, targetIndex).filter((message) => message.role === "user");
    const previous = [...previousUsers].reverse().find((message) => message.seq !== undefined);
    if (previousUsers.length > 0 && !previous) {
      throw new Error(`DSH history has no sequence anchor before message ${messageID} in session ${sessionId}`);
    }
    const value = previous
      ? await this.call("session.fork", { sessionId, atSeq: previous.seq })
      : await this.call("session.create", {
          ...(this.directory ? { cwd: this.directory } : {}),
        });
    const result = asRecord(value);
    const replacementId = stringAt(result, "sessionId") ?? stringAt(result, "id");
    if (!replacementId) {
      throw new Error(`DSH ${previous ? "session.fork" : "session.create"} returned no replacement sessionId`);
    }
    this.userSessionIds.add(replacementId);
    this.activeSessionId = replacementId;
    return replacementId;
  }
  async unrevert(_sessionId: string): Promise<void> { throw unsupported("DSH has no unrevert RPC"); }

  async listSkills(): Promise<SkillInfo[]> {
    // DSH scopes skill discovery to a session and rejects an empty session id.
    // During startup the desktop catalog may load before the first visible
    // conversation exists. Reuse a real session when possible, otherwise use
    // one reusable blank carrier. DSH's session list can expose that carrier,
    // so querySessions filters it from the user-facing history.
    const sessionId = await this.ensureSkillSession();
    const value = asRecord(await this.call("skill.list", { sessionId }));
    return (Array.isArray(value.skills) ? value.skills : []).map((entry) => {
      const item = asRecord(entry);
      return { name: String(item.name ?? ""), description: String(item.description ?? "") };
    }).filter((item) => item.name);
  }

  async listAgents(): Promise<AgentInfo[]> {
    const value = asRecord(await this.call("agentPreset.list", {}));
    const presetRows = (Array.isArray(value.presets) ? value.presets : []).map(asRecord);
    const presets = presetRows.map((item) => {
      return { name: String(item.id ?? ""), description: String(item.description ?? ""), mode: "primary" };
    }).filter((item) => item.name);
    // The roster intentionally exposes presets, while plan mode is a module
    // mounted inside a preset. Read the composition only to advertise the
    // virtual UI mode when the module is actually present.
    const inspectedPlanEnabled = await Promise.all(presets.map(async (preset) => {
      try {
        const composition = asRecord(await this.call("agentPreset.read", { agentPreset: preset.name }));
        return /(?:@deepseek-ai\/)?dsh-plan-mode|plan-mode/.test(String(composition.content ?? ""));
      } catch {
        return false;
      }
    })).then((flags) => flags.some(Boolean));
    // The shipped presets are immutable and their published contract includes
    // plan mode. This fallback keeps remote/gateway clients functional when
    // the privileged composition read is intentionally unavailable.
    const planEnabled = inspectedPlanEnabled || presetRows.some((item) =>
      item.trust === "system" && ["standard", "code", "cordis"].includes(String(item.id ?? "")),
    );
    return planEnabled
      ? [...presets, { name: "plan", description: "DSH plan mode", mode: "primary" }]
      : presets;
  }

  async listCommands(): Promise<CommandInfo[]> {
    const sessionId = await this.ensureSkillSession();
    let value: unknown;
    try {
      value = await this.remoteCall("commands/list", { agentId: sessionId });
    } catch {
      return [];
    }
    const rows: unknown[] = Array.isArray(value)
      ? value
      : Array.isArray(asRecord(value).commands)
        ? asRecord(value).commands as unknown[]
        : [];
    return rows.map((entry) => {
      const item = asRecord(entry);
      const input = asRecord(item.input);
      return {
        name: String(item.name ?? "").replace(/^\//, ""),
        description: typeof item.description === "string" ? item.description : undefined,
        source: "command",
        ...(typeof input.hint === "string" ? { template: input.hint } : {}),
      };
    }).filter((item) => item.name);
  }

  async getDefaultModel(): Promise<string | null> {
    if (this.defaultModel) return this.defaultModel;
    // DSH deliberately keeps the agent-default-model settings namespace out of
    // the browser configuration boundary. `host.describe` is the public,
    // profile-safe view of the selection persisted by session.selectModel.
    const value = asRecord(await this.call("host.describe", {}));
    const provider = stringAt(value, "provider");
    const model = stringAt(value, "model");
    this.defaultModel = provider && model
      ? `${provider}/${model}`
      : null;
    return this.defaultModel;
  }

  async setDefaultModel(model: string): Promise<void> {
    const [provider, ...modelParts] = model.split("/");
    const modelId = modelParts.join("/");
    if (!provider || !modelId) throw new Error(`Invalid DSH model selection: ${model}`);
    // DSH's supported model-selection RPC persists the selected model through
    // its host default-selection hook. The settings namespace is intentionally
    // not exposed to web/configuration clients, so writing it directly fails.
    // Keep a reusable blank carrier session when the user changes the model
    // before any conversation has been opened; it is hidden by querySessions.
    const sessionId = await this.ensureCarrierSession();
    await this.selectModel(sessionId, model);
    this.defaultModel = model;
  }

  async runShell(sessionId: string, command: string): Promise<void> { return this.sendPrompt(sessionId, `! ${command}`); }
  async runCommand(sessionId: string, command: string, args?: string, language?: string | null): Promise<void> {
    void language;
    await this.connect();
    this.activeSessionId = sessionId;
    const line = `/${command}${args ? ` ${args}` : ""}`;
    let raw: unknown;
    try {
      raw = await this.remoteCall("commands/execute", { agentId: sessionId, line });
    } catch (error) {
      // A bridge that does not implement generic Remotes is an older DSH
      // deployment. Its command semantics remain the prompt shortcut.
      if (error instanceof Error && /HTTP (?:404|405)|unavailable|unknown/i.test(error.message)) {
        return this.sendPrompt(sessionId, line, undefined, undefined, undefined, language);
      }
      throw error;
    }
    // Older remote bridges (and compatibility mocks) do not expose the generic
    // command endpoint and answer with an empty object. Preserve their legacy
    // prompt path; a real DSH command Remote always returns CommandExecution or
    // an explicit undefined admission miss.
    if (raw && typeof raw === "object" && Object.keys(asRecord(raw)).length === 0) {
      return this.sendPrompt(sessionId, line, undefined, undefined, undefined, language);
    }
    if (raw === undefined) throw new Error(`DSH command rejected: ${line}`);
    const execution = asRecord(raw);
    const result = asRecord(execution.result);
    if (result.kind === "error") throw new Error(String(result.text ?? `DSH command rejected: ${line}`));
  }

  async compactSession(sessionId: string): Promise<void> {
    await this.runCommand(sessionId, "compact");
  }

  async listQuestions(sessionId?: string): Promise<QuestionAskedEvent[]> {
    return [...this.pending.entries()].filter(([, item]) => item.kind === "question" && (!sessionId || item.sessionId === sessionId)).map(([requestId, item]) => ({
      type: "question.asked" as const,
      sessionId: item.sessionId,
      requestId,
      questions: (item.questions ?? []).map(questionItem),
    }));
  }

  async listPermissions(sessionId?: string): Promise<PermissionAskedEvent[]> {
    return [...this.pending.entries()].filter(([, item]) => item.kind === "permission" && (!sessionId || item.sessionId === sessionId)).map(([requestId, item]) => ({
      type: "permission.asked" as const,
      sessionId: item.sessionId,
      requestId,
      action: item.approvalId ? "approval" : "permission",
      resources: [],
    }));
  }

  async answerQuestion(requestId: string, answers: string[][]): Promise<void> {
    const item = this.pending.get(requestId);
    if (!item || item.kind !== "question") throw new Error(`Unknown DSH question request: ${requestId}`);
    const questions = item.questions ?? [];
    await this.respond(requestId, { sessionId: item.sessionId, answer: { answers: questions.map((question, index) => ({ id: String(question.id ?? index), selected: answers[index] ?? [] })) } });
    this.pending.delete(requestId);
  }

  async rejectQuestion(requestId: string): Promise<void> {
    const item = this.pending.get(requestId);
    if (!item) throw new Error(`Unknown DSH question request: ${requestId}`);
    await this.respond(requestId, { sessionId: item.sessionId, answer: { answers: [] } });
    this.pending.delete(requestId);
  }

  async replyPermission(requestId: string, reply: PermissionReply): Promise<void> {
    if (reply === "always") throw unsupported("DSH approval responses do not persist an always rule");
    const item = this.pending.get(requestId);
    if (!item || item.kind !== "permission") throw new Error(`Unknown DSH approval request: ${requestId}`);
    await this.respond(requestId, { sessionId: item.sessionId, approvalId: item.approvalId ?? requestId, outcome: reply === "once" ? "allowed-once" : "rejected" });
    this.pending.delete(requestId);
  }

  // Configuration and MCP belong to an optional DSH settings/plugin module.
  async listProviders(): Promise<ProviderInfo[]> {
    const value = asRecord(await this.call("llm.models", {}));
    return parseProviderGroups(value);
  }

  /**
   * Return only model routes that are currently usable with a configured
   * credential. `llm.models` is a catalog of every installed route; it is not
   * an authentication/availability list. Join it with the provider directory,
   * settings profiles, and credential metadata before exposing models to the
   * desktop picker.
   */
  async listConfiguredProviders(): Promise<ProviderInfo[]> {
    const [modelsValue, providersValue, settingsValue] = await Promise.all([
      this.call("llm.models", {}),
      this.call("llm.providers", {}),
      this.call("settings.describe", {}),
    ]);
    const groups = parseProviderGroups(asRecord(modelsValue));
    const providerRowsValue = asRecord(providersValue).providers;
    const providerRows = (Array.isArray(providerRowsValue) ? providerRowsValue : []).map(asRecord);
    const namespacesValue = asRecord(settingsValue).namespaces;
    const namespaces = (Array.isArray(namespacesValue) ? namespacesValue : []).map(asRecord);
    const namespaceByName = new Map(
      namespaces.map((namespace) => [String(namespace.ns ?? ""), namespace]),
    );
    const refsByProvider = new Map<string, string>();
    for (const provider of providerRows) {
      if (provider.active !== true) continue;
      const providerID = String(provider.provider ?? "");
      const namespace = namespaceByName.get(String(provider.settingsNs ?? ""));
      const path = Array.isArray(provider.settingsPath)
        ? provider.settingsPath.map(String)
        : [];
      const profile = valueAtPath(asRecord(namespace?.value), path);
      const ref = stringAt(asRecord(profile), "apiKeyEnv");
      // This surface is deliberately key-backed: a route without a resolved
      // credential must stay out of the model picker, even when its plugin is
      // installed and reports itself active.
      if (providerID && ref) refsByProvider.set(providerID, ref);
    }
    const refs = [...new Set(refsByProvider.values())];
    const credentials = await this.describeCredentials(refs);
    const configuredIDs = new Set(
      [...refsByProvider.entries()]
        .filter(([, ref]) => asRecord(credentials[ref]).configured === true)
        .map(([providerID]) => providerID),
    );
    return groups.filter((group) => configuredIDs.has(group.id));
  }

  async refreshProviderCache(): Promise<void> { await this.call("llm.models", {}); }
  async setProviderApiKey(providerID: string, key: string): Promise<void> {
    const descriptor = await this.providerDescriptor(providerID);
    if (!descriptor) throw new Error(`DSH provider is not configurable: ${providerID}`);
    const ref = await this.providerCredentialRef(providerID, descriptor);
    await this.call("credentials.set", { ref, value: key });
    await this.ensureProviderCredentialRef(descriptor, ref);
  }
  async getProviderRegion(_providerID: string): Promise<string | null> {
    // DSH provider modules own provider-specific settings. The core adapter
    // cannot safely infer a region path, so the settings UI starts blank.
    return null;
  }
  async setProviderRegion(..._args: unknown[]): Promise<void> { throw unsupported("Provider settings belong to the DSH settings module"); }
  async removeProviderAuth(providerID: string): Promise<void> {
    const descriptor = await this.providerDescriptor(providerID);
    if (!descriptor) throw new Error(`DSH provider is not configurable: ${providerID}`);
    const ref = await this.providerCredentialRef(providerID, descriptor);
    await this.call("credentials.unset", { ref });
    // A catalog provider is materialized by the llm-pi-ai profile whenever a
    // profile entry exists, even when its credential is empty. Removing only
    // the credential therefore leaves the provider (and all of its models) in
    // `llm.models`, making the Settings "Remove" action appear to do nothing.
    // Remove the profile as well; saving a key later recreates the minimal
    // profile via ensureProviderCredentialRef and the installed catalog fills
    // in the provider's endpoint and model metadata.
    const ns = String(descriptor.settingsNs ?? "");
    const path = Array.isArray(descriptor.settingsPath)
      ? descriptor.settingsPath.map(String)
      : [];
    if (ns && path.length > 0 && await this.settingsNamespace(ns)) {
      await this.call("settings.mutate", {
        ns,
        ops: [{ op: "unset", path }],
      });
    }
  }
  async oauthAuthorize(..._args: unknown[]): Promise<OAuthAuthorization> { throw unsupported("OAuth belongs to the DSH credentials module"); }
  async oauthCallback(..._args: unknown[]): Promise<void> { throw unsupported("OAuth belongs to the DSH credentials module"); }
  async addCustomProvider(
    id: string,
    opts: {
      name: string;
      npm: string;
      baseURL: string;
      apiKey?: string;
      models: string[];
      contexts?: Record<string, number>;
    },
  ): Promise<void> {
    if (isApplicationOwnedProvider(id)) {
      throw new Error("The bundled DeepSeek provider id is reserved; choose a custom provider id.");
    }
    const ref = providerCredentialRefName(id);
    if (opts.apiKey) await this.call("credentials.set", { ref, value: opts.apiKey });
    const profile: RecordValue = {
      displayName: opts.name,
      apiKeyEnv: ref,
      api: opts.npm === "@ai-sdk/anthropic" ? "anthropic-messages" : "openai-completions",
      baseURL: opts.baseURL,
      models: opts.models.map((model) => ({
        id: model,
        name: model,
        ...(opts.contexts?.[model] ? { contextWindow: opts.contexts[model] } : {}),
      })),
    };
    await this.call("settings.mutate", {
      ns: "llm-pi-ai",
      ops: [{ op: "set", path: ["providers", id], value: profile }],
    });
  }
  async listCustomProviderIds(): Promise<string[]> {
    const value = asRecord(await this.call("llm.providers", {}));
    return (Array.isArray(value.providers) ? value.providers : [])
      .map(asRecord)
      .filter((provider) => provider.declared === true)
      .map((provider) => String(provider.provider ?? ""))
      .filter(Boolean)
      .sort();
  }
  async removeCustomProvider(id: string): Promise<void> {
    await this.call("settings.mutate", {
      ns: "llm-pi-ai",
      ops: [{ op: "unset", path: ["providers", id] }],
    });
    const ref = providerCredentialRefName(id);
    await this.call("credentials.unset", { ref }).catch(() => undefined);
  }
  async listProviderCatalog(): Promise<{ all: ProviderCatalogEntry[]; connected: string[] }> {
    const value = asRecord(await this.call("llm.providers", {}));
    const providers = (Array.isArray(value.providers) ? value.providers : [])
      .map(asRecord);
    return {
      all: providers.map((provider) => {
        const id = String(provider.provider ?? "");
        return { id, name: String(provider.displayName ?? id), env: [providerCredentialRefName(id)] };
      }).filter((provider) => provider.id),
      connected: providers.filter((provider) => provider.active === true)
        .map((provider) => String(provider.provider ?? ""))
        .filter(Boolean),
    };
  }
  async listAuthMethods(): Promise<Record<string, ProviderAuthMethod[]>> {
    const { all } = await this.listProviderCatalog();
    return Object.fromEntries(all.map((provider) => [provider.id, [{ type: "api", label: "API key" }]]));
  }
  async addMcpServer(..._args: unknown[]): Promise<void> { throw unsupported("MCP composition belongs to a DSH plugin module"); }
  async listMcpServers(..._args: unknown[]): Promise<McpServer[]> { throw unsupported("MCP composition belongs to a DSH plugin module"); }

  async clearDefaultCustomModelContextLimits(): Promise<void> {
    // DSH owns context-window accounting and does not expose OpenCode's legacy
    // custom-provider reset surface.
  }

  async moveSession(..._args: unknown[]): Promise<void> {
    throw unsupported("Session re-homing belongs to the DSH workspace module");
  }

  private async settingsNamespace(ns: string): Promise<RecordValue | null> {
    const value = asRecord(await this.call("settings.describe", {}));
    const match = (Array.isArray(value.namespaces) ? value.namespaces : [])
      .map(asRecord)
      .find((entry) => entry.ns === ns);
    return match ?? null;
  }

  private async providerDescriptor(providerID: string): Promise<RecordValue | null> {
    const value = asRecord(await this.call("llm.providers", {}));
    return (Array.isArray(value.providers) ? value.providers : [])
      .map(asRecord)
      .find((entry) => entry.provider === providerID) ?? null;
  }

  private async describeCredentials(refs: string[]): Promise<RecordValue> {
    const entries: Record<string, unknown> = {};
    // credentials.describe accepts at most 64 refs per request.
    for (let offset = 0; offset < refs.length; offset += 64) {
      const value = asRecord(await this.call("credentials.describe", {
        refs: refs.slice(offset, offset + 64),
      }));
      Object.assign(entries, asRecord(value.credentials));
    }
    return entries;
  }

  private async providerCredentialRef(providerID: string, descriptor: RecordValue): Promise<string> {
    const ns = String(descriptor.settingsNs ?? "");
    const path = Array.isArray(descriptor.settingsPath)
      ? descriptor.settingsPath.map(String)
      : [];
    const settings = ns ? await this.settingsNamespace(ns) : null;
    const profile = valueAtPath(asRecord(settings?.value), path);
    const configured = stringAt(asRecord(profile), "apiKeyEnv");
    return configured ?? providerCredentialRefName(providerID);
  }

  private async ensureProviderCredentialRef(descriptor: RecordValue, ref: string): Promise<void> {
    const ns = String(descriptor.settingsNs ?? "");
    if (!ns) throw new Error("DSH provider has no settings namespace");
    const path = Array.isArray(descriptor.settingsPath)
      ? descriptor.settingsPath.map(String)
      : [];
    const settings = await this.settingsNamespace(ns);
    // The settings service can be temporarily unavailable while DSH is
    // reloading a profile. The credential write above is still durable; do
    // not turn that successful write into an invalid settings.mutate request.
    if (!settings) return;
    const profile = valueAtPath(asRecord(settings?.value), path);
    if (stringAt(asRecord(profile), "apiKeyEnv")) return;
    await this.call("settings.mutate", {
      ns,
      ops: [{ op: "set", path: [...path, "apiKeyEnv"], value: ref }],
    });
  }

  private async open(suppressOffline = false): Promise<void> {
    this.setStatus("connecting");
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const connectTimer = setTimeout(() => abort.abort(), this.connectTimeoutMs);
    try {
      await this.call("host.describe", {}, abort.signal);
      const streams = [
        this.readWebSocket("/api/events.mux", abort.signal),
        this.readWebSocket("/api/events.host", abort.signal),
      ];
      await Promise.all(streams.map((stream) => stream.open));
      this.setStatus("ready");
      void Promise.all(streams.map((stream) => stream.run)).catch((error) => {
        this.reconnectAfterStreamFailure(error, abort);
      });
    } catch (error) {
      abort.abort();
      if (!suppressOffline && !this.closed && this.abort === abort) this.setStatus("offline");
      throw error;
    } finally {
      clearTimeout(connectTimer);
    }
  }

  private reconnectAfterStreamFailure(error: unknown, abort: AbortController): void {
    if (this.closed || abort.signal.aborted || this.abort !== abort || this.reconnecting) return;
    abort.abort();
    this.abort = null;
    this.setStatus("connecting");

    let lastError = error;
    const reconnect = (async () => {
      for (let attempt = 0; attempt < STREAM_RECONNECT_ATTEMPTS; attempt++) {
        if (this.closed) return;
        await this.waitForReconnect(attempt);
        if (this.closed) return;
        try {
          await this.open(true);
          return;
        } catch (retryError) {
          lastError = retryError;
          if (this.closed) return;
        }
      }
      if (this.closed) return;
      this.setStatus("offline");
      this.emit({ type: "error", message: lastError instanceof Error ? lastError.message : String(lastError) });
    })();
    this.reconnecting = reconnect;
    void reconnect.finally(() => {
      if (this.reconnecting === reconnect) this.reconnecting = null;
    });
  }

  private waitForReconnect(attempt: number): Promise<void> {
    const delay = Math.min(
      STREAM_RECONNECT_INITIAL_DELAY_MS * 2 ** attempt,
      STREAM_RECONNECT_MAX_DELAY_MS,
    );
    return new Promise((resolve) => {
      const wake = () => {
        if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectWake = null;
        resolve();
      };
      this.reconnectWake = wake;
      this.reconnectTimer = setTimeout(wake, delay);
    });
  }

  private cancelReconnect(): void {
    const wake = this.reconnectWake;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectWake = null;
    this.reconnecting = null;
    wake?.();
  }

  private async call(method: string, payload: RecordValue, signal?: AbortSignal): Promise<unknown> {
    const rpcId = `dsh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    // Safari/WebView and JSDOM versions used by supported targets may not
    // implement AbortSignal.any. Use a tiny listener-based fan-in instead of
    // making connection setup depend on that newer static API.
    const combined = signal ? combineAbortSignals([controller.signal, signal]) : null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
        method: "POST",
        headers: this.requestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
        signal: combined?.signal ?? controller.signal,
      });
      if (!response.ok) throw new Error(`DSH /api/${method} returned HTTP ${response.status}`);
      const envelope = await response.json() as RpcResponse;
      if (envelope.rpcId !== rpcId) throw new Error(`DSH rpcId mismatch for ${method}`);
      if (!envelope.result?.ok) throw new Error(envelope.result?.error?.message ?? `DSH ${method} failed`);
      return envelope.result.value;
    } finally {
      clearTimeout(timer);
      combined?.dispose();
    }
  }

  /** Generic DSH Connection Remote transport used by host-side command modules.
   * Unlike the host API map, command remotes are intercepted before the API
   * fallback and therefore carry their arguments under `payload.args`. */
  private async remoteCall(endpoint: string, args: RecordValue, signal?: AbortSignal): Promise<unknown> {
    const rpcId = `dsh-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const combined = signal ? combineAbortSignals([controller.signal, signal]) : null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/${endpoint}`, {
        method: "POST",
        headers: this.requestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }),
        signal: combined?.signal ?? controller.signal,
      });
      if (!response.ok) throw new Error(`DSH /api/${endpoint} returned HTTP ${response.status}`);
      const envelope = await response.json() as RpcResponse;
      if (envelope.rpcId !== rpcId) throw new Error(`DSH rpcId mismatch for ${endpoint}`);
      if (!envelope.result?.ok) throw new Error(envelope.result?.error?.message ?? `DSH ${endpoint} failed`);
      return envelope.result.value;
    } finally {
      clearTimeout(timer);
      combined?.dispose();
    }
  }

  private async respond(rpcId: string, value: RecordValue): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/respond`, {
      method: "POST",
      headers: this.requestHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ type: "client-response", rpcId, result: { ok: true, value } }),
    });
    if (!response.ok) throw new Error(`DSH /api/respond returned HTTP ${response.status}`);
  }

  private requestHeaders(headers: Record<string, string>): Record<string, string> {
    return this.bearerToken
      ? { ...headers, authorization: `Bearer ${this.bearerToken}` }
      : headers;
  }

  private readWebSocket(path: string, signal: AbortSignal): { open: Promise<void>; run: Promise<void> } {
    let opened!: () => void;
    let rejected!: (error: unknown) => void;
    const open = new Promise<void>((resolve, reject) => { opened = resolve; rejected = reject; });
    const run = new Promise<void>((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      if (this.bearerToken) url.searchParams.set("token", this.bearerToken);

      let socket: WebSocket;
      try {
        socket = this.webSocketFactory(url.toString());
      } catch (error) {
        rejected(error);
        resolve();
        return;
      }

      let didOpen = false;
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener("abort", handleAbort);
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!didOpen && error) rejected(error);
        if (didOpen && error) reject(error);
        else resolve();
      };
      const handleOpen = (): void => {
        didOpen = true;
        opened();
      };
      const handleMessage = (event: MessageEvent): void => {
        try {
          if (typeof event.data !== "string") throw new Error("binary WebSocket frame");
          const frame = JSON.parse(event.data) as DshFrame;
          if (frame.type !== "server-request" || typeof frame.rpcId !== "string") {
            throw new Error("invalid ServerRequest envelope");
          }
          void this.handleFrame(frame).catch((error) => {
            this.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
          });
        } catch {
          this.emit({ type: "error", message: `Malformed DSH event on ${path}` });
        }
      };
      const handleError = (): void => finish(new Error(`DSH WebSocket ${path} failed`));
      const handleClose = (): void => finish(
        signal.aborted ? undefined : new Error(`DSH WebSocket ${path} closed`),
      );
      const handleAbort = (): void => {
        finish(didOpen ? undefined : new Error(`DSH WebSocket ${path} connection aborted`));
        if (socket.readyState === 0 || socket.readyState === 1) socket.close();
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
      signal.addEventListener("abort", handleAbort, { once: true });
      if (signal.aborted) handleAbort();
    });
    return { open, run };
  }

  /**
   * DSH's approval/requested frame is the protocol's pre-tool boundary. The
   * adapter evaluates local guards before exposing the request to the UI. A
   * DSH Cordis plugin must emit this frame before invoking the tool; otherwise
   * the capability snapshot intentionally remains `adapter` rather than
   * claiming a server-side guarantee.
   */
  private async handleFrame(frame: DshFrame): Promise<void> {
    const payload = asRecord(frame.payload);
    if (frame.method === "approval/requested" || payload.type === "approval/requested") {
      const id = frame.rpcId ?? String(payload.approvalId ?? "");
      const sessionId = String(payload.sessionId ?? "");
      const tool = String(payload.toolName ?? payload.tool ?? "approval");
      const input = parseToolArguments(payload.input ?? payload.arguments ?? payload.args);
      // This approval/requested frame is the only DSH adapter signal that is
      // guaranteed to arrive before the executor runs. Later tool/call frames
      // are telemetry and are intentionally marked as observed.
      const admission = await this.admitTool({ sessionId, callId: id, tool, input }, "pre-execution");
      if (admission.decision !== "allow") {
        await this.respond(id, {
          sessionId,
          approvalId: String(payload.approvalId ?? id),
          outcome: "rejected",
          reason: admission.reason ?? "blocked by runtime governance",
        });
        this.emit({ type: "permission.resolved", sessionId, requestId: id });
        return;
      }
      this.pending.set(id, {
        sessionId,
        kind: "permission",
        approvalId: String(payload.approvalId ?? id),
        tool,
        input,
      });
      this.emit({
        type: "permission.asked",
        eventId: stableEventId("dsh-permission", { id, sessionId, tool }),
        sessionId,
        requestId: id,
        action: tool,
        resources: [
          ...(payload.reason ? [String(payload.reason)] : []),
          ...(admission.reason ? [admission.reason] : []),
        ],
      });
      return;
    }
    if (frame.method === "question/requested" || payload.type === "question/requested") {
      const id = frame.rpcId ?? `question-${Date.now()}`;
      const sessionId = String(payload.sessionId ?? "");
      const questions = Array.isArray(payload.questions) ? payload.questions.map(asRecord) : [];
      this.pending.set(id, { sessionId, kind: "question", questions });
      this.emit({ type: "question.asked", sessionId, requestId: id, questions: questions.map(questionItem) });
      return;
    }
    if (payload.type === "approval/resolved" || payload.type === "question/resolved") {
      const resolvedId = String(payload.approvalId ?? payload.questionRpcId ?? frame.rpcId ?? "");
      const requestId = payload.type === "approval/resolved"
        ? [...this.pending.entries()].find(([, item]) => item.approvalId === resolvedId)?.[0] ?? resolvedId
        : resolvedId;
      const sessionId = String(payload.sessionId ?? "");
      this.pending.delete(requestId);
      this.emit({ type: payload.type === "approval/resolved" ? "permission.resolved" : "question.resolved", sessionId, requestId } as RuntimeMessageEvent);
      return;
    }
    // The mux protocol sends projection changes as their own top-level frame;
    // unlike session/event, they are not wrapped in a durable event envelope.
    // Keep this branch before session/event so live token-meter updates are not
    // silently dropped on the real DSH sidecar.
    if (payload.type === "session/projection") {
      const sessionId = String(payload.sessionId ?? "");
      this.normalizeSessionEvent(sessionId, payload);
      return;
    }
    if (payload.type === "session/event") {
      const sessionId = String(payload.sessionId ?? "");
      this.normalizeSessionEvent(sessionId, asRecord(payload.event));
      return;
    }
    if (payload.type === "host/session-status") {
      const sessionId = String(payload.sessionId ?? "");
      if (payload.running === false) { this.emit({ type: "session.idle", sessionId }); this.emit({ type: "turn.finished", sessionId, status: "completed" }); }
      return;
    }
    if (payload.type === "host/agent-error") this.emit({ type: "error", sessionId: String(payload.sessionId ?? ""), message: String(payload.message ?? "DSH agent error") });
  }

  private normalizeSessionEvent(sessionId: string, event: RecordValue): void {
    const type = String(event.type ?? "");
    const data = asRecord(event.data);
    const eventId = stableEventId("dsh-event", { sessionId, seq: event.seq ?? null, type });
    if (type === "session/projection") {
      const key = String(event.key ?? "");
      if (key === "contextPressure" || key === "contextBreakdown" || key === "tokenUsage") {
        const current = this.contextUsage.get(sessionId) ?? { estimated: true };
        const value = asRecord(event.value);
        const next: ContextUsage = { ...current };
        const numberAt = (record: RecordValue, keyName: string) =>
          typeof record[keyName] === "number" && Number.isFinite(record[keyName]) ? record[keyName] as number : undefined;
        if (key === "contextPressure") {
          const projectedTokens = numberAt(value, "projectedTokens");
          const pressureTokens = numberAt(value, "pressureTokens");
          const contextWindow = numberAt(value, "contextWindow");
          if (projectedTokens !== undefined) { next.projectedTokens = projectedTokens; next.usedTokens = projectedTokens; }
          if (pressureTokens !== undefined) { next.pressureTokens = pressureTokens; next.usedTokens ??= pressureTokens; }
          if (contextWindow !== undefined) next.contextWindow = contextWindow;
        } else if (key === "contextBreakdown") {
          for (const name of ["systemTokens", "toolsTokens", "messageTokens"] as const) {
            const tokenCount = numberAt(value, name);
            if (tokenCount !== undefined) next[name] = tokenCount;
          }
        } else {
          const usage = Object.fromEntries(Object.entries(value).filter(([, raw]) => typeof raw === "number" && Number.isFinite(raw))) as Record<string, number>;
          if (Object.keys(usage).length) next.tokenUsage = usage;
        }
        if (typeof event.seq === "number") next.asOfSeq = event.seq;
        this.contextUsage.set(sessionId, next);
        this.emit({ type: "context.updated", eventId, sessionId, usage: next });
      }
      return;
    }
    if (type === "compaction/summary") {
      const compactionId = stringAt(data, "compactionId") ?? stringAt(event, "compactionId") ?? `seq:${String(event.seq ?? Date.now())}`;
      if (this.compactedIds.has(`${sessionId}:${compactionId}`)) return;
      this.compactedIds.add(`${sessionId}:${compactionId}`);
      const sourceCommandId = stringAt(data, "sourceCommandId") ?? stringAt(event, "sourceCommandId");
      this.emit({
        type: "session.compacted",
        eventId,
        sessionId,
        compactionId,
        auto: !sourceCommandId,
        ...(typeof data.overflow === "boolean" ? { overflow: data.overflow } : {}),
        ...(typeof data.shadowedTokenCount === "number" ? { shadowedTokenCount: data.shadowedTokenCount } : {}),
      });
      return;
    }
    if (type === "turn/start") { this.emit({ type: "turn.started", eventId, sessionId }); return; }
    if (type === "user/message") {
      // The optimistic desktop echo is tagged from this durable event. DSH
      // uses plugin-generated user messages for context/policy injections too;
      // those must stay invisible and must never become editable rows.
      const message = asRecord(data.message);
      const source = asRecord(data.source ?? message.source);
      const messageID = stringAt(data, "id") ?? stringAt(message, "id");
      const sourceKind = stringAt(source, "kind");
      if (messageID && sourceKind !== "system" && sourceKind !== "plugin") {
        const agent = stringAt(source, "agent") ?? stringAt(data, "agent") ?? stringAt(message, "agent");
        this.emit({
          type: "message.agent",
          eventId,
          sessionId,
          messageID,
          ...(agent ? { agent } : {}),
        });
      }
      return;
    }
    if (type === "step/start") {
      // A new step makes any text-only candidate from the previous step
      // ineligible for a legacy tool/call fallback.
      this.clearCandidateTexts(sessionId);
      this.emit({ type: "step.updated", eventId, sessionId, step: Number(data.step ?? 1) });
      return;
    }
    if (type === "turn/end") {
      const reason = asRecord(data.reason);
      const kind = String(reason.kind ?? "completed");
      this.clearChunks(sessionId);
      this.clearCandidateTexts(sessionId);
      this.emit({ type: "turn.finished", eventId, sessionId, status: kind === "error" ? "failed" : kind === "aborted" ? "cancelled" : "completed" });
      this.emit({ type: "session.idle", eventId: stableEventId("dsh-idle", { sessionId, seq: event.seq ?? null }), sessionId });
      return;
    }
    if (type === "plan/mode") {
      this.emit({ type: "message.agent", sessionId, agent: data.active === true ? "plan" : "build" });
      return;
    }
    if (type === "assistant/chunk") {
      const chunk = asRecord(data.chunk);
      const kind = chunk.type === "reasoning-delta"
        ? "reasoning"
        : chunk.type === "text-delta"
          ? "text"
          : null;
      if (!kind) return;
      const key = chunkKey(sessionId, data, chunk, kind);
      const text = `${this.chunks.get(key) ?? ""}${String(chunk.text ?? "")}`;
      this.chunks.set(key, text);
      const partId = chunkPartId(data, chunk, kind);
      if (kind === "text") {
        const progress = summarizeProgressText(text);
        if (progress) {
          this.emit({
            type: "progress.updated",
            sessionId,
            partId,
            text: progress,
          });
        }
        return;
      }
      const deltaProgress = summarizeProgressText(String(chunk.text ?? ""));
      const publicProgress = this.publicProgressParts.has(key)
        || (!!deltaProgress && isPublicProgressText(String(chunk.text ?? "")));
      if (publicProgress) this.publicProgressParts.add(key);
      const progress = publicProgress
        ? (summarizeProgressText(text) ?? deltaProgress)
        : deltaProgress;
      if (!publicProgress) {
        this.emit({
          type: "reasoning.updated",
          sessionId,
          partId,
          text,
        } as RuntimeMessageEvent);
      }
      // Some DSH providers classify all pre-tool prose as reasoning, even
      // when it is a safe user-facing action update (for example, "I am
      // checking the workspace"). Keep the private stream in the reasoning
      // lane, but route a concise action sentence to the live progress channel
      // instead of rendering the same sentence twice.
      if (progress) {
        this.emit({
          type: "progress.updated",
          sessionId,
          partId,
          text: progress,
        });
      }
      return;
    }
    if (type === "assistant/message") {
      const message = asRecord(data.message);
      const content = Array.isArray(message.content) ? message.content : [];
      const hasToolCall = content.some((rawBlock) => asRecord(rawBlock).type === "tool-call");
      for (const [index, rawBlock] of content.entries()) {
        const block = asRecord(rawBlock);
        if (isReasoningBlockType(String(block.type ?? ""))) {
          if (typeof block.text === "string" && block.text) {
            const progress = summarizeProgressText(block.text);
            const publicProgress = !!progress && isPublicProgressText(block.text);
            if (!publicProgress) {
              this.emit({
                type: "reasoning.updated",
                sessionId,
                partId: chunkPartId(data, { index }, "reasoning"),
                text: block.text,
              } as RuntimeMessageEvent);
            }
            if (progress) {
              this.emit({
                type: "progress.updated",
                sessionId,
                partId: chunkPartId(data, { index }, "reasoning"),
                text: progress,
              });
            }
          }
          continue;
        }
        if (block.type === "text" && typeof block.text === "string" && block.text) {
          const partId = chunkPartId(data, { index }, "text");
          const progress = summarizeProgressText(block.text);
          const publicProgress = hasToolCall && !!progress && isPublicProgressText(block.text);
          if (hasToolCall) {
            if (progress) {
              this.emit({ type: "progress.updated", sessionId, partId, text: progress });
            }
          }
          if (!publicProgress) {
            this.emit({
              // DSH emits progress prose as a text block immediately before a
              // tool call. A message with no tool call is the settled answer.
              type: hasToolCall ? "reasoning.updated" : "text.updated",
              sessionId,
              partId,
              text: block.text,
            } as RuntimeMessageEvent);
          }
          if (hasToolCall) this.candidateTexts.delete(sessionStepKey(sessionId, data));
          else this.candidateTexts.set(sessionStepKey(sessionId, data), { partId, text: block.text });
        }
        if (block.type !== "tool-call") continue;
        const callId = String(block.id ?? `dsh-${event.seq ?? Date.now()}`);
        const tool = String(block.name ?? "tool");
        const input = parseToolArguments(block.arguments);
        const childSessionId = childSessionIdFromToolRecord(block, sessionId);
        this.toolCalls.set(callId, { tool, input, ...(childSessionId ? { childSessionId } : {}) });
        this.emit({
          type: "tool.updated",
          eventId: stableEventId("dsh-tool", { sessionId, callId, seq: event.seq ?? null }),
          sessionId,
          callId,
          tool,
          status: "running",
          input,
          ...(childSessionId ? { childSessionId } : {}),
          executionBoundary: "observed",
        } as RuntimeMessageEvent);
      }
      this.clearChunks(sessionId, data);
      return;
    }
    if (type === "tool/call" || type === "tool/result") {
      const result = dshToolResult(data);
      const callId = String(data.callId ?? result.callId ?? data.id ?? `dsh-${event.seq ?? Date.now()}`);
      const tool = String(data.name ?? data.tool ?? this.toolCalls.get(callId)?.tool ?? "tool");
      const input = type === "tool/call"
        ? parseToolArguments(data.arguments ?? data.args ?? data.input)
        : this.toolCalls.get(callId)?.input;
      const childSessionId = childSessionIdFromToolRecord(data, sessionId)
        ?? result.childSessionId
        ?? this.toolCalls.get(callId)?.childSessionId;
      if (type === "tool/call") {
        const candidate = this.takeCandidateText(sessionId, data);
        if (candidate) {
          // Legacy DSH persists the tool call separately from the assistant
          // message. Replace the already-emitted candidate in place so the
          // UI folds it without leaving a duplicate answer block.
          const progress = summarizeProgressText(candidate.text);
          if (progress && isPublicProgressText(candidate.text)) {
            this.emit({ type: "progress.updated", sessionId, partId: candidate.partId, text: progress });
          } else {
            this.emit({
              type: "reasoning.updated",
              sessionId,
              partId: candidate.partId,
              text: candidate.text,
            } as RuntimeMessageEvent);
          }
        }
        this.toolCalls.set(callId, { tool, input, ...(childSessionId ? { childSessionId } : {}) });
      } else {
        this.toolCalls.delete(callId);
      }
      this.emit({
        type: "tool.updated",
        eventId: stableEventId("dsh-tool", { sessionId, callId, seq: event.seq ?? null }),
        sessionId,
        callId,
        tool,
        status: type === "tool/call" ? "running" : (result.failed ? "failed" : "success"),
        input,
        output: result.output,
        ...(childSessionId ? { childSessionId } : {}),
        executionBoundary: "observed",
      } as RuntimeMessageEvent);
    }
  }

  private clearChunks(sessionId: string, data?: RecordValue): void {
    const prefix = data
      ? `${sessionId}:${String(data.turn ?? 0)}:${String(data.step ?? 0)}:`
      : `${sessionId}:`;
    for (const key of this.chunks.keys()) {
      if (key.startsWith(prefix)) this.chunks.delete(key);
    }
    for (const key of this.publicProgressParts) {
      if (key.startsWith(prefix)) this.publicProgressParts.delete(key);
    }
  }

  private clearCandidateTexts(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.candidateTexts.keys()) {
      if (key.startsWith(prefix)) this.candidateTexts.delete(key);
    }
  }

  private takeCandidateText(sessionId: string, data: RecordValue): { partId: string; text: string } | undefined {
    const exactKey = sessionStepKey(sessionId, data);
    const exact = this.candidateTexts.get(exactKey);
    if (exact) {
      this.candidateTexts.delete(exactKey);
      return exact;
    }
    // Some older event wrappers omitted turn/step from tool/call. Only use a
    // fallback when those fields are absent; a known step must never consume a
    // candidate from another step's final answer.
    if (data.turn !== undefined || data.step !== undefined) return undefined;
    for (const [key, candidate] of this.candidateTexts) {
      if (!key.startsWith(`${sessionId}:`)) continue;
      this.candidateTexts.delete(key);
      return candidate;
    }
    return undefined;
  }

  private async selectModel(sessionId: string, model: string, variant?: string | null): Promise<void> {
    const slash = model.indexOf("/");
    const provider = slash > 0 ? model.slice(0, slash) : "deepseek-official";
    const id = slash > 0 ? model.slice(slash + 1) : model;
    await this.call("session.selectModel", { sessionId, provider, model: id, ...(variant ? { reasoningEffort: variant } : {}) });
  }
}

function unsupported(message: string): Error { return new Error(`${message}. Install or mount the corresponding DSH module.`); }
function combineAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => signals.forEach((signal) => signal.removeEventListener("abort", abort)),
  };
}
function asRecord(value: unknown): RecordValue { return value && typeof value === "object" ? value as RecordValue : {}; }
function stringAt(value: RecordValue, key: string): string | undefined { return typeof value[key] === "string" && value[key] ? value[key] as string : undefined; }
function sessionRowId(value: RecordValue): string | undefined {
  return stringAt(value, "sessionId") ?? stringAt(value, "id");
}
function sessionRowIsBlank(value: RecordValue): boolean {
  if (value.blank === true) return true;
  const nested = [
    asRecord(value.sessionListMetadata),
    asRecord(asRecord(value.metadata).sessionListMetadata),
    asRecord(asRecord(asRecord(value.projections).values).sessionListMetadata),
  ];
  return nested.some((item) => item.blank === true);
}
function normalizeSessionDirectory(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function parseToolArguments(value: unknown): RecordValue | undefined {
  if (value && typeof value === "object") return value as RecordValue;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RecordValue : undefined;
  } catch {
    return undefined;
  }
}
function chunkKey(sessionId: string, data: RecordValue, chunk: RecordValue, kind: string): string {
  return `${sessionId}:${String(data.turn ?? 0)}:${String(data.step ?? 0)}:${String(chunk.index ?? 0)}:${kind}`;
}
function sessionStepKey(sessionId: string, data: RecordValue): string {
  return `${sessionId}:${String(data.turn ?? 0)}:${String(data.step ?? 0)}`;
}
function chunkPartId(data: RecordValue, chunk: RecordValue, kind: string): string {
  return `dsh-${String(data.turn ?? 0)}-${String(data.step ?? 0)}-${String(chunk.index ?? 0)}-${kind}`;
}
function dshToolResult(data: RecordValue): {
  callId?: string;
  output?: string;
  failed: boolean;
  childSessionId?: string;
} {
  const message = asRecord(data.message);
  const source = asRecord(message.source);
  const blocks = (Array.isArray(message.content) ? message.content : []).map(asRecord);
  const resultBlocks = blocks.filter((block) => block.type === "tool-result");
  const outputBlocks = resultBlocks.length
    ? resultBlocks.flatMap((block) => (Array.isArray(block.content) ? block.content : []).map(asRecord))
    : blocks;
  const output = outputBlocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
  const callId = stringAt(source, "callId")
    ?? resultBlocks.map((block) => stringAt(block, "toolCallId")).find(Boolean);
  return {
    callId,
    output: output || undefined,
    childSessionId: childSessionIdFromToolRecord(data, String(data.sessionId ?? "")),
    failed: data.isError === true
      || Object.keys(asRecord(data.error)).length > 0
      || resultBlocks.some((block) => block.isError === true),
  };
}

/** DSH task implementations have used more than one metadata spelling while
 * the protocol has been stabilised. Keep the wire adapter tolerant, but only
 * inspect child/task metadata so the parent session id is never mistaken for a
 * spawned session. */
function childSessionIdFromToolRecord(value: unknown, ownerSessionId: string): string | undefined {
  const directKeys = new Set([
    "childSessionId",
    "childSessionID",
    "child_session_id",
    "subagentSessionId",
    "subagentSessionID",
    "subagent_session_id",
  ]);
  const nestedKeys = new Set([
    "metadata",
    "meta",
    "toolMetadata",
    "task",
    "subagent",
    "child",
    "result",
    "message",
    "source",
  ]);
  const seen = new Set<object>();
  const childIdFromText = (text: string): string | undefined => {
    // Continuable DSH children announce their durable session id in the
    // rendered tool result. Background one-shot jobs intentionally expose a
    // job id instead, so never treat that acknowledgement as a child session.
    if (/background\s+subagent/i.test(text)) return undefined;
    const match = /(?:started\s+subagent\s+|"(?:subagentId|childSessionId)"\s*:\s*")([A-Za-z0-9][A-Za-z0-9._:-]{7,})/i.exec(text);
    const id = match?.[1];
    return id && id !== ownerSessionId ? id : undefined;
  };
  const walk = (current: unknown, taskContext: boolean): string | undefined => {
    if (typeof current === "string") return taskContext ? childIdFromText(current) : undefined;
    if (!current || typeof current !== "object") return undefined;
    if (seen.has(current)) return undefined;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = walk(item, taskContext);
        if (found) return found;
      }
      return undefined;
    }
    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      if (directKeys.has(key) && typeof raw === "string" && raw && raw !== ownerSessionId) return raw;
      const childContext = taskContext || nestedKeys.has(key) || /task|subagent|child/i.test(key);
      if (key === "sessionId" && childContext && typeof raw === "string" && raw && raw !== ownerSessionId) return raw;
      const found = walk(raw, childContext);
      if (found) return found;
    }
    return undefined;
  };
  return walk(value, false);
}
function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) current = asRecord(current)[part];
  return current;
}

function parseProviderGroups(value: RecordValue): ProviderInfo[] {
  return (Array.isArray(value.groups) ? value.groups : []).map((group) => {
    const item = asRecord(group);
    return {
      id: String(item.id ?? ""),
      name: String(item.name ?? item.id ?? ""),
      models: (Array.isArray(item.models) ? item.models : []).map((model) => {
        const entry = asRecord(model);
        const reasoning = asRecord(entry.reasoning);
        return {
          id: String(entry.id ?? ""),
          name: String(entry.name ?? entry.id ?? ""),
          variants: (Array.isArray(reasoning.efforts) ? reasoning.efforts : [])
            .map((effort) => String(asRecord(effort).id ?? ""))
            .filter(Boolean),
        };
      }),
    };
  });
}

function providerCredentialRefName(providerID: string): string {
  const known: Record<string, string> = {
    "deepseek-official": "DEEPSEEK_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    cohere: "COHERE_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
    mistral: "MISTRAL_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    xai: "XAI_API_KEY",
  };
  if (known[providerID]) return known[providerID];
  const normalized = providerID.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^[^A-Z_]/, "_$&");
  return `NEBULAMAT_${normalized}_API_KEY`;
}
function questionItem(value: RecordValue): { question: string; header: string; options: Array<{ label: string; description?: string }>; multiple?: boolean; custom?: boolean } {
  return { question: String(value.question ?? ""), header: String(value.header ?? ""), options: (Array.isArray(value.options) ? value.options : []).map((option) => ({ label: String(asRecord(option).label ?? ""), description: typeof asRecord(option).description === "string" ? asRecord(option).description as string : undefined })), ...(value.multiSelect === true ? { multiple: true } : {}), ...(value.custom === true ? { custom: true } : {}) };
}
function sessionMeta(value: RecordValue): SessionMeta | undefined {
  const id = stringAt(value, "sessionId") ?? stringAt(value, "id");
  if (!id) return undefined;
  const updated = typeof value.updatedAt === "number" ? value.updatedAt : undefined;
  const projections = asRecord(value.projections);
  const projectionValues = asRecord(projections.values);
  const projectedTitle = typeof projectionValues.title === "string" ? projectionValues.title : undefined;
  return {
    id,
    title: projectedTitle ?? String(value.title ?? "Untitled"),
    directory: stringAt(value, "cwd") ?? stringAt(value, "directory"),
    parentId: stringAt(value, "parentSessionId") ?? stringAt(value, "parentId"),
    origin: stringAt(value, "origin"),
    ...(typeof value.running === "boolean" ? { running: value.running } : {}),
    created: updated,
    updated,
  };
}

function historyMessages(events: unknown[]): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  let currentAssistant: HistoryMessage | undefined;
  const toolParts = new Map<string, HistoryMessage["parts"][number]>();
  const finishAssistant = (event: RecordValue, reason?: string): void => {
    if (!currentAssistant) return;
    if (currentAssistant.completed === undefined) {
      // A terminal event proves completion even when the runtime did not
      // persist an explicit timestamp. Keep the marker numeric for the
      // HistoryMessage contract, while assistant/message events without a
      // completion field remain genuinely in-flight after reload.
      currentAssistant.completed = historyCompletedAt(event) ?? Date.now();
    }
    if (!currentAssistant.error && reason && reason !== "completed") {
      currentAssistant.error = reason;
    }
  };
  for (const raw of events) {
    const event = asRecord(asRecord(raw).event ?? raw);
    const type = String(event.type ?? "");
    const data = asRecord(event.data);
    const seq = typeof event.seq === "number" && Number.isInteger(event.seq) ? event.seq : undefined;
    if (type === "user/message") {
      const message = asRecord(data.message);
      const content = Array.isArray(data.content)
        ? data.content
        : (Array.isArray(message.content) ? message.content : []);
      const text = stripDeepResearchContext(stripKnowledgeContext(stripResearchContext(stripLanguagePolicy(content.map((part) => String(asRecord(part).text ?? "")).join("")))));
      const source = asRecord(data.source ?? message.source);
      // DSH may persist startup/context injections as user/message events. They
      // are runtime instructions, not user-authored conversation turns, and
      // must never be rendered as a giant user bubble after a reload.
      if (isSystemReminder(text, source)) continue;
      messages.push({
        role: "user",
        id: stringAt(data, "id") ?? stringAt(message, "id"),
        ...(seq !== undefined ? { seq } : {}),
        agent: stringAt(source, "agent") ?? stringAt(data, "agent") ?? stringAt(message, "agent"),
        parts: text ? [{ type: "text", text, ...(source.synthetic === true || data.synthetic === true || message.synthetic === true ? { synthetic: true } : {}) }] : [],
      });
      currentAssistant = undefined;
    } else if (type === "assistant/message") {
      const message = asRecord(data.message);
      const content = Array.isArray(message.content) ? message.content : [];
      const hasToolCall = content.some((rawBlock) => asRecord(rawBlock).type === "tool-call");
      const parts: HistoryMessage["parts"] = [];
      for (const part of content) {
        const block = asRecord(part);
        if (isReasoningBlockType(String(block.type ?? ""))) {
          const blockText = typeof block.text === "string" ? block.text : undefined;
          const progress = blockText ? summarizeProgressText(blockText) : undefined;
          const publicProgress = !!progress && !!blockText && isPublicProgressText(blockText);
          parts.push({
            type: publicProgress ? "progress" : "reasoning",
            text: publicProgress ? progress : blockText,
          });
          continue;
        }
        if (block.type !== "tool-call") {
          const blockText = typeof block.text === "string" ? block.text : undefined;
          const progress = blockText && hasToolCall ? summarizeProgressText(blockText) : undefined;
          const publicProgress = !!progress && !!blockText && isPublicProgressText(blockText);
          parts.push({
            type: publicProgress ? "progress" : block.type === "text" && hasToolCall ? "reasoning" : String(block.type ?? "text"),
            text: publicProgress ? progress : blockText,
          });
          continue;
        }
        const toolPart: HistoryMessage["parts"][number] = {
          type: "tool",
          tool: String(block.name ?? "tool"),
          state: { status: "running", input: parseToolArguments(block.arguments) },
        };
        if (typeof block.id === "string") toolParts.set(block.id, toolPart);
        parts.push(toolPart);
      }
      const error = historyError(message.error ?? data.error);
      const completed = historyCompletedAt(message);
      currentAssistant = {
        role: "assistant",
        id: stringAt(message, "id"),
        ...(seq !== undefined ? { seq } : {}),
        ...(completed !== undefined ? { completed } : {}),
        ...(error ? { error } : {}),
        parts,
      };
      messages.push(currentAssistant);
    } else if (type === "tool/call") {
      if (!currentAssistant) { currentAssistant = { role: "assistant", parts: [] }; messages.push(currentAssistant); }
      // Older DSH event logs may persist the tool call separately from the
      // assistant message. Reclassify any preceding prose in that assistant
      // message as intermediate reasoning before appending the tool part.
      for (const part of currentAssistant.parts) {
        if (part.type === "text") part.type = "reasoning";
      }
      const callId = String(data.callId ?? data.id ?? "");
      const toolPart: HistoryMessage["parts"][number] = {
        type: "tool",
        tool: String(data.name ?? data.tool ?? "tool"),
        state: { status: "running", input: parseToolArguments(data.arguments ?? data.args ?? data.input) },
      };
      if (callId) toolParts.set(callId, toolPart);
      currentAssistant.parts.push(toolPart);
    } else if (type === "tool/result") {
      if (!currentAssistant) { currentAssistant = { role: "assistant", parts: [] }; messages.push(currentAssistant); }
      const result = dshToolResult(data);
      const callId = String(data.callId ?? result.callId ?? data.id ?? "");
      const existingPart = callId ? toolParts.get(callId) : undefined;
      const part: HistoryMessage["parts"][number] = existingPart ?? {
        type: "tool",
        tool: String(data.name ?? data.tool ?? "tool"),
        state: {},
      };
      part.state = { ...part.state, status: result.failed ? "error" : "completed", ...(result.output ? { output: result.output } : {}) };
      if (!existingPart) currentAssistant.parts.push(part);
      if (callId) toolParts.delete(callId);
    } else if (type === "compaction/summary") {
      const compactionId = stringAt(data, "compactionId");
      const sourceCommandId = stringAt(data, "sourceCommandId");
      const auto = !sourceCommandId;
      if (!currentAssistant) {
        currentAssistant = { role: "assistant", parts: [] };
        messages.push(currentAssistant);
      }
      currentAssistant.parts.push({
        type: "compaction",
        ...(compactionId ? { compactionId } : {}),
        auto,
        ...(typeof data.overflow === "boolean" ? { overflow: data.overflow } : {}),
        ...(typeof data.shadowedTokenCount === "number" ? { shadowedTokenCount: data.shadowedTokenCount } : {}),
      });
    } else if (type === "turn/end" || type === "session/idle" || type === "host/session-status") {
      const reason = asRecord(data.reason);
      const kind = String(reason.kind ?? data.status ?? "completed");
      if (type !== "host/session-status" || data.running === false) finishAssistant(event, kind);
    }
  }
  return messages;
}

function historyCompletedAt(value: RecordValue): number | undefined {
  const time = asRecord(value.time);
  const candidates = [
    value.completed,
    time.completed,
    value.completedAt,
    value.endedAt,
  ];
  const found = candidates.find((candidate) => typeof candidate === "number" && candidate > 0);
  return typeof found === "number" ? found : undefined;
}

function historyError(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const record = asRecord(value);
  for (const key of ["message", "error", "reason"]) {
    const text = historyError(record[key]);
    if (text) return text;
  }
  return undefined;
}

function isReasoningBlockType(type: string): boolean {
  return /^(?:reasoning|thinking|analysis|scratchpad|chain[-_ ]of[-_ ]thought)$/i.test(type);
}

const PROGRESS_ACTION = /^(?:(?:analy[sz](?:e|ing)|build(?:ing)?|calculat(?:e|ing)|check(?:ing)?|compil(?:e|ing)|confirm(?:ing)?|connect(?:ing)?|creat(?:e|ing)|do(?:ing)?|download(?:ing)?|edit(?:ing)?|extract(?:ing)?|fetch(?:ing)?|fix(?:ing)?|generat(?:e|ing)|inspect(?:ing)?|install(?:ing)?|investigat(?:e|ing)|load(?:ing)?|locat(?:e|ing)|open(?:ing)?|packag(?:e|ing)|prepar(?:e|ing)|process(?:ing)?|read(?:ing)?|render(?:ing)?|review(?:ing)?|run(?:ning)?|search(?:ing)?|test(?:ing)?|updat(?:e|ing)|validat(?:e|ing)|verif(?:y|ying)|wait(?:ing)?|writ(?:e|ing))\b|正在|检查|读取|搜索|分析|验证|运行|测试|构建|更新|修复|整理|准备|对比|查询|加载|生成|写入|修改|定位|排查|确认|查看|等待|连接|下载|安装|编译|打包|渲染|提取|计算|处理|补充|检索|核实|复核|查找|查证|筛选|梳理|汇总|比较|引用|撰写|收集|跟进|追踪|获取|请求|做(?=.{0,60}(?:检索|搜索|核实|分析|整理|查询|验证|对比|复核))|进行(?=.{0,60}(?:检索|搜索|核实|分析|整理|查询|验证|对比|复核))|开展(?=.{0,60}(?:检索|搜索|核实|分析|整理|查询|验证|对比|复核)))/i;
const PRIVATE_PROGRESS_TAG = /<\s*(?:think|thinking|analysis|reasoning|scratchpad|chain[-_ ]of[-_ ]thought)\b/i;
const ENGLISH_PROGRESS_FORMS: Record<string, string> = {
  analyze: "Analyzing", analyse: "Analysing", build: "Building", calculate: "Calculating",
  check: "Checking", compile: "Compiling", confirm: "Confirming", connect: "Connecting",
  create: "Creating", do: "Doing", download: "Downloading", edit: "Editing", extract: "Extracting",
  fetch: "Fetching", fix: "Fixing", generate: "Generating", inspect: "Inspecting",
  install: "Installing", investigate: "Investigating", load: "Loading", locate: "Locating",
  open: "Opening", package: "Packaging", prepare: "Preparing", process: "Processing",
  read: "Reading", render: "Rendering", review: "Reviewing", run: "Running",
  search: "Searching", test: "Testing", update: "Updating", validate: "Validating",
  verify: "Verifying", wait: "Waiting", write: "Writing",
};

function normalizeProgressLead(rawSentence: string): string {
  return rawSentence
    .trim()
    .replace(/^(?:[-*#>]+|\d+[.)])\s*/, "")
    .replace(/^(?:next|now|first|then),?\s+/i, "")
    .replace(/^(?:let me|i(?:'ll| will| am going to| need to| should)|we(?:'ll| will| need to| should))\s+/i, "")
    .replace(/^(?:i(?:'m| am)|we(?:'re| are))\s+/i, "")
    .replace(/^(?:接下来|现在|首先|然后|先|再|还要|继续|随后|另外|同时|并且?|此外)[，,：:\s]*/, "")
    .replace(/^我(?:正)?在\s*/, "正在")
    .replace(/^(?:让我(?:先)?|我(?:会先|会|将|先|来|要|需要))\s*/, "");
}

function isInternalAside(sentence: string): boolean {
  return /^(?:actually|however|but|because|since|so|maybe|perhaps|i think|hmm)\b/i.test(sentence)
    || /^(?:我)?(?:不过|但是|因为|所以|其实|实际上|也许|可能|嗯)/.test(sentence);
}

/** Pick an action clause even when a model prefixes it with a completed result
 *  (for example, "核心文献已就位，再核实两篇…"). */
function progressSentenceCandidate(rawSentence: string): string | undefined {
  const normalized = normalizeProgressLead(rawSentence);
  // Chinese action updates commonly put a completed status before the action
  // with a comma; English internal prose such as "Actually, I need to…"
  // should remain a single sentence so its aside guard still applies.
  const clauses = /[\u3400-\u9fff]/.test(rawSentence)
    ? normalized.split(/[，,：:]/)
    : [normalized];
  for (const clause of clauses) {
    const sentence = normalizeProgressLead(clause);
    if (!sentence || isInternalAside(sentence) || /^(?:已|结果|结论|完成|最终)/.test(sentence)) continue;
    if (PROGRESS_ACTION.test(sentence)) return sentence;
  }
  return undefined;
}

/** Reduce provisional assistant prose to one action sentence. This keeps live
 *  turns communicative without exposing the model's accumulating scratchpad. */
export function summarizeProgressText(raw: string): string | undefined {
  let text = raw.replace(/```[\s\S]*?```/g, " ");
  const privateTag = text.search(PRIVATE_PROGRESS_TAG);
  if (privateTag >= 0) text = text.slice(0, privateTag);
  text = text.replace(/```[\s\S]*$/, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;

  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text];
  let summary: string | undefined;
  for (const rawSentence of sentences) {
    let sentence = progressSentenceCandidate(rawSentence);
    if (!sentence) continue;

    const englishAction = /^([a-z]+)\b/i.exec(sentence);
    if (englishAction) {
      const action = englishAction[1].toLowerCase();
      const progressive = ENGLISH_PROGRESS_FORMS[action];
      if (progressive) sentence = progressive + sentence.slice(englishAction[0].length);
      else if (action.endsWith("ing")) {
        sentence = action.charAt(0).toUpperCase() + action.slice(1) + sentence.slice(englishAction[0].length);
      }
    } else if (!/^(?:正在|等待)/.test(sentence)) {
      sentence = `正在${sentence}`;
    }
    summary = sentence;
  }
  if (!summary) return undefined;
  const capped = summary.length > 120 ? `${summary.slice(0, 117).trimEnd()}...` : summary;
  return capped.replace(/[.!?。！？]+$/, "") + "…";
}

/** True when a text part is an action update rather than a mixed/private
 *  reasoning paragraph. This lets the adapter route the former directly to
 *  the visible progress lane without duplicating it under "Thinking". */
export function isPublicProgressText(raw: string): boolean {
  let text = raw.replace(/```[\s\S]*?```/g, " ");
  const privateTag = text.search(PRIVATE_PROGRESS_TAG);
  if (privateTag >= 0) text = text.slice(0, privateTag);
  text = text.replace(/```[\s\S]*$/, " ").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text];
  const meaningful = sentences.map(progressSentenceCandidate);
  return meaningful.length > 0 && meaningful.every((candidate) => !!candidate);
}

function isSystemReminder(text: string, source: RecordValue): boolean {
  const kind = String(source.kind ?? source.type ?? source.role ?? "").toLowerCase().replace(/[_\s]/g, "-");
  const plugin = String(source.plugin ?? source.name ?? "").toLowerCase();
  const form = String(source.form ?? "").toLowerCase();
  // DSH persists its runtime policy snapshots as user/message events emitted
  // by the system-prompt plugin. They are model instructions, not user turns,
  // and must stay out of the restored conversation transcript.
  if (kind === "plugin" && /system-prompt|runtime-context/.test(plugin)) return true;
  // Compaction's replacement user message is a model-visible checkpoint, not
  // a user-authored turn. The preceding compaction/summary event becomes the
  // auditable transcript marker; rendering this framed checkpoint as a user
  // bubble would duplicate the whole summarized context.
  if (kind === "plugin" && plugin === "compact") return true;
  if (form === "snapshot" && /^\s*Current runtime context\.\s+This snapshot supersedes earlier runtime-context snapshots\./i.test(text)) {
    return true;
  }
  return kind === "system" || kind === "system-reminder" || kind === "developer" || /^\s*<system-reminder\b/i.test(text);
}

function appendLanguagePolicy(text: string, language?: string | null): string {
  const normalized = language?.trim();
  const canonical = normalized ? canonicalLanguage(normalized) : undefined;
  const name = canonical ? (LANGUAGE_NAMES[canonical] ?? canonical) : undefined;
  const materialsContract = canonical && /^\/materials-run(?:\s|$)/u.test(text)
    ? `- Materials workflow language contract: pass response_language="${canonical}" to create_materials_workflow and every delegated materials task. Do not omit it or let a tool/schema default change it to English (en).\n- Materials skill text, tool descriptions, filenames, and scientific source material may be English, but they are not output-language instructions.`
    : "";
  const languageContract = name ? `Language policy (highest priority):
- Use ${name} for all user-visible natural-language output in this turn.
- Never reveal private chain-of-thought, hidden reasoning, scratch work, or internal deliberation in user-visible text.
- Keep progress updates and tool explanations concise: report only the action, material result, and any blocker.
- For long-running work, emit one brief progress update after each meaningful step and about every 15 seconds; do not narrate private reasoning.
- Give the conclusion first in the final answer and omit internal step-by-step deliberation.
- Do not switch to English because the app, tool, agent, command template, skill, or source material is in English.
- Keep code, commands, file paths, identifiers, citations, and quoted source text unchanged.
- If the user's request explicitly asks for another output language, follow that request.
${materialsContract ? `${materialsContract}\n` : ""}` : "";
  return `${text}${LANGUAGE_POLICY_START}${languageContract}${languageContract ? "\n" : ""}${BROWSER_TOOL_POLICY}
${LANGUAGE_POLICY_END}`;
}

/** Normalize common browser/i18next aliases before they reach a model or the
 * materials workflow's response_language field. */
function canonicalLanguage(language: string): string {
  const value = language.trim();
  const lower = value.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-sg" || lower === "zh-hans-cn") return "zh-Hans";
  if (lower === "en-us" || lower === "en-gb") return "en";
  if (lower === "pt-br") return "pt-BR";
  return value;
}

function stripLanguagePolicy(text: string): string {
  return stripInternalSection(text, LANGUAGE_POLICY_START, LANGUAGE_POLICY_END);
}

/** Keep desktop-only research context out of the user-visible transcript after
 * history restoration while retaining it in the exact prompt sent to the model. */
function stripResearchContext(text: string): string {
  return stripInternalSection(text, RESEARCH_CONTEXT_START, RESEARCH_CONTEXT_END);
}

function stripKnowledgeContext(text: string): string {
  return stripInternalSection(text, KNOWLEDGE_CONTEXT_START, KNOWLEDGE_CONTEXT_END);
}

function stripDeepResearchContext(text: string): string {
  return stripInternalSection(text, DEEP_RESEARCH_CONTEXT_START, DEEP_RESEARCH_CONTEXT_END);
}

function stripInternalSection(text: string, start: string, endMarker: string): string {
  const marker = text.indexOf(start);
  if (marker < 0) return text;
  const end = text.indexOf(endMarker, marker + start.length);
  if (end < 0) return text;
  return text.slice(0, marker);
}
