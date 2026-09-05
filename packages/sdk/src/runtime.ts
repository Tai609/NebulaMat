import type {
  AgentInfo,
  CommandInfo,
  HistoryMessage,
  RuntimeMessageEvent,
  RuntimeEvent,
  RuntimeToolGuard,
  PermissionAskedEvent,
  PermissionReply,
  QuestionAskedEvent,
  RuntimeStatus,
  SessionMeta,
  SubagentInfo,
  SessionPage,
  SessionQuery,
  SkillInfo,
  RuntimeCapabilities,
  CostMeterActionResult,
  CostMeterState,
} from "./types";

/**
 * The runtime-agnostic boundary between the app UI and the agent runtime.
 *
 * `AGENTS.md` mandates that the UI never calls DSH directly — it goes through
 * `packages/sdk`. This interface makes that seam explicit: it covers
 * ONLY the surface a generic agent runtime must expose (lifecycle, sessions,
 * capability discovery, model selection, and interactive requests).
 *
 * Provider / MCP / OAuth configuration is deliberately OUT of scope. Callers
 * discover those features through the runtime capability snapshot instead of
 * assuming an OpenCode-shaped universal surface.
 *
 * See `docs/rfc/agent-runtime.md` for the rationale. The sole implementation
 * today is `DeepSeekHarnessClient`; the legacy OpenCode adapter is only a
 * compatibility package and is not constructed by the desktop app.
 */
export interface AgentRuntime {
  // ---- lifecycle ----
  connect(): Promise<void>;
  close(): void;
  getStatus(): RuntimeStatus;
  onStatus(listener: (status: RuntimeStatus) => void): () => void;
  /** Legacy transcript-only event stream retained for existing consumers. */
  onEvent(listener: (event: RuntimeMessageEvent) => void): () => void;
  /** Full runtime-neutral lifecycle stream, including tool admission hooks. */
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
  onToolPre(listener: (event: Extract<RuntimeEvent, { type: "tool.pre" }>) => void): () => void;
  onToolPost(listener: (event: Extract<RuntimeEvent, { type: "tool.post" }>) => void): () => void;
  registerToolGuard(guard: RuntimeToolGuard): () => void;
  /** Capability snapshot; optional for third-party mocks and old adapters. */
  getCapabilities?: () => RuntimeCapabilities;

  // ---- sessions (a conversation) ----
  /** Create an isolated session, optionally giving it a concise title and a
   *  persistent parent link for delegated-agent ownership. */
  createSession(title?: string, parentId?: string): Promise<string>;
  /** The RECENT conversations, newest first, across every workspace folder,
   *  archived ones excluded. Bounded — a multi-year history is never held in
   *  memory; reach the rest through `querySessions`. */
  listSessions(): Promise<SessionMeta[]>;
  /** Enumerate durable direct children of a conversation when the runtime
   *  exposes a subagent catalog. Compatibility runtimes may omit this. */
  listSubagents?: (parentSessionId: string) => Promise<SubagentInfo[]>;
  /** Optional accounting extension supplied by the bundled DSH cost meter. */
  getCostMeterState?: () => Promise<CostMeterState>;
  updateCostMeterConfig?: (patch: Record<string, unknown>) => Promise<CostMeterState>;
  fetchCostMeterPrices?: () => Promise<CostMeterActionResult>;
  refreshCostMeterBalance?: () => Promise<CostMeterActionResult>;
  refreshCostMeterGoQuota?: () => Promise<CostMeterActionResult>;
  resetCostMeterHistory?: () => Promise<CostMeterState>;
  /** One page of conversation history, searched and paged on the server. */
  querySessions(query?: SessionQuery): Promise<SessionPage>;
  /** Archive a conversation. Restore is capability-gated because DSH core does
   *  not expose an unarchive RPC. */
  setSessionArchived(sessionId: string, archived: boolean): Promise<void>;
  /** Optional: DSH core intentionally has no deletion RPC. */
  deleteSession?: (sessionId: string) => Promise<void>;
  /** Give a session a title of the user's choosing. */
  renameSession(sessionId: string, title: string): Promise<void>;
  getMessages(sessionId: string): Promise<HistoryMessage[]>;
  /** `agent` pins a specific agent for the turn (e.g. the read-only "plan"
   *  agent); omit for the runtime default. `model` ("provider/model") pins the
   *  turn to the current default, overriding a session's stale creation-time
   *  binding; omit to use the session/runtime default. `variant` picks a
   *  per-turn reasoning-effort level (a name from the model's `variants`); omit
   *  for the model's default effort. `language` is the current UI/system
   *  locale used for model-visible natural-language output; runtimes without a
   *  language-aware transport may ignore it. */
  sendPrompt(
    sessionId: string,
    text: string,
    agent?: string,
    model?: string | null,
    variant?: string | null,
    language?: string | null,
  ): Promise<void>;
  /** Send direction to the next model step of an already-running session.
   *  This is deliberately separate from `sendPrompt`: steering must not create
   *  a new turn, acquire a second running lock, or appear as a normal user turn.
   */
  steerSession?(sessionId: string, text: string, language?: string | null): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  /** Revert the session to (and including) `messageID`, dropping it and every
   *  message after it. Runtimes that implement this through a fork may return
   *  the replacement session id; legacy transactional runtimes return void.
   *  The session must be idle first (abort a running turn before calling). */
  /** Optional: only runtimes with a transactional history API expose revert. */
  revert?: (sessionId: string, messageID: string, partID?: string) => Promise<void | string>;
  /** Undo the last revert where the runtime provides an inverse operation. */
  /** Optional inverse of revert. */
  unrevert?: (sessionId: string) => Promise<void>;

  // ---- capability discovery (what this runtime can do) ----
  listSkills(): Promise<SkillInfo[]>;
  listAgents(): Promise<AgentInfo[]>;
  listCommands(): Promise<CommandInfo[]>;

  // ---- model selection ----
  getDefaultModel(): Promise<string | null>;
  setDefaultModel(model: string): Promise<void>;

  // ---- agent-driven execution (a full turn, not a single prompt) ----
  /** Run a shell command in the session's workspace; no model turn. */
  runShell(sessionId: string, command: string, agent?: string): Promise<void>;
  /** Run a slash command (config command / skill / MCP prompt) as a full turn.
   * `language` is the current UI locale used for model-visible natural-language
   * output; runtimes without a language-aware command transport may ignore it.
   */
  runCommand(sessionId: string, command: string, args?: string, language?: string | null): Promise<void>;

  // ---- interactive requests (the agent asks; the user must answer) ----
  /** Pending questions in the workspace (recovery on open). */
  listQuestions(sessionId?: string): Promise<QuestionAskedEvent[]>;
  /** Pending permission requests in the workspace (recovery on open). */
  listPermissions(sessionId?: string): Promise<PermissionAskedEvent[]>;
  answerQuestion(requestId: string, answers: string[][]): Promise<void>;
  rejectQuestion(requestId: string): Promise<void>;
  /** Reply to a permission request: allow once, allow always, or reject. */
  replyPermission(requestId: string, reply: PermissionReply): Promise<void>;
}
