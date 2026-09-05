import type {
  AgentTaskPacket,
  AgentTaskResult,
  RuntimeStatus,
  ToolCallStatus,
} from "@ai4s/shared";

export type { AgentTaskPacket, AgentTaskResult, RuntimeStatus, ToolCallStatus };

/** DeepSeek Harness protocol release targeted by this adapter. */
export const DSH_VERSION = "1.18.12";

/** DeepSeek Harness web server default. */
export const DEFAULT_DSH_URL = "http://127.0.0.1:4096";

/** @deprecated Compatibility exports for third-party SDK consumers. */
export const OPENCODE_VERSION = DSH_VERSION;
/** @deprecated Compatibility export; use DEFAULT_DSH_URL. */
export const DEFAULT_OPENCODE_URL = DEFAULT_DSH_URL;

// ---- Normalized runtime events (DSH wire → app) ----
// DSH streams deltas while the app contract exposes idempotent "updated"
// events (full current value), so text/tool events carry a stable id and the
// app can upsert by that id. The old OpenCode name is retained only as a
// source-compatible alias at the bottom of this section.
// text/tool events carry a stable id and the app upserts by that id.

export interface TextUpdatedEvent {
  type: "text.updated";
  eventId?: string;
  sessionId: string;
  partId: string;
  text: string;
}
/** The model's private reasoning ("thinking") for a step. It stays separate
 *  from user-facing progress and the final answer so the UI can keep it folded. */
export interface ReasoningUpdatedEvent {
  type: "reasoning.updated";
  eventId?: string;
  sessionId: string;
  partId: string;
  text: string;
}
/** A short, user-facing description of the current action. Unlike reasoning,
 *  this is deliberately safe to show while a turn is still running. */
export interface ProgressUpdatedEvent {
  type: "progress.updated";
  eventId?: string;
  sessionId: string;
  partId: string;
  text: string;
}
/** A model "step" boundary (AI-SDK `step-start`). One turn can run several steps
 *  — each an LLM call, often followed by tool calls — so `step` (1-based) tells
 *  the user the turn is progressing, not frozen. */
export interface StepUpdatedEvent {
  type: "step.updated";
  eventId?: string;
  sessionId: string;
  step: number;
}
export interface ToolUpdatedEvent {
  type: "tool.updated";
  eventId?: string;
  sessionId: string;
  callId: string;
  tool: string;
  status: ToolCallStatus;
  title?: string;
  /** Tool arguments (e.g. a write tool's `filePath` + `content`). */
  input?: Record<string, unknown>;
  /** Tool result text, when the tool returned one. */
  output?: string;
  /** Accumulated stdout tail while the tool is still running (bash streams it
   *  via `state.metadata.output` on every update — verified on 1.17.13). */
  partialOutput?: string;
  /** Unified diff an edit tool reports in `state.metadata.diff`. */
  diff?: string;
  /** Epoch ms the tool started / finished (`state.time`). */
  startedAt?: number;
  endedAt?: number;
  /** A `task` tool's spawned subagent session — that session's interactive
   *  requests (question/permission) belong to THIS conversation. */
  childSessionId?: string;
  /** DSH tool/call is post-selection telemetry unless a plugin emits a
   *  pre-execution approval/requested frame first. */
  executionBoundary?: "pre-execution" | "observed";
}

export interface ToolPreEvent {
  type: "tool.pre";
  eventId?: string;
  sessionId: string;
  callId: string;
  tool: string;
  input?: Record<string, unknown>;
  decision: "pending" | "allow" | "block" | "require-human-approval";
  /** DSH emits tool/call after its own executor has been selected. */
  boundary?: "pre-execution" | "observed";
  reason?: string;
}

export interface ToolPostEvent {
  type: "tool.post";
  eventId?: string;
  sessionId: string;
  callId: string;
  tool: string;
  status: ToolCallStatus;
  output?: string;
  endedAt?: number;
  /** Whether the adapter saw a true executor pre-hook or a post-selection call. */
  executionBoundary?: "pre-execution" | "observed";
}

export interface TurnStartedEvent {
  type: "turn.started";
  eventId?: string;
  sessionId: string;
}

export interface TurnFinishedEvent {
  type: "turn.finished";
  eventId?: string;
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
}
export interface SessionIdleEvent {
  type: "session.idle";
  eventId?: string;
  sessionId: string;
}
/** The turn's model call failed and the server is retrying it — OpenCode backs
 *  off exponentially with NO attempt cap, so without surfacing these the UI
 *  shows a bare "Working…" forever while every attempt fails. */
/** A user message landed carrying its agent — including the build message
 *  OpenCode injects itself when the plan_exit question is answered Yes. The
 *  app syncs its per-session agent-mode state from this (never from question
 *  text, which is locale/version-brittle). */
export interface MessageAgentEvent {
  type: "message.agent";
  eventId?: string;
  sessionId: string;
  /** The user message's id, when known — lets the app tag the live message
   *  block so it can later be edited (revert + resend). */
  messageID?: string;
  /** Agent the user message carries; absent when OpenCode didn't set one. */
  agent?: string;
}

export interface SessionRetryEvent {
  type: "session.retry";
  eventId?: string;
  sessionId: string;
  attempt: number;
  /** The provider's error message for the failed attempt. */
  message: string;
  /** Epoch ms of the next scheduled attempt. */
  nextAt: number;
}

// ---- Interactive requests (the agent asks; the user must answer) ----
// OpenCode blocks the run until answered. Two kinds: a `question` (pick from
// options) and a `permission` (approve a command / file write / etc.).

export interface QuestionOption {
  label: string;
  description?: string;
}
export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  /** Allow selecting more than one option. */
  multiple?: boolean;
  /** Allow a free-text answer in addition to the options. */
  custom?: boolean;
}
export interface QuestionAskedEvent {
  type: "question.asked";
  eventId?: string;
  sessionId: string;
  requestId: string;
  questions: QuestionItem[];
}
/** A question was answered or rejected elsewhere — clear it from the UI. */
export interface QuestionResolvedEvent {
  type: "question.resolved";
  eventId?: string;
  sessionId: string;
  requestId: string;
}

export interface PermissionAskedEvent {
  type: "permission.asked";
  eventId?: string;
  sessionId: string;
  requestId: string;
  /** e.g. "bash", "write", "edit" — what the agent wants to do. */
  action: string;
  /** The concrete targets (a command line, file paths). */
  resources: string[];
}
export interface PermissionResolvedEvent {
  type: "permission.resolved";
  eventId?: string;
  sessionId: string;
  requestId: string;
}
export interface RuntimeErrorEvent {
  type: "error";
  eventId?: string;
  sessionId?: string;
  message: string;
}

/** The runtime compacted the conversation's older turns to stay inside the
 *  model's context window. Emitted so the thread can show one quiet marker
 *  instead of the user hitting "Input exceeds context window". */
export interface CompactedEvent {
  type: "session.compacted";
  eventId?: string;
  sessionId: string;
  /** True when the runtime decided on its own, false when the user asked. */
  auto: boolean;
  /** The context had already overflowed rather than merely neared the limit. */
  overflow?: boolean;
}

export type RuntimeMessageEvent =
  | TextUpdatedEvent
  | ReasoningUpdatedEvent
  | ProgressUpdatedEvent
  | CompactedEvent
  | StepUpdatedEvent
  | ToolUpdatedEvent
  | SessionIdleEvent
  | MessageAgentEvent
  | SessionRetryEvent
  | RuntimeErrorEvent
  | QuestionAskedEvent
  | QuestionResolvedEvent
  | PermissionAskedEvent
  | PermissionResolvedEvent;

/** @deprecated Use RuntimeMessageEvent. OpenCode is not a supported runtime. */
export type OpenCodeEvent = RuntimeMessageEvent;

export type RuntimeEvent =
  | RuntimeMessageEvent
  | ToolPreEvent
  | ToolPostEvent
  | TurnStartedEvent
  | TurnFinishedEvent;

export interface ToolGuardContext {
  sessionId: string;
  callId: string;
  tool: string;
  input?: Record<string, unknown>;
}

export interface ToolAdmissionDecision {
  decision: "allow" | "block" | "require-human-approval";
  reason?: string;
}

export type RuntimeToolGuard = (
  context: ToolGuardContext,
) => ToolAdmissionDecision | Promise<ToolAdmissionDecision>;

/** Approve a permission once, always (persist a rule), or reject it. */
export type PermissionReply = "once" | "always" | "reject";

/**
 * Capabilities are an explicit runtime contract. A UI control must be hidden
 * or disabled when the active DSH profile does not advertise it; unsupported
 * operations are not represented as universal AgentRuntime promises.
 */
export interface RuntimeCapabilities {
  runtime: "dsh" | "compatibility";
  sessions: {
    create: boolean;
    archive: boolean;
    unarchive: boolean;
    delete: boolean;
    revert: boolean;
    fork: boolean;
  };
  interaction: { questions: boolean; permissions: boolean; persistentRules: boolean };
  configuration: { providers: boolean; oauth: boolean; mcp: boolean };
  execution: { shell: boolean; commands: boolean; toolAdmission: "server" | "adapter" | "none" };
  surfaces: { desktop: boolean; web: boolean; readOnlyWeb: boolean };
}

// ---- REST shapes the app consumes ----

export interface SessionMeta {
  id: string;
  title: string;
  slug?: string;
  /** Workspace folder this session operates in (absolute path). */
  directory?: string;
  /** Set on subagent sessions: the session whose task tool spawned this one. */
  parentId?: string;
  /** Runtime lineage source. DSH marks delegated sessions as `subagent`. */
  origin?: string;
  /** Current server-side execution state when the runtime session list exposes
   * it. Used to recover live child-agent status after a frontend reload. */
  running?: boolean;
  /** Epoch ms the session was created / last updated (from OpenCode's `time`).
   *  Drives "Updated" timestamps and recency ordering. */
  created?: number;
  updated?: number;
  /** Epoch ms the user archived this conversation; absent when active.
   *  Archived conversations are kept and searchable — just out of the way. */
  archived?: number;
  /** The runtime's whole metadata object, so a write can merge instead of
   *  clobbering keys another client owns. */
  metadata?: Record<string, unknown>;
}

// ---- Optional DSH extension surfaces ----

export type CostMeterProviderMode = "usage" | "subscription" | "free" | "local";

export interface CostMeterBreakdown {
  id: string;
  mode: CostMeterProviderMode;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  /** Estimated public/list-price value in USD. */
  cost: number;
  /** Actual metered spend in USD after the provider billing mode is applied. */
  billedCost: number;
  savings: number;
}

export interface CostMeterSessionUsage extends Omit<CostMeterBreakdown, "mode"> {
  models: CostMeterBreakdown[];
  providers: CostMeterBreakdown[];
}

export interface CostMeterDayUsage {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  cost: number;
  billedCost: number;
  savings: number;
  models: CostMeterBreakdown[];
  providers: CostMeterBreakdown[];
  sessions: CostMeterSessionUsage[];
}

export interface CostMeterPriceTier {
  cacheHit: number;
  cacheWrite?: number;
  cacheMiss: number;
  output: number;
}

export interface CostMeterPrice extends CostMeterPriceTier {
  offPeak?: CostMeterPriceTier;
  peak?: CostMeterPriceTier;
  legacy?: boolean;
  source?: "official";
}

export type CostMeterBudgetPeriod = "day" | "month" | "all" | "custom";

export interface CostMeterConfig {
  locale: "auto" | "zh" | "en";
  position: "dock" | "header" | "off";
  sidebar: boolean;
  currency: string;
  symbol: string;
  decimals: number;
  exchangeRate: number;
  peakEnabled: boolean;
  peakEffectiveAt: string;
  peakWindows: Array<{ start: number; end: number }>;
  providerModes: Record<string, CostMeterProviderMode>;
  prices: { models: Record<string, CostMeterPrice>; default: CostMeterPrice };
  budget: {
    enabled: boolean;
    amount: number;
    period: CostMeterBudgetPeriod;
    customStart: string | null;
    customEnd: string | null;
    detail: boolean;
  };
  balance: { display: "sidebar" | "settings" | "both" | "off"; refreshMinutes: number };
  goQuota: {
    enabled: boolean;
    display: "sidebar" | "settings" | "both" | "off";
    refreshMinutes: number;
    apiKey: string;
    main: "rolling" | "weekly" | "monthly";
    detail: boolean;
  };
  corner: {
    enabled: boolean;
    goRolling: boolean;
    goWeekly: boolean;
    goMonthly: boolean;
    budget: boolean;
  };
  historyDays: number;
  fetchedAt: string | null;
  priceSource: string;
}

export interface CostMeterBalance {
  status: "off" | "ok" | "error";
  message: string;
  fetchedAt: number;
  currency: string;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
}

export interface CostMeterQuotaWindow {
  percent: number;
  resetsAt: string;
}

export interface CostMeterState {
  today: CostMeterDayUsage;
  month: CostMeterDayUsage;
  total: CostMeterDayUsage;
  budgetUsed: number;
  balance: CostMeterBalance;
  goQuota: {
    status: "off" | "ok" | "error";
    message: string;
    fetchedAt: number;
    rolling: CostMeterQuotaWindow | null;
    weekly: CostMeterQuotaWindow | null;
    monthly: CostMeterQuotaWindow | null;
  };
  history: CostMeterDayUsage[];
  config: CostMeterConfig;
  priceCatalog: {
    fetchedAt: string | null;
    modelCount: number;
    ignoredTiered: number;
    used: Array<{
      id: string;
      source: "models.dev";
      price: CostMeterPrice;
    }>;
  };
  meta: {
    now: number;
    timezoneOffsetMinutes: number;
    dayKey: string;
    monthKey: string;
  };
}

export interface CostMeterActionResult {
  ok: boolean;
  message: string;
  state?: CostMeterState;
}

/** Durable child-agent entry returned by DSH's subagent catalog. */
export interface SubagentInfo {
  id: string;
  mode: "one-shot" | "continuable";
  activity: "running" | "inactive";
  label?: string;
  hasChildren?: boolean;
}

/** One page of conversation history. Both the filter and the paging run on the
 *  server so a multi-year history never has to be held in memory. */
export interface SessionQuery {
  /** Rows per page. */
  limit?: number;
  /** Page from here (an epoch-ms `updated`); omit for the newest page. */
  cursor?: number | null;
  /** Server-side title search. */
  search?: string;
  /** Include archived conversations (they are excluded by default). */
  archived?: boolean;
  /** Return only user-facing root conversations. When set, `limit` is applied
   * after child/subagent sessions are excluded. */
  topLevelOnly?: boolean;
}

export interface SessionPage {
  sessions: SessionMeta[];
  /** Cursor for the next page, or null when the history is exhausted. */
  nextCursor: number | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  location?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  mode?: string;
  /** OpenCode's resolved per-agent model. Older runtimes may omit it or expose
   *  the already-joined provider/model string. */
  model?: string | { providerID?: string; modelID?: string };
}

/** A slash command the runtime can run. GET /command merges every source:
 *  config commands, skills, and MCP prompts — one list for the composer's
 *  "/" palette. */
export interface CommandInfo {
  name: string;
  description?: string;
  /** Where it came from, e.g. "command" | "skill" | "mcp". */
  source?: string;
  /** Agent the command pins, when it does. */
  agent?: string;
  /** The prompt text the command expands to. OpenCode stores that EXPANSION
   *  as the user message in history — the template lets the app reverse-map
   *  it back to the "/name" the user actually typed. */
  template?: string;
}

/** A message loaded from history (GET /session/:id/message). */
export interface HistoryMessage {
  role: "user" | "assistant";
  /** Runtime message id — the handle for reverting/editing a user message.
   *  Absent only on synthetic/mock messages. */
  id?: string;
  /** DSH event sequence containing this message. Used as the completed-turn
   *  anchor when DSH implements revert by forking a history prefix. */
  seq?: number;
  /** Epoch ms when the message finished — unset while it is still streaming.
   *  On the LAST message this is the server's truth for "is the turn over". */
  completed?: number;
  /** The error that ended this assistant turn, when it failed. Without it a
   *  failed turn whose live session.error was missed (SSE reconnect, app
   *  restart) reloads as an empty reply with no explanation at all. */
  error?: string;
  /** Agent that drove this message ("build" / "plan" / …) — required upstream
   *  on user messages; the app derives a session's agent mode from the last
   *  user message when (re)opening it. */
  agent?: string;
  parts: HistoryPart[];
}
export interface HistoryPart {
  type: string;
  text?: string;
  /** True on runtime-generated text (e.g. the "tool was executed by the user"
   *  marker a "!" shell run leaves in history) — not something the user typed. */
  synthetic?: boolean;
  tool?: string;
  state?: {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
    /** Epoch ms the tool started/finished — persisted with the part. */
    time?: { start?: number; end?: number };
    /** Tool-specific extras (bash stdout tail, edit diff, task session link). */
    metadata?: { output?: string; diff?: string };
  };
}

export interface OpenCodeClientOptions {
  /** Base URL of a running `opencode serve`, e.g. http://127.0.0.1:4096 */
  baseUrl?: string;
  /** Optional OPENCODE_SERVER_PASSWORD (basic auth). */
  password?: string;
  username?: string;
  /** Inject fetch (defaults to global fetch; browser + node both have it). */
  fetchImpl?: typeof fetch;
  /** Max time to wait for the SSE handshake before retrying. */
  connectTimeoutMs?: number;
  /** Max time to wait for short HTTP requests such as session creation. */
  requestTimeoutMs?: number;
  /**
   * Workspace directory the server should scope skill discovery to. OpenCode
   * initializes per-directory instances lazily; without this, /api/skill can
   * return an empty list until something else touches the workspace instance.
   */
  directory?: string;
}

// ---- Provider / model configuration (OpenCode-native, one source of truth) ----

export interface ProviderModelInfo {
  id: string;
  name: string;
  /** Reasoning-effort variant names this model exposes, ordered low→high as
   *  OpenCode reports them (e.g. ["minimal","low","medium","high"]). Empty when
   *  the model has no selectable reasoning levels. Pass one as `sendPrompt`'s
   *  `variant` to pick a per-turn effort; OpenCode maps it to the provider's
   *  native param (OpenAI reasoningEffort, Anthropic thinking, …). `listProviders`
   *  always sets it (possibly []); optional so terse fixtures can omit it. */
  variants?: string[];
}

/** A provider OpenCode can use right now (auth present or public). */
export interface ProviderInfo {
  id: string;
  name: string;
  models: ProviderModelInfo[];
}

/** Extra input an auth method needs before starting (e.g. Copilot deployment). */
export interface AuthPrompt {
  type: "select" | "text";
  key: string;
  message: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
}

export interface ProviderAuthMethod {
  type: "oauth" | "api";
  label: string;
  prompts?: AuthPrompt[];
}

/** Catalog entry: a provider OpenCode knows how to talk to (not necessarily connected). */
export interface ProviderCatalogEntry {
  id: string;
  name: string;
  /** Env var(s) that would carry the API key, e.g. ["ANTHROPIC_API_KEY"]. */
  env: string[];
}

export interface OAuthAuthorization {
  url: string;
  /** "auto" — callback completes on its own; "code" — the user pastes a code. */
  method: "auto" | "code";
  instructions: string;
}

// ---- MCP servers ----

export type McpConfig =
  | { type: "local"; command: string[]; enabled?: boolean; environment?: Record<string, string> }
  | { type: "remote"; url: string; enabled?: boolean; headers?: Record<string, string> };

export interface McpServer {
  name: string;
  /** e.g. "connected" | "failed" | "disabled" | "pending" */
  status: string;
  config?: McpConfig;
}

// ---- Raw OpenCode wire shapes (subset we consume) ----

export interface OpenCodeRawEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface OpenCodeTextPart {
  id: string;
  type: "text";
  text: string;
}
export interface OpenCodeToolPart {
  id: string;
  type: "tool";
  callID: string;
  tool: string;
  state: { status: "pending" | "running" | "completed" | "error"; title?: string };
}
export type OpenCodePart = OpenCodeTextPart | OpenCodeToolPart | { type: string };
