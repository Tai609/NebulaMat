import { create } from "zustand";
import {
  DeepSeekHarnessClient,
  DEFAULT_DSH_URL,
  type AgentInfo,
  type AgentRuntime,
  type CommandInfo,
  type HistoryMessage,
  type RuntimeMessageEvent,
  type RuntimeEvent,
  type RuntimeCapabilities,
  type SubagentInfo,
  type PermissionAskedEvent,
  type PermissionReply,
  type ProviderInfo,
  type QuestionAskedEvent,
  type SessionMeta,
  type SkillInfo,
  type ToolCallStatus,
  type ContextUsage,
} from "@ai4s/sdk";
import type { ArtifactBlock, RuntimeStatus, ThreadBlock } from "@ai4s/shared";
import {
  adoptWorkspaceSkills,
  detectTools as probeTools,
  commitWorkspaceSnapshot,
  createProject as createProjectFolder,
  importProject as importProjectFolder,
  setProjectPinned as setProjectPinnedCmd,
  deleteProject as deleteProjectCmd,
  getApprovalMode,
  installSkillMarkdown,
  isTauri,
  listProjects,
  logDebug,
  markSession,
  newDatedWorkspace,
  rememberDefaultModel,
  setApprovalMode as persistApprovalMode,
  setProxySetting as persistProxySetting,
  setWorkspace,
  startRuntime,
  runtimePassword,
  workspacePath,
  workspaceSkillNames,
  type ApprovalMode,
  type ProjectImportMode,
  type ProjectInfo,
  type ProxyMode,
  type ToolStatus,
} from "./tauri";
import { gatewayCapabilities, isGatewayWeb, gatewayToken, gatewayOrigin } from "./webMode";
import { pathKey, samePath } from "./workspacePath";
import { kernelReset } from "./kernel";
import { moveScrollMemory } from "./scrollMemory";
import { deriveArtifactPresentation } from "./artifacts";
import { leaves, useLayoutStore } from "./layout";
import { recordRuntimeToolArtifacts } from "./runtimeArtifactAudit";
import { provenanceInputsFromEvent } from "./provenance";
import {
  agentModelForRole,
  agentRoleFromTask,
  recordAgentAudit,
  reviewDecisionFromOutput,
  type AgentAuditInput,
} from "./agentAudit";
import { useSshStore } from "./ssh";
import {
  AUTO_REVIEW_KEY,
  AUTO_REVIEW_PROMPT,
  REVIEWER_AGENT,
  isMutatingTool,
  shouldAutoReview,
} from "./autoReview";
import { shouldRouteToMaterialsWorkflow } from "./materialsRouting";
import { researchToolGuard } from "./toolGovernance";
import { prepareModelPrompt, prepareModelPromptDetailed } from "./modelPromptPreparation";
import {
  buildDeepResearchCorrectionPrompt,
  buildDeepResearchIncompleteReport,
  deepResearchBlockers,
  getDeepResearchRun,
  incompleteDeepResearchRun,
  projectDeepResearchHistory,
  qualifyDeepResearchRun,
  recordDeepResearchGraphWrite,
  recordDeepResearchToolEvent,
  removeDeepResearchRun,
  retryDeepResearchRun,
  startDeepResearchRun,
  type DeepResearchRun,
} from "./deepResearchRun";
import { ensureDeepResearchGraph, writeDeepResearchEvidence } from "./deepResearchGraph";
import type { ResearchAssistantMode } from "./deepResearch";
import { notifyPermissionRequest } from "./systemNotification";
import {
  fallbackDefaultModel,
  filterSelectableProviders,
} from "@/components/settings/modelCatalog";
import { toast } from "@/lib/toast";
import i18n from "@/i18n";
import {
  foldEvent,
  historyToThread,
  lastAgentMode,
  settleRunningToolBlocks,
  type AgentMode,
} from "./runtimeTranscript";
export {
  foldCarriageReturns,
  foldEvent,
  historyToThread,
  humanizeCommand,
  lastAgentMode,
  subagentActivity,
  stripPrivateReasoning,
  tidyToolTitle,
  toolPresentation,
} from "./runtimeTranscript";
export type { AgentMode, FoldState } from "./runtimeTranscript";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PROVIDER_CATALOG_ATTEMPTS = 4;
const PROVIDER_CATALOG_RETRY_MS = 200;
const STARTUP_CATALOG_ATTEMPTS = 8;
const STARTUP_CATALOG_RETRY_MS = 500;

type CatalogListResult<T> = { items: T[]; succeeded: boolean };

/** DSH discovers the global skill packs and presets lazily while its profile
 *  warms. Retry those two independent lists so a slow first boot does not
 *  leave the UI permanently showing zero entries. */
async function listCatalogEventually<T>(
  read: () => Promise<T[]>,
): Promise<CatalogListResult<T>> {
  let items: T[] = [];
  for (let attempt = 0; attempt < STARTUP_CATALOG_ATTEMPTS; attempt += 1) {
    try {
      items = await read();
      if (items.length > 0 || attempt === STARTUP_CATALOG_ATTEMPTS - 1) {
        return { items, succeeded: true };
      }
    } catch {
      if (attempt === STARTUP_CATALOG_ATTEMPTS - 1) return { items, succeeded: false };
    }
    await sleep(STARTUP_CATALOG_RETRY_MS);
  }
  return { items, succeeded: false };
}

async function listProvidersEventually(dsh: DeepSeekHarnessClient): Promise<ProviderInfo[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < PROVIDER_CATALOG_ATTEMPTS; attempt++) {
    try {
      // The raw DSH catalog contains every installed provider. The configured
      // view joins it with settings and credential metadata so model pickers
      // only expose routes the user can actually call. Keep the fallback for
      // older test/remote adapters that predate this optional method.
      const list = typeof dsh.listConfiguredProviders === "function"
        ? dsh.listConfiguredProviders.bind(dsh)
        : dsh.listProviders.bind(dsh);
      const providers = filterSelectableProviders(await list());
      if (providers.length > 0 || attempt === PROVIDER_CATALOG_ATTEMPTS - 1) return providers;
    } catch (error) {
      lastError = error;
      if (attempt === PROVIDER_CATALOG_ATTEMPTS - 1) throw error;
    }
    await sleep(PROVIDER_CATALOG_RETRY_MS);
  }
  throw lastError instanceof Error ? lastError : new Error("Provider catalog unavailable");
}

const URL_KEY = "ai4s.dshUrl";
const DEFAULT_MODEL_KEY = "ai4s.models.default.v1";
const HIDDEN_KEY = "ai4s.hiddenExamples";
// The composer's chosen reasoning-effort variant, kept across restarts (favorites
// / recent models persist too, so the effort should as well). Sibling of the
// model-preferences keys in components/settings/modelPreferences.
const REASONING_KEY = "ai4s.models.variant.v1";
/** Per-session model + reasoning-effort overrides, persisted so a restored split
 *  layout keeps each pane's model/effort (they're keyed by real session id,
 *  which survives across runs). */
const SESSION_MODELS_KEY = "ai4s.session.models.v1";
const SESSION_VARIANTS_KEY = "ai4s.session.variants.v1";
const DEEP_RESEARCH_SESSIONS_KEY = "ai4s.session.deep-research.v1";
function loadRecord<V>(key: string): Record<string, V> {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function saveRecord(key: string, rec: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rec));
  } catch {
    /* storage full/unavailable never blocks a model switch */
  }
}

function initialUrl(): string {
  if (typeof window === "undefined") return DEFAULT_DSH_URL;
  return window.localStorage.getItem(URL_KEY)
    ?? window.localStorage.getItem("ai4s.opencodeUrl")
    ?? DEFAULT_DSH_URL;
}
function initialHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function initialReasoningVariant(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REASONING_KEY) || null;
}

function selectableSessionModels(): Record<string, string> {
  return loadRecord<string>(SESSION_MODELS_KEY);
}
function initialDefaultModel(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(DEFAULT_MODEL_KEY)?.trim();
  return value || null;
}
function initialAutoReview(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_REVIEW_KEY) === "1";
}

export interface Thread {
  blocks: ThreadBlock[];
  index: Record<string, number>;
  loaded: boolean;
}

/** Outcome of installSkill: the skill is already installed, or an agent session
 *  is doing it and the caller should open that session to watch. */
export type InstallSkillResult =
  | { kind: "installed"; name: string }
  | { kind: "session"; id: string };

/** What a session's right pane shows: an artifact inspector, the Files
 *  browser, the Runs ledger, or nothing. Mutually exclusive — one pane. */
export interface PaneState {
  artifact: ArtifactBlock | null;
  showFiles: boolean;
  showRuns: boolean;
  /** Unified input/preparation/result structure timeline for DFT and MD work. */
  showStructures: boolean;
  /** Materials capability/task DAG for the current session workspace. */
  showWorkflowDag: boolean;
  /** The subagent panel: what this conversation's subagents are doing (#63). */
  showAgents: boolean;
}

interface RuntimeState {
  status: RuntimeStatus;
  /** Capability snapshot from the active DSH adapter. */
  capabilities: RuntimeCapabilities | null;
  serverUrl: string;
  sessions: SessionMeta[];
  currentId: string | null;
  /** DSH revert maps the old conversation to a forked replacement. */
  sessionRedirects: Record<string, string>;
  threads: Record<string, Thread>;
  skills: SkillInfo[];
  agents: AgentInfo[];
  /** Slash commands the runtime can run ("/" palette): config commands,
   *  skills and MCP prompts, one merged list from GET /command. */
  commands: CommandInfo[];
  /** Configured default model ("provider/model"), or null when unset. */
  defaultModel: string | null;
  /** Apply a new default model and transparently reconnect (see impl). */
  setDefaultModel: (model: string) => Promise<void>;
  /** Connected providers and their models (from GET /config/providers, fetched
   *  in loadCatalog). Drives the composer's inline model picker; empty until the
   *  first catalog load. Kept here so the picker and Settings share one source. */
  providers: ProviderInfo[];
  /** Selected per-turn reasoning-effort variant name (e.g. "high"), or null for
   *  the model's default. Sent with the next prompt only if the current model
   *  actually exposes it — variant vocabularies differ across models. */
  reasoningVariant: string | null;
  setReasoningVariant: (variant: string | null) => void;
  /** Run the reviewer agent for one read-only turn whenever a turn changed
   *  workspace files (#72). Off by default: it is a second model turn, so the
   *  user opts in. Persisted locally (it is app behaviour, not sidecar config),
   *  which also makes it work in the gateway web client. */
  autoReview: boolean;
  setAutoReview: (enabled: boolean) => void;
  /** The last failed model switch's error, or null. While set, the Settings
   *  page keeps the model browser on screen (instead of the connect prompt)
   *  so the user can retry. Cleared by any successful reconnect, a successful
   *  switch, a server-URL change, or an explicit disconnect. */
  modelSwitchError: string | null;
  /** The composer's approval switch: "approve" (dangerous commands prompt)
   *  or "full" (everything in-workspace runs). Loaded from DSH permissions. */
  approvalMode: ApprovalMode;
  /** Persist a new approval mode (restarts the sidecar) and reconnect. */
  setApprovalMode: (mode: ApprovalMode) => Promise<void>;
  /** Persist the network-proxy setting (restarts the sidecar) and reconnect. */
  setProxySetting: (mode: ProxyMode, url: string) => Promise<void>;
  tools: ToolStatus[];
  hiddenExamples: string[];
  error: string | null;
  /** Pending interactive requests the agent is blocked on, newest last. */
  questions: QuestionAskedEvent[];
  permissions: PermissionAskedEvent[];
  /** Subagent session → the session whose task tool spawned it, learned from
   *  task tool events (live) and the session list (recovery after reload). */
  sessionParents: Record<string, string>;
  /** Runtime-owned durable child catalog, keyed by parent session id. */
  subagents: Record<string, SubagentInfo[]>;
  /** Right-pane state per session (DRAFT_KEY for a draft) — each session keeps
   *  its own open artifact / Files browser and gets it back when reopened.
   *  In-memory only: an app restart returns every session to a closed pane. */
  panes: Record<string, PaneState>;
  /** Composer agent switch per session (DRAFT_KEY for a draft); absent = build.
   *  In-memory, but reconciled from the message stream and history: DSH's
   *  plan_exit "Yes" continues the session as build — the pill must follow. */
  sessionAgents: Record<string, AgentMode>;
  /** Per-session model override (key = sid or DRAFT_KEY); absent = the global
   *  `defaultModel`. Lets each split pane run a different model without a global
   *  config switch (the model is sent per-turn), so switching one pane's model
   *  never changes the others. In-memory. */
  sessionModels: Record<string, string>;
  /** Per-session reasoning-effort override; absent = the global
   *  `reasoningVariant`. */
  sessionVariants: Record<string, string | null>;
  /** Per-session Deep Research mode. It is persisted so switching panes or
   *  restarting the desktop app does not silently drop a research workflow. */
  deepResearchSessions: Record<string, boolean | ResearchAssistantMode>;
  /** Set a session's model (per-pane); no sidecar config PATCH / reconnect. */
  setSessionModel: (sessionId: string, model: string) => void;
  /** Set a session's reasoning effort (per-pane). */
  setSessionVariant: (sessionId: string, variant: string | null) => void;
  /** Enable or disable the CEBRO-inspired Deep Research orchestrator. */
  setDeepResearch: (enabled: boolean, sessionId?: string) => void;
  /** Select one of the research lanes shown by the composer. */
  setResearchAssistantMode: (mode: ResearchAssistantMode | null, sessionId?: string) => void;
  // The pane/agent setters and turn actions below take an optional `sessionId`
  // so a split pane acts on its OWN session; omitted, they fall back to the
  // focused session (`currentId ?? DRAFT_KEY`) — the single-pane behavior.
  setAgentMode: (mode: AgentMode, sessionId?: string) => void;
  openArtifact: (a: ArtifactBlock, sessionId?: string) => void;
  closeArtifact: (sessionId?: string) => void;
  setShowFiles: (show: boolean, sessionId?: string) => void;
  setShowRuns: (show: boolean, sessionId?: string) => void;
  setShowStructures: (show: boolean, sessionId?: string) => void;
  setShowWorkflowDag: (show: boolean, sessionId?: string) => void;
  /** Send direction into the next model-step inbox without creating a turn. */
  steerSession: (text: string, sessionId?: string) => Promise<boolean>;
  setShowAgents: (show: boolean, sessionId?: string) => void;
  answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  replyPermission: (requestId: string, reply: PermissionReply) => Promise<void>;
  setServerUrl: (url: string) => void;
  loadCatalog: () => Promise<void>;
  detectTools: () => Promise<void>;
  connect: () => Promise<void>;
  /** Resolves true once connected, false when the retry window is exhausted. */
  connectRetry: (tries?: number) => Promise<boolean>;
  bootstrap: () => Promise<void>;
  disconnect: () => void;
  refreshSessions: () => Promise<void>;
  refreshSubagents: (parentSessionId: string) => Promise<void>;
  startDraft: () => void;
  /** Blank the draft view WITHOUT unpinning the folder the next session
   *  will be created in — only an explicit New may do that (#69). */
  resetDraftView: () => void;
  startDraftInCurrentWorkspace: (key?: string) => void;
  /** Projects: named shared workspaces under `<base>/projects`. Sessions group
   *  under a project by `directory`; multiple sessions share the folder. */
  projects: ProjectInfo[];
  refreshProjects: () => Promise<void>;
  /** Create a project folder and move into it with a fresh pinned draft. */
  createProject: (name: string) => Promise<ProjectInfo | null>;
  importProject: (path: string, mode: ProjectImportMode) => Promise<ProjectInfo | null>;
  setProjectPinned: (id: string, pinned: boolean) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  /** Fresh draft aimed at `path` (a project folder), so the session it creates
   *  lands there. `key` is the draft slot the composer sends under — a pane's
   *  own `draft:<leafId>` when the caller opened one. Skips the reconnect when
   *  the folder is already active. */
  startDraftInWorkspace: (path: string, key?: string) => Promise<void>;
  /** Active workspace folder (absolute path); null in the browser. */
  workspace: string | null;
  /** Web client only: the gateway token is read-only (GET-only) — every write
   *  (new session, prompt, approval) would 403, so the UI hides/disables them. */
  webReadOnly: boolean;
  /** Folder a pending draft's session must be created in, keyed by draft slot
   *  (`DRAFT_KEY`, or a pane's `draft:<leafId>`). Set when the user picks one —
   *  "+ new session in project X", or the folder picker. A draft with no entry
   *  gets its own fresh dated folder.
   *
   *  Per draft and holding the PATH, not a global boolean (#69): the active
   *  folder follows whatever session was last opened, so a bare "pinned" flag
   *  neither survived a glance at another session (the send landed in that
   *  session's folder) nor stayed out of the way of an unrelated new screen. */
  draftWorkspaces: Record<string, string>;
  /** A deliberate workspace move is in flight (event-stream reconnect into the
   *  new folder). The UI must not present it as a disconnection — no status
   *  flip, no Connect button, no help card. Real failures surface after the
   *  retry window is exhausted, once this clears. */
  switching: boolean;
  /** A sendPrompt is in flight for SOME session (click → POST accepted). Kept as
   *  the OR of `sendingSessions` for single-pane call sites; per-pane composers
   *  read `sendingSessions[sessionId]` instead. */
  sending: boolean;
  /** Sessions with a send in flight (POST not yet settled), keyed by id
   *  (DRAFT_KEY for a draft). Lets split panes send concurrently while still
   *  blocking a double-send to the SAME session. */
  sendingSessions: Record<string, true>;
  /** Sessions with an active turn (send accepted, session.idle not yet seen).
   *  Drives the composer lock and the "Working…" indicator. */
  runningSessions: Record<string, true>;
  /** Current model-step number per running session (from `step.updated`), so the
   *  working indicator can show "step N" — proof the turn is progressing, not
   *  hung. Reset when a turn starts and cleared on idle. */
  stepCounts: Record<string, number>;
  /** Sessions whose current turn is a user-typed "!" shell command. Their bash
   *  output shows inline in the thread — the output IS the result the user
   *  asked for. Agent bash steps stay quiet single-line log entries. */
  shellTurns: Record<string, true>;
  /** Sessions whose model call failed and is being retried server-side —
   *  DSH backs off with no attempt cap, so this is what keeps a broken
   *  provider from looking like a silent "Working…" forever. Cleared by the
   *  session's next sign of life (stream events, idle, error). */
  retryNotices: Record<string, { attempt: number; message: string }>;
  /** DSH token-meter projection, keyed by session. */
  contextUsage: Record<string, ContextUsage | null>;
  refreshContextUsage: (sessionId: string) => Promise<void>;
  compactSession: (sessionId?: string) => Promise<boolean>;
  compactingSessions: Record<string, true>;
  /** Switch to an existing folder, or (with `dated`) create a new dated one.
   *  `key` is the draft slot the switch was made for — the folder becomes that
   *  draft's destination. Defaults to the global slot. */
  switchWorkspace: (
    target: ({ path: string } | { dated: string }) & { key?: string },
  ) => Promise<void>;
  /** Ensure a brand-new draft already has its own (pinned) dated folder before
   *  composer files are written into it — otherwise a file added to a draft
   *  lands in the pre-send folder while send would create a different dated one,
   *  orphaning it. `key` must be the same per-pane draft slot later passed to
   *  sendPrompt. No-op once that draft folder is already pinned. */
  ensureDraftWorkspace: (key?: string) => Promise<void>;
  /** Open a session. Historical sessions normally follow their own folder;
   *  startup restoration can disable that one side effect so a persisted pane
   *  cannot move the whole app away from the registered project workspace. */
  openSession: (id: string, options?: { followWorkspace?: boolean }) => Promise<void>;
  /** Load a session's history into its thread WITHOUT switching the foreground
   *  folder/stream — for background split panes so they show their conversation
   *  on launch instead of a skeleton until focused. No-op if already loaded. */
  loadHistory: (id: string) => Promise<void>;
  /** `draftKey` (a `draft:<leafId>` slot) is the per-pane draft this send may
   *  lazily create a session from — passed by tiled panes so each unbound pane
   *  keeps its own draft/thread and creates its own session on first send. */
  sendPrompt: (text: string, sessionId?: string, draftKey?: string) => Promise<string | null>;
  /** Run a "!" shell command directly in the session's workspace folder —
   *  no model turn; the output folds into the thread as a bash tool row. */
  runShell: (command: string, sessionId?: string, draftKey?: string) => Promise<string | null>;
  /** Run a "/" slash command (config command / skill / MCP prompt). */
  runCommand: (name: string, args?: string, sessionId?: string, draftKey?: string) => Promise<string | null>;
  /** Interrupt a session's running turn (Stop button / Esc); the focused
   *  session when `sessionId` is omitted. */
  interrupt: (sessionId?: string) => Promise<void>;
  /** Edit a past user message: fork before that turn, drop it and everything
   *  after it in the visible conversation, then resend the corrected text as a
   *  new turn. Destructive: callers must confirm first. */
  editMessage: (messageID: string, newText: string, sessionId?: string) => Promise<void>;
  /** Fork before a past user message WITHOUT resending — drops it and
   *  everything after it in the visible conversation. Returns whether it
   *  succeeded (the caller prefills the composer with the message on success).
   *  The original session remains available as a history copy. */
  revertMessage: (messageID: string, sessionId?: string) => Promise<boolean>;
  /** Check every session holding a running lock against the server: if its
   *  turn is actually over (idle was missed — SSE reconnect windows, the
   *  directory-scoped event stream), reload the missed history and unlock. */
  reconcileRunning: () => Promise<void>;
  /** Returns false when DSH exposes no deletion capability or the request fails. */
  deleteSession: (id: string) => Promise<boolean>;
  /** Retitle a session. Resolves false when the runtime rejected the rename
   *  (the old title stays); the caller shows nothing else. */
  renameSession: (id: string, title: string) => Promise<boolean>;
  /** File an existing conversation under a project folder (#62): the session
   *  moves, its workspace files stay put. Resolves false on failure. */
  moveSessionToWorkspace: (id: string, directory: string) => Promise<boolean>;
  /** Archive a conversation (or restore it). Nothing is deleted — archiving
   *  only takes it out of the sidebar and the default history view. */
  setSessionArchived: (id: string, archived: boolean) => Promise<boolean>;
  hideExample: (id: string) => void;
  /** Install a skill. A pasted SKILL.md is written straight into the profile's
   *  user skills dir (`installed`); anything else (a URL, a description) hands
   *  the job to an agent session (`session`, whose id the caller opens) and is
   *  adopted into that same dir when the session finishes. null on failure. */
  installSkill: (text: string) => Promise<InstallSkillResult | null>;
  /** Ensure a live background event stream for every workspace folder shown in
   *  a split pane (besides the foreground folder), and drop streams for folders
   *  no longer tiled — so sessions across DIFFERENT projects stream live at once.
   *  Desktop only (single-pane on web). */
  syncPaneStreams: (directories: string[]) => void;
}

// The internal store depends only on the runtime-agnostic AgentRuntime contract
// (see docs/rfc/agent-runtime.md). The concrete DSH reference (dshClient) is
// kept separately so getClient() can hand Settings/setup the full DSH
// provider/MCP surface that lives outside the AgentRuntime contract.
let client: AgentRuntime | null = null;
let dshClient: DeepSeekHarnessClient | null = null;
let openSessionSeq = 0;
/** Ignore an older catalog response that finished after a newer reconnect or
 *  explicit model switch. Without this, a slow first-boot read can overwrite
 *  the model resolved by the current connection. */
let catalogLoadSeq = 0;
/** The model the user last DELIBERATELY switched to, and when. A switch does a
 *  masked reconnect, and connect() fires loadCatalog() un-awaited — so the
 *  self-heal there can run just after `switching` clears, read the reconnecting
 *  instance's not-yet-complete provider list, judge the just-picked model
 *  "dangling", and revert it to an old one (a switch then "doesn't take"; #37).
 *  Remember the choice briefly so the self-heal won't fight it during that
 *  window; a model that is GENUINELY gone still heals once the window lapses,
 *  and the send-time "model not found" error covers the gap meanwhile. */
let lastSwitchModel: string | null = null;
let lastSwitchAt = 0;
const SWITCH_HEAL_GRACE_MS = 15_000;
/** React StrictMode mounts effects twice in development. Share the same boot
 *  promise so duplicate AppShell effects cannot start dueling connect loops. */
let bootstrapInFlight: Promise<void> | null = null;
/** Registered once: the remote-access gateway tells us when a LAN/CLI client
 *  created or deleted a session so the sidebar re-lists (no DSH event for
 *  session create/delete). See docs/rfc/remote-access-gateway.md. */
let gatewayListenerBound = false;
/** Custom-model context-limit cleanup (#52) runs once per app run — every
 *  reconnect re-enters connect(), and the check is a config round-trip. */
let contextLimitsCleaned = false;
/** Unhook the current client's status listener BEFORE closing it — teardown
 *  emits "offline", and a reconnect attempt must not flash that at the user. */
let clientStatusUnsub: (() => void) | null = null;
/** An agent skill install in flight: the session doing it, and the workspace's
 *  skills as they were before it started. When that session goes idle whatever
 *  it added is adopted into the profile's user skills dir (#61). One at a time —
 *  the Skills page starts one install per click. */
let pendingSkillInstall: { sessionId: string | null; known: string[] } | null = null;

/** Does this text look like a SKILL.md the app can install itself (YAML
 *  frontmatter with a name)? The Rust command owns the strict rules — this only
 *  decides whether to skip the agent. */
function looksLikeSkillFile(text: string): boolean {
  const body = text.replace(/^\uFEFF/, "").trimStart();
  if (!body.startsWith("---")) return false;
  const end = body.indexOf("\n---", 3);
  return end > 0 && /^\s*name:\s*\S/m.test(body.slice(3, end));
}

/** The SDK recovers a dropped stream in ~250ms (DSH closes its stream ~1s
 *  after a config PATCH while rebuilding its instance). Surfacing that blip
 *  repaints every status consumer, so a ready→connecting flip is held this
 *  long and only shown if the stream does not come back. */
const STATUS_BLIP_GRACE_MS = 2000;
let statusBlipTimer: ReturnType<typeof setTimeout> | null = null;
function clearStatusBlip() {
  if (statusBlipTimer !== null) clearTimeout(statusBlipTimer);
  statusBlipTimer = null;
}
function teardownClient() {
  clientStatusUnsub?.();
  clientStatusUnsub = null;
  clearStatusBlip();
  client?.close();
  client = null;
  dshClient = null;
}

// ---- Cross-folder streaming (split panes) ----
// The foreground `client` streams the ACTIVE folder. Split panes showing
// sessions from OTHER folders each get a background stream here, keyed by
// directory, so they update live concurrently. All streams fold through the one
// `sharedEventHandler` — events carry `sessionId` and the store is sid-keyed, so
// N streams need no per-stream demux. Same sidecar → same baseUrl/password.
const streamClients = new Map<string, DeepSeekHarnessClient>();
let streamBaseUrl = "";
let streamPassword: string | undefined;
/** The store's event handler, captured once (set/get are stable) so foreground
 *  and every background stream share one folding path. */
let sharedEventHandler: ((event: RuntimeMessageEvent) => void) | null = null;
let sharedRuntimeEventHandler: ((event: RuntimeEvent) => void) | null = null;
function removeStreamClient(dir: string) {
  const c = streamClients.get(dir);
  if (c) {
    c.close();
    streamClients.delete(dir);
  }
}
function teardownStreamClients() {
  for (const c of streamClients.values()) c.close();
  streamClients.clear();
}
/** The connected client whose stream owns `sid` — its folder's background
 *  stream, else the foreground client. Session-scoped calls (send/abort/history)
 *  work through any client, but the directory-scoped interactive replies
 *  (question/permission) must go to the matching per-directory instance. */
function clientForSession(get: StoreGet, sid: string): AgentRuntime | null {
  // Subagent asks carry the CHILD sid (which may not be listed in `sessions`
  // yet); resolve to the root session to find the owning folder, mirroring how
  // belongsHere surfaces the ask in the parent's pane.
  const root = rootSessionOf(get().sessionParents, sid);
  const dir = get().sessions.find((x) => x.id === root)?.directory;
  if (dir && dir !== get().workspace) {
    const bg = streamClients.get(dir);
    if (bg) return bg;
  }
  return client;
}
const emptyThread = (): Thread => ({ blocks: [], index: {}, loaded: false });

/** Forget a draft's chosen folder — its session was created, or the user asked
 *  for a plain New. Absent means "give the next session a fresh dated folder". */
function forgetDraftFolder(s: RuntimeState, key: string) {
  if (!(key in s.draftWorkspaces)) return {};
  const draftWorkspaces = { ...s.draftWorkspaces };
  delete draftWorkspaces[key];
  return { draftWorkspaces };
}

/** Drop the global draft slot's leftovers: an aborted first message, its pane
 *  and its Build/Plan mode. Deliberately says nothing about the draft's folder —
 *  see `startDraft` vs `resetDraftView` (#69). */
function blankDraft(s: RuntimeState, key: string = DRAFT_KEY) {
  const threads = { ...s.threads };
  delete threads[key];
  const panes = { ...s.panes };
  delete panes[key];
  const sessionAgents = { ...s.sessionAgents };
  delete sessionAgents[key];
  const deepResearchSessions = { ...s.deepResearchSessions };
  delete deepResearchSessions[key];
  return { currentId: null, threads, panes, sessionAgents, deepResearchSessions };
}

/** A registered project is a deliberate long-lived workspace. An explicit New
 * there should keep the next session in that project; ordinary session folders
 * still receive a fresh dated workspace. */
function registeredProjectWorkspace(s: RuntimeState): string | undefined {
  if (!s.workspace) return undefined;
  return s.projects.some((project) => samePath(project.path, s.workspace)) ? s.workspace : undefined;
}

/** Legacy installs placed dated sessions under Documents/OpenScience. Once a
 * project workspace is selected, opening one of those historical sessions
 * must not silently pull the entire app back to the retired storage root. */
function isLegacyDatedSession(path: string): boolean {
  return /[/\\]Documents[/\\]OpenScience[/\\]sessions[/\\]/i.test(pathKey(path));
}

function shouldFollowSessionWorkspace(active: string | null, session: string): boolean {
  if (!active || !isLegacyDatedSession(session)) return true;
  // Keep the legacy behavior when the app is already operating inside the
  // legacy tree; only a project workspace opts out of the old dated folders.
  if (isLegacyDatedSession(active)) return true;
  const root = pathKey(active).replace(/\/$/, "");
  return pathKey(session) === root || pathKey(session).startsWith(`${root}/`);
}

/** DSH returns this for a pane restored from a previous installation/profile.
 *  It is recoverable: the session is gone, so the layout should fall back to a
 *  blank draft instead of rendering a permanent red history error. */
function isMissingSessionError(message: string): boolean {
  return /\bsession\b/i.test(message) && /\bnot found\b/i.test(message);
}

/** A healthy session can briefly fail history reads while the desktop bridge
 *  is reconnecting to DSH. These errors are transport state, not evidence that
 *  the persisted conversation is missing or corrupt. */
function isTransientHistoryError(message: string): boolean {
  return (
    /DSH \/api\/session\.history returned HTTP (?:408|425|429|5\d\d)\b/i.test(message) ||
    /\b(?:load failed|failed to fetch|network ?error|signal is aborted|timed? out|timeout)\b/i.test(message)
  );
}
/** Threads key for the draft conversation — its blocks move to the real
 *  session id once the session exists, so the page never visibly resets. */
export const DRAFT_KEY = "draft";

/** A tiled pane's own draft slot, keyed by its leaf id, so multiple unbound
 *  panes each hold an independent draft (thread/composer/model/agent) and each
 *  create their own session on first send — instead of sharing DRAFT_KEY. */
export const draftKeyFor = (leafId: string): string => `draft:${leafId}`;

/** The composer's agent switch: "build" edits and runs; "plan" is DeepSeek Harness's
 *  read-only planning agent (edits denied except its plan .md file). */
/** One bounded retry for the first POSTs after a sidecar restart — the old
 *  connection occasionally dies mid-handshake ("Load failed"). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await sleep(600);
    return await fn();
  }
}
/** Dedup Sets below hold completed callIds/requestIds that never recur, but a
 *  long, tool-heavy session keeps adding to them forever (issue #34: unbounded
 *  frontend state → multi-GB WebContent). Cap each with FIFO eviction of the
 *  oldest — safe, since an evicted id belongs to a finished call. */
const DEDUP_CAP = 4000;
function remember(set: Set<string>, key: string, cap = DEDUP_CAP) {
  set.add(key);
  while (set.size > cap) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

/** Agent audit records are append-only, so repeated SSE terminal frames must
 *  not append duplicate lifecycle or revision events. */
const recordedAgentAudit = new Set<string>();
interface ActiveAgentTask {
  agentId: string;
  role: string;
  sessionId: string;
  parentSessionId?: string;
  parentTaskId?: string;
  model?: string;
  startedAt: number;
  taskInput?: Record<string, unknown>;
}
const activeAgentTasks = new Map<string, ActiveAgentTask>();
/** A task tool can name its child only on an early SSE frame. Retain the
 *  association so a later terminal frame can still close the audit lifecycle. */
const delegatedAgentByCall = new Map<string, string>();
const agentDeliverables = new Map<string, Set<string>>();
const agentDiffs = new Map<string, string[]>();
const activeOrchestratorTurns = new Map<string, ActiveAgentTask>();
const notifiedPermissions = new Set<string>();
/** A completed presentation tool can be repeated by SSE reconciliation. Layout
 *  mutations are not idempotent, so handle each call exactly once. */
const handledPresentations = new Set<string>();
/** `ssh_connect` calls already relayed to the sign-in dialog (#73). One tool call
 *  emits several `tool.updated` events — the SDK re-emits per part update, so
 *  "pending" then "running" at least — and starting a sign-in is anything but
 *  idempotent: each repeat raced another ssh master for the same ControlPath. */
const relayedSignIns = new Set<string>();

/** Sessions the user just interrupted: the thread already shows "Interrupted",
 *  so the abort's own trailing events (an "aborted" error and one or more
 *  session.idle events) must not add a second line. Armed before the abort POST
 *  and held across every trailing event; the next turn clears it (`turn → sid`). */
const interruptedSessions = new Set<string>();
const deepResearchTextBuffers = new Map<string, Map<string, Extract<RuntimeMessageEvent, { type: "text.updated" }>>>();
const deepResearchReleaseSessions = new Set<string>();
const deepResearchIdlePassThrough = new Set<string>();
const deepResearchFinalizingSessions = new Set<string>();

// ---- Auto-review (#72) ----
// All four live outside the store on purpose: they change on tool events, and
// store writes on streamed events repaint every subscriber (#50). Nothing here
// is rendered — the review's own turn is what the user sees.
/** Sessions whose CURRENT turn has written or edited a workspace file. */
const dirtyTurns = new Set<string>();
/** Isolated reviewer child session -> parent session under review. */
const reviewTurns = new Map<string, string>();
/** Sessions waiting for the single review slot, oldest first. */
const reviewQueue: string[] = [];
/** The session being reviewed right now, or null. Exactly one review runs at a
 *  time: concurrent reviews across tiled panes are what starved the main thread
 *  in #50, and a review is never urgent. */
let reviewInFlight: { parentId: string; childId: string | null } | null = null;

/** Forget every trace of a session's review state (session deleted, runtime
 *  torn down) so a queued id can't resurrect a review for a gone session. */
function forgetAutoReview(sid: string) {
  dirtyTurns.delete(sid);
  reviewTurns.delete(sid);
  for (const [child, parent] of reviewTurns) if (parent === sid) reviewTurns.delete(child);
  const at = reviewQueue.indexOf(sid);
  if (at >= 0) reviewQueue.splice(at, 1);
  if (reviewInFlight?.parentId === sid || reviewInFlight?.childId === sid) reviewInFlight = null;
}

function auditAgent(input: AgentAuditInput): void {
  void recordAgentAudit(input).catch((error) =>
    logDebug(`agent audit skipped: ${error instanceof Error ? error.message : String(error)}`),
  );
}

function deliverablesFor(sessionId: string): string[] {
  return [...(agentDeliverables.get(sessionId) ?? [])];
}

function rememberAgentArtifact(event: Extract<RuntimeMessageEvent, { type: "tool.updated" }>, get: StoreGet): void {
  if (!isMutatingTool(event.tool, event.status)) return;
  const task = activeAgentTasks.get(event.sessionId) ?? activeOrchestratorTurns.get(event.sessionId);
  const role = task?.role ?? (get().sessionParents[event.sessionId] ? "specialist" : "orchestrator");
  const model = task?.model ?? agentModelForRole(get().agents, role, get().defaultModel, event.input);
  const parent = task?.parentSessionId ?? get().sessionParents[event.sessionId];
  const root = parent ? rootSessionOf(get().sessionParents, parent) : event.sessionId;
  const artifactOwners = root === event.sessionId ? [event.sessionId] : [event.sessionId, root];
  for (const artifact of provenanceInputsFromEvent(event)) {
    for (const owner of artifactOwners) {
      let paths = agentDeliverables.get(owner);
      if (!paths) agentDeliverables.set(owner, (paths = new Set()));
      paths.add(artifact.path);
    }
    const key = `revision:${event.callId}:${artifact.path}`;
    if (recordedAgentAudit.has(key)) continue;
    remember(recordedAgentAudit, key);
    if (event.diff) {
      for (const owner of artifactOwners) {
        const diffs = agentDiffs.get(owner) ?? [];
        diffs.push(event.diff);
        agentDiffs.set(owner, diffs.slice(-20));
      }
    }
    auditAgent({
      eventType: "artifact.revised",
      agentId: task?.agentId ?? event.sessionId,
      role,
      sessionId: event.sessionId,
      ...(task?.parentSessionId ? { parentSessionId: task.parentSessionId } : {}),
      ...(task?.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
      ...(model ? { model } : {}),
      endedAt: event.endedAt ?? Date.now(),
      status: "success",
      deliverables: [artifact.path],
      ...(event.diff ? { revisionDiff: event.diff } : {}),
    });
  }
}

function trackDelegatedAgent(
  event: Extract<RuntimeMessageEvent, { type: "tool.updated" }>,
  get: StoreGet,
): void {
  const callKey = `${event.sessionId}:${event.callId}`;
  const child = event.childSessionId ?? delegatedAgentByCall.get(callKey);
  if (!child) return;
  if (event.childSessionId) delegatedAgentByCall.set(callKey, event.childSessionId);
  let task = activeAgentTasks.get(child);
  if (!task) {
    const role = agentRoleFromTask(event.input, event.title);
    agentDeliverables.delete(child);
    agentDiffs.delete(child);
    task = {
      agentId: child,
      role,
      sessionId: child,
      parentSessionId: event.sessionId,
      parentTaskId: event.callId,
      model: agentModelForRole(get().agents, role, get().defaultModel, event.input),
      startedAt: event.startedAt ?? Date.now(),
      taskInput: event.input,
    };
    activeAgentTasks.set(child, task);
    const startKey = `start:${event.callId}:${child}`;
    if (!recordedAgentAudit.has(startKey)) {
      remember(recordedAgentAudit, startKey);
      auditAgent({
        eventType: "agent.started",
        ...task,
        status: "running",
      });
    }
  }
  if (!(["success", "warning", "failed"] as ToolCallStatus[]).includes(event.status)) return;
  delegatedAgentByCall.delete(callKey);
  const doneKey = `done:${event.callId}:${child}`;
  if (recordedAgentAudit.has(doneKey)) return;
  remember(recordedAgentAudit, doneKey);
  const emptyTaskResult =
    event.tool === "task" &&
    typeof event.output === "string" &&
    /<task_result>([\s\S]*?)<\/task_result>/i.test(event.output) &&
    !(/<task_result>([\s\S]*?)<\/task_result>/i.exec(event.output)?.[1].trim());
  const taskError =
    event.tool === "task" && typeof event.output === "string"
      ? /<task_error>([\s\S]*?)<\/task_error>/i.exec(event.output)?.[1].trim()
      : undefined;
  const failed = event.status === "failed" || emptyTaskResult || Boolean(taskError);
  const reviewDecision = reviewDecisionFromOutput(event.output);
  auditAgent({
    eventType: failed ? "agent.failed" : "agent.completed",
    ...task,
    endedAt: event.endedAt ?? Date.now(),
    status: failed ? "failed" : event.status,
    ...(taskError
      ? { outputSummary: taskError }
      : emptyTaskResult
        ? {
            outputSummary:
              "The subagent returned an empty task result. Treat this as a provider-stream failure, not a successful empty finding.",
          }
        : event.output
          ? { outputSummary: event.output }
          : {}),
    deliverables: deliverablesFor(child),
    ...(agentDiffs.get(child)?.length ? { revisionDiff: agentDiffs.get(child)!.join("\n") } : {}),
  });
  if (reviewDecision) {
    auditAgent({
      eventType: "review.decision",
      ...task,
      endedAt: event.endedAt ?? Date.now(),
      status:
        reviewDecision.decision ??
        (reviewDecision.findings.some(
          (finding) => finding.level === "error" || finding.level === "warn",
        )
          ? "revise"
          : "approve"),
      deliverables: deliverablesFor(child),
      reviewDecision,
    });
  }
  activeAgentTasks.delete(child);
  agentDeliverables.delete(child);
  agentDiffs.delete(child);
}

function startOrchestratorAudit(sessionId: string, prompt: string, get: StoreGet): void {
  agentDeliverables.delete(sessionId);
  agentDiffs.delete(sessionId);
  const role = "orchestrator";
  const task: ActiveAgentTask = {
    agentId: sessionId,
    role,
    sessionId,
    model: get().sessionModels[sessionId] ?? agentModelForRole(get().agents, role, get().defaultModel),
    startedAt: Date.now(),
    taskInput: { prompt },
  };
  activeOrchestratorTurns.set(sessionId, task);
  auditAgent({ eventType: "agent.started", ...task, status: "running" });
}

function finishOrchestratorAudit(
  sessionId: string,
  get: StoreGet,
  failed = false,
  failureReason?: string,
): void {
  const task = activeOrchestratorTurns.get(sessionId);
  if (!task) return;
  activeOrchestratorTurns.delete(sessionId);
  const blocks = get().threads[sessionId]?.blocks ?? [];
  const output = [...blocks]
    .reverse()
    .find((block) => block.kind === "agent");
  auditAgent({
    eventType: failed ? "agent.failed" : "agent.completed",
    ...task,
    endedAt: Date.now(),
    status: failed ? "failed" : "success",
    ...(failed && failureReason
      ? { outputSummary: failureReason }
      : output?.kind === "agent"
        ? { outputSummary: output.markdown }
        : {}),
    deliverables: deliverablesFor(sessionId),
    ...(agentDiffs.get(sessionId)?.length
      ? { revisionDiff: agentDiffs.get(sessionId)!.join("\n") }
      : {}),
  });
}

function failOpenAgentAudits(reason: string): void {
  const endedAt = Date.now();
  for (const task of activeAgentTasks.values()) {
    const artifactSession =
      task.role === REVIEWER_AGENT && task.parentSessionId ? task.parentSessionId : task.sessionId;
    auditAgent({
      eventType: "agent.failed",
      ...task,
      endedAt,
      status: "failed",
      outputSummary: reason,
      deliverables: deliverablesFor(artifactSession),
      ...(agentDiffs.get(artifactSession)?.length
        ? { revisionDiff: agentDiffs.get(artifactSession)!.join("\n") }
        : {}),
    });
  }
  for (const task of activeOrchestratorTurns.values()) {
    auditAgent({
      eventType: "agent.failed",
      ...task,
      endedAt,
      status: "failed",
      outputSummary: reason,
      deliverables: deliverablesFor(task.sessionId),
      ...(agentDiffs.get(task.sessionId)?.length
        ? { revisionDiff: agentDiffs.get(task.sessionId)!.join("\n") }
        : {}),
    });
  }
  activeAgentTasks.clear();
  activeOrchestratorTurns.clear();
  delegatedAgentByCall.clear();
  agentDeliverables.clear();
  agentDiffs.clear();
}

/** Longest error text written to debug.log. The diagnostic value is in the first
 *  sentence; some providers append an entire response body. */
const LOG_ERROR_MAX = 300;

/**
 * An error message made safe to persist in debug.log. Provider errors are echoed
 * verbatim from an HTTP response, so one could quote back the credential that
 * failed — and debug.log is a plain file users attach to bug reports, where a key
 * must never appear (AGENTS.md). Known key shapes go first, then any long
 * secret-looking run, then a length cap.
 */
export function redactForLog(message: string): string {
  const redacted = message
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xoxb|xoxp|xapp|glpat|hf)[-_][A-Za-z0-9_-]{6,}/g, "$1-***")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 ***")
    .replace(/[A-Za-z0-9_-]{40,}/g, "***");
  return redacted.length > LOG_ERROR_MAX ? `${redacted.slice(0, LOG_ERROR_MAX)}…` : redacted;
}

/**
 * A runtime error with the one thing the user cannot work out alone appended.
 * Only for failures whose text is accurate but leaves no way forward — the
 * provider's own wording is always kept, never replaced.
 */
export function explainRuntimeError(message: string): string {
  // A dangling default model (its provider removed or renamed) fails every send
  // the same way — point at where the fix lives.
  if (/model not found/i.test(message)) {
    return `${message} Pick an available model in Settings → Models.`;
  }
  // OpenAI answers `invalid_prompt` / "Request blocked." when its content filter
  // rejects the PROMPT — and a prompt is the whole conversation, resent on every
  // turn. So "try again" reproduces it exactly (observed: three identical
  // failures in a row), which reads as the app being broken. The way out is to
  // stop resending the offending history, or to ask a provider that will take it.
  if (/^request blocked\.?$/i.test(message.trim())) {
    return (
      `${message} The provider's content filter rejected this conversation, not just your last message — ` +
      `every retry resends the same history, so it will keep failing. Edit or delete the recent messages, ` +
      `start a new session, or switch to another model or provider.`
    );
  }
  return message;
}

/** Server-side truth for "is this session's turn over": the last message is an
 *  assistant message that has finished streaming (time.completed set). A last
 *  USER message means a turn was accepted but not yet answered — still running. */
export function turnIsOver(messages: HistoryMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.role === "assistant" && !!last.completed;
}

/** Server truth that a session is mid-answer RIGHT NOW: its last message is an
 *  assistant message that has not finished streaming. Deliberately narrower
 *  than `!turnIsOver` — that also reads a trailing USER message as running, a
 *  shape a crashed or never-answered turn leaves behind for good, which would
 *  strand a permanent "Working…" on any session that reloads it (#59). */
export function turnStillStreaming(messages: HistoryMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.role === "assistant" && !last.completed && !last.error;
}

/** Replace one session's local running lock from server-truth history. Keeping
 *  the explicit delete matters when a pane is reopened after its prior turn
 *  finished while the app was disconnected. */
function runningStateAfterHistory(
  current: Record<string, true>,
  sessionId: string,
  streaming: boolean,
): Record<string, true> {
  const runningSessions = { ...current };
  if (streaming) runningSessions[sessionId] = true;
  else delete runningSessions[sessionId];
  return runningSessions;
}

/** Streamed events that prove a session's turn is still in flight. Any of them
 *  re-locks a session whose local running flag is missing — see the handler.
 *
 *  Every member is ASSISTANT progress. `message.agent` is deliberately absent
 *  even though it arrives mid-turn: the SDK emits it only for USER messages, so
 *  it cannot witness the assistant working — the harness re-emits the turn's
 *  user message once the turn ENDS, about 40 ms after `session.idle`. Treating
 *  that as activity re-locked the session the instant it finished, leaving a
 *  spinner under a completed answer until `reconcileRunning` polled the server
 *  ~15 s later and rebuilt the whole thread to clear it (observed 62 times in one
 *  user's log). A turn started by ANOTHER client is still caught: by the events
 *  below once the assistant does anything, and by `turnStillStreaming` from
 *  server truth whenever the session is opened. */
const ACTIVITY_EVENTS: ReadonlySet<RuntimeMessageEvent["type"]> = new Set([
  "text.updated",
  "reasoning.updated",
  "progress.updated",
  "step.updated",
  "tool.updated",
  "session.retry",
  "question.asked",
  "permission.asked",
]);

/** Last SSE arrival per session (monotonic sequence, not wall time). Lets a
 *  failed sync POST tell "the connection died but the turn is alive" (events
 *  kept arriving after the POST began) from "the send never took" — WKWebView
 *  kills any fetch at ~60 s, long before a long agent turn finishes. */
let sseSeq = 0;
const sseLast = new Map<string, number>();
/** When each session's async prompt POST returned, so the event handler can log
 *  first-token latency (see the multi-pane slow-first-token investigation). */
const turnPostAt = new Map<string, number>();

/** Coalescing for live bash output: a running tool emits an event per stdout
 *  write (a progress bar redraws dozens of times a second) — fold at most one
 *  partial-output update per interval per call, latest event wins. */
const LIVE_FOLD_MS = 250;
const liveFoldLast = new Map<string, number>();
const liveFoldPending = new Map<
  string,
  { sessionId: string; timer: number; event: Extract<RuntimeMessageEvent, { type: "tool.updated" }> }
>();

/** A silent tool call can legitimately run for minutes. Keep the bottom status
 *  line alive without asking the model to expose its private reasoning. */
const PROGRESS_HEARTBEAT_MS = 15_000;
const progressHeartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearProgressHeartbeat(sessionId: string): void {
  const timer = progressHeartbeatTimers.get(sessionId);
  if (timer === undefined) return;
  clearTimeout(timer);
  progressHeartbeatTimers.delete(sessionId);
}

function clearAllProgressHeartbeats(): void {
  for (const sessionId of progressHeartbeatTimers.keys()) clearProgressHeartbeat(sessionId);
}

function startProgressHeartbeat(sessionId: string, get: StoreGet): void {
  if (progressHeartbeatTimers.has(sessionId)) return;
  const timer = setTimeout(() => {
    progressHeartbeatTimers.delete(sessionId);
    if (!get().runningSessions[sessionId]) return;
    const step = Math.max(1, get().stepCounts[sessionId] ?? 1);
    sharedEventHandler?.({
      type: "progress.updated",
      sessionId,
      partId: `heartbeat:${sessionId}`,
      text: i18n.t("session:live.status.heartbeat", { count: step }),
    });
    startProgressHeartbeat(sessionId, get);
  }, PROGRESS_HEARTBEAT_MS);
  progressHeartbeatTimers.set(sessionId, timer);
}

/** Drop a session's queued partial folds — when its turn ends (idle, error,
 *  interrupt) a late timer must not fold a stale "running" event into a
 *  thread the history reload may have rebuilt. */
function clearLiveFolds(sessionId: string) {
  for (const [callId, p] of liveFoldPending) {
    if (p.sessionId !== sessionId) continue;
    window.clearTimeout(p.timer);
    liveFoldPending.delete(callId);
    liveFoldLast.delete(callId);
  }
}

/** Resolve a (possibly nested) subagent session to its top-level session —
 *  a subagent's question/permission belongs to the conversation the user sees. */
/** Turn exactly one right-pane view on (and every other one off) for a pane.
 *  Turning a view off leaves the rest as they were. An open artifact is closed
 *  whenever a view opens — the pane shows one thing at a time. */
function showOnly(
  s: { panes: Record<string, PaneState>; currentId: string | null },
  sessionId: string | undefined,
  view: "showFiles" | "showRuns" | "showStructures" | "showWorkflowDag" | "showAgents",
  show: boolean,
): { panes: Record<string, PaneState> } {
  const key = sessionId ?? s.currentId ?? DRAFT_KEY;
  const p = s.panes[key];
  const base: PaneState = {
    artifact: show ? null : (p?.artifact ?? null),
    showFiles: false,
    showRuns: false,
    showStructures: false,
    showWorkflowDag: false,
    showAgents: false,
  };
  const next: PaneState = show
    ? { ...base, [view]: true }
    : {
        ...base,
        showFiles: p?.showFiles ?? false,
        showRuns: p?.showRuns ?? false,
        showStructures: p?.showStructures ?? false,
        showWorkflowDag: p?.showWorkflowDag ?? false,
        showAgents: p?.showAgents ?? false,
        [view]: false,
      };
  return { panes: { ...s.panes, [key]: next } };
}

export function rootSessionOf(parents: Record<string, string>, sessionId: string): string {
  let cur = sessionId;
  for (let hop = 0; parents[cur] && hop < 10; hop++) cur = parents[cur];
  return cur;
}

/** Does an interactive ask belong to the subtree an interrupt just stopped?
 *  Aborting a session takes its subagent sessions down with it — the harness's
 *  cancel walks the subtree — so their asks die with the parent's. */
function stoppedAsk(parents: Record<string, string>, stopped: string, askSession: string): boolean {
  return askSession === stopped || rootSessionOf(parents, askSession) === stopped;
}

type StoreSet = {
  (partial: Partial<RuntimeState>): void;
  (fn: (s: RuntimeState) => Partial<RuntimeState>): void;
};
type StoreGet = () => RuntimeState;

/**
 * The one send lifecycle (new → input → send → response), shared by plain
 * prompts, "!" shell commands and "/" slash commands:
 *   1. `echo` lands in the thread IMMEDIATELY — on a draft under DRAFT_KEY,
 *      grafted onto the real session id later, so the page never resets.
 *   2. `sending` is true from click until the POST is accepted (locks the
 *      composer); the session sits in `runningSessions` while the turn runs.
 *   3. Failures land as a red status line inside the conversation.
 * `syncTurn` marks endpoints whose POST resolves only when the turn is OVER
 * (shell/command, unlike prompt_async) — their running lock is set BEFORE the
 * POST and cleared when it settles, because session.idle arrives before the
 * POST resolves and a lock set afterwards would never clear.
 * `shell` additionally marks the turn in `shellTurns` for its duration, so
 * the event fold shows the bash output inline.
 */
async function performTurn(
  set: StoreSet,
  get: StoreGet,
  echo: string,
  post: (sid: string) => Promise<void>,
  syncTurn: boolean,
  shell = false,
  // Explicit target session. When omitted, the turn targets the focused session
  // (`currentId`) and may lazily CREATE it from the draft; when a real id is
  // given (a split pane sending to its own session), creation is skipped.
  target?: string,
  // The per-pane draft slot (`draft:<leafId>`) this send owns. When set, the
  // echo/lock/thread live under it and — if no target — the lazily-created
  // session is grafted FROM it, so each unbound tiled pane is fully independent
  // (its own draft, its own new session on first send) rather than sharing the
  // one global DRAFT_KEY. Legacy single-pane sends omit it → fall back to
  // currentId/DRAFT_KEY exactly as before.
  draftKey?: string,
): Promise<string | null> {
  if (!client) {
    set({ error: "Not connected to the DeepSeek Harness runtime." });
    return null;
  }
  // Where the draft's state is grafted from on lazy-create (this pane's own slot,
  // or the legacy global slot for a single-pane send).
  const draftSrc = draftKey ?? DRAFT_KEY;
  const echoKey = target ?? draftKey ?? get().currentId ?? DRAFT_KEY;
  if (get().sendingSessions[echoKey]) return null; // one send at a time per session
  // The lock is held under `echoKey`, but a draft's first send grafts DRAFT_KEY
  // onto the real id mid-turn — track the current key so the lock moves with it
  // (and the finally clears the right one).
  let lockKey = echoKey;
  let auditSessionId: string | null = null;
  set((s) => {
    const cur = s.threads[echoKey] ?? emptyThread();
    return {
      sending: true,
      sendingSessions: { ...s.sendingSessions, [echoKey]: true },
      threads: {
        ...s.threads,
        [echoKey]: { ...cur, loaded: true, blocks: [...cur.blocks, { kind: "user", text: echo }] },
      },
    };
  });
  try {
    // A draft-pane send (draftKey set) always creates its OWN session — never
    // borrow currentId, which may point at a different focused pane and would
    // race the focus effect. Only a legacy (no-draftKey) send reuses currentId.
    let id = target ?? (draftKey ? null : get().currentId);
    if (!id) {
      // Lazy-create the session on the first message (#3), in THIS draft's own
      // folder. A draft the user aimed at a project carries that folder; one
      // that does not gets its own fresh dated folder
      // (~/Documents/OpenScience/sessions/<date-time>) so its files never pile
      // up in the bare base folder.
      const chosen = isTauri ? get().draftWorkspaces[draftSrc] : undefined;
      if (isTauri) {
        set({ switching: true });
        try {
          if (!chosen) {
            await newDatedWorkspace(datedWorkspaceName());
            await kernelReset().catch(() => {});
          } else if (chosen !== get().workspace) {
            // The active folder wandered off — opening any session follows it
            // into that session's folder. Go back to the one this draft was
            // aimed at, or the session lands wherever the user last looked (#69).
            await setWorkspace(chosen);
            await kernelReset().catch(() => {});
          }
          // Always rebuild the scoped client: /new and /clear keep the folder,
          // but the old session route may have just torn down directory-scoped
          // SSE, and a first send must not hang on a stale workspace instance.
          await get().connectRetry();
        } finally {
          set({ switching: false });
        }
        if (get().status !== "ready" || !client) {
          throw new Error("Runtime did not reconnect before creating the session.");
        }
      }
      id = await withRetry(() => client!.createSession());
      set((s) => {
        // Graft this pane's draft conversation (and its pane state) from its own
        // slot (`draftSrc`) onto the real session id.
        const threads = { ...s.threads, [id!]: s.threads[draftSrc] ?? emptyThread() };
        delete threads[draftSrc];
        const panes = { ...s.panes };
        if (panes[draftSrc]) {
          panes[id!] = panes[draftSrc];
          delete panes[draftSrc];
        }
        const sessionAgents = { ...s.sessionAgents };
        if (sessionAgents[draftSrc]) {
          sessionAgents[id!] = sessionAgents[draftSrc];
          delete sessionAgents[draftSrc];
        }
        // The destination has done its job: the session now carries its own
        // folder. Leaving the entry would silently aim this pane's NEXT draft
        // at the same project long after the user moved on.
        const { draftWorkspaces = s.draftWorkspaces } = forgetDraftFolder(s, draftSrc);
        // Move the in-flight send lock too, so a pane keyed on the new id (the
        // draft pane follows currentId onto the real session) still reads itself
        // as sending across the graft — no flicker to an unlocked composer.
        const sendingSessions = { ...s.sendingSessions };
        if (sendingSessions[draftSrc]) {
          sendingSessions[id!] = sendingSessions[draftSrc];
          delete sendingSessions[draftSrc];
        }
        // Carry the draft's per-pane model/effort override onto the real session.
        const sessionModels = { ...s.sessionModels };
        if (sessionModels[draftSrc]) {
          sessionModels[id!] = sessionModels[draftSrc];
          delete sessionModels[draftSrc];
        }
        const sessionVariants = { ...s.sessionVariants };
        if (sessionVariants[draftSrc] !== undefined) {
          sessionVariants[id!] = sessionVariants[draftSrc];
          delete sessionVariants[draftSrc];
        }
        const deepResearchSessions = { ...s.deepResearchSessions };
        const draftResearchMode = deepResearchSessions[draftSrc];
        if (draftResearchMode) {
          deepResearchSessions[id!] = draftResearchMode;
          delete deepResearchSessions[draftSrc];
        }
        return {
          currentId: id,
          threads,
          panes,
          sessionAgents,
          sendingSessions,
          sessionModels,
          sessionVariants,
          deepResearchSessions,
          draftWorkspaces,
        };
      });
      lockKey = id;
      // The draft's model/effort override moved onto the real id — repersist so
      // a relaunch restores this pane's model, not the global default.
      saveRecord(SESSION_MODELS_KEY, get().sessionModels);
      saveRecord(SESSION_VARIANTS_KEY, get().sessionVariants);
      saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
      moveScrollMemory(`chat:${draftSrc}`, `chat:${id}`);
      void get().refreshSessions();
    }
    const sid = id;
    auditSessionId = sid;
    interruptedSessions.delete(sid); // a fresh turn folds its events normally
    void logDebug(`turn → ${sid}`);
    if (!shell) startOrchestratorAudit(sid, echo, get);
    // A fresh turn restarts step counting (the SDK resets its own counter on idle).
    if (get().stepCounts[sid])
      set((s) => {
        const stepCounts = { ...s.stepCounts };
        delete stepCounts[sid];
        return { stepCounts };
      });
    if (syncTurn) {
      set((s) => ({
        runningSessions: { ...s.runningSessions, [sid]: true },
        ...(shell ? { shellTurns: { ...s.shellTurns, [sid]: true as const } } : {}),
      }));
      startProgressHeartbeat(sid, get);
      const mark = sseSeq;
      try {
        await post(sid);
      } catch (err) {
        // The POST rejected — but shell/command POSTs are held open for the
        // WHOLE turn, and WKWebView kills any fetch at ~60 s. If SSE kept
        // streaming this session since the POST began, the turn is alive
        // server-side: keep the running lock (session.idle or a session error
        // will clear it) and don't report a failure that didn't happen.
        if ((sseLast.get(sid) ?? 0) > mark) {
          void logDebug(`turn POST dropped mid-turn, still running → ${sid}`);
          return sid;
        }
        // A genuinely failed POST produces no events — drop both flags here.
        // (On success the session.idle event clears the shell flag, never the
        // POST settling: SSE frames and the POST response race on separate
        // connections, and the bash-output event may land after the POST
        // resolves.)
        set((s) => {
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          delete runningSessions[sid];
          delete shellTurns[sid];
          clearProgressHeartbeat(sid);
          return { runningSessions, shellTurns };
        });
        throw err;
      }
      set((s) => {
        const runningSessions = { ...s.runningSessions };
        delete runningSessions[sid];
        clearProgressHeartbeat(sid);
        return { runningSessions };
      });
    } else {
      // Timing probe (concurrent multi-pane first-token investigation): how long
      // the server takes to ACCEPT the async prompt, and — via turnPostAt, read
      // in the event handler — how long until the first streamed token. A slow
      // POST points at a cold/locked directory instance; a fast POST but slow
      // first token points at model/provider or server turn processing.
      const t0 = performance.now();
      void logDebug(`send POST → ${sid} (streams=${streamClients.size})`);
      await post(sid);
      void logDebug(`send POST ok ${sid} ${Math.round(performance.now() - t0)}ms`);
      turnPostAt.set(sid, performance.now());
      set((s) => ({ runningSessions: { ...s.runningSessions, [sid]: true } }));
      startProgressHeartbeat(sid, get);
    }
    void logDebug("turn OK");
    return sid;
  } catch (err) {
    if (auditSessionId) clearProgressHeartbeat(auditSessionId);
    const msg = err instanceof Error ? err.message : String(err);
    if (auditSessionId) finishOrchestratorAudit(auditSessionId, get, true, msg);
    void logDebug(`turn FAILED: ${msg}`);
    // The failure belongs next to the message that caused it.
    const key = target ?? draftKey ?? get().currentId ?? DRAFT_KEY;
    set((s) => {
      const cur = s.threads[key] ?? emptyThread();
      return {
        error: msg,
        threads: {
          ...s.threads,
          [key]: {
            ...cur,
            loaded: true,
            blocks: [...cur.blocks, { kind: "status-line", text: `Send failed: ${msg}`, tone: "error" }],
          },
        },
      };
    });
    return target ?? get().currentId;
  } finally {
    // Clear the lock under its CURRENT key (`lockKey` follows the draft→session
    // graft, so this never leaks a stale DRAFT_KEY lock).
    set((s) => {
      const sendingSessions = { ...s.sendingSessions };
      delete sendingSessions[lockKey];
      return { sendingSessions, sending: Object.keys(sendingSessions).length > 0 };
    });
  }
}

/** Take `sid` out of the review queue, reporting whether it was waiting there —
 *  i.e. whether a review is still owed for changes it made earlier. */
function dequeueReview(sid: string): boolean {
  const at = reviewQueue.indexOf(sid);
  if (at < 0) return false;
  reviewQueue.splice(at, 1);
  return true;
}

function inferredReviewStatus(review?: Extract<ThreadBlock, { kind: "reviewer" }>): string {
  if (review?.decision) return review.decision;
  if (review?.findings.some((finding) => finding.level === "error")) return "revise";
  if (review?.findings.some((finding) => finding.level === "warn")) return "revise";
  return "approve";
}

/** Finish an isolated reviewer child and mirror only its public result into the
 *  parent transcript. The parent never receives the reviewer's context. */
function finishIsolatedReview(
  set: StoreSet,
  get: StoreGet,
  childId: string,
  parentId: string,
  reviewable: boolean,
): void {
  const child = get().threads[childId];
  const summary = [...(child?.blocks ?? [])]
    .reverse()
    .find((block) => block.kind === "agent");
  const review = [...(child?.blocks ?? [])]
    .reverse()
    .find((block) => block.kind === "reviewer");
  if (reviewable) {
    const publicBlocks = [summary, review].filter(
      (block): block is NonNullable<typeof block> => block !== undefined,
    );
    if (publicBlocks.length) {
      set((state) => {
        const parent = state.threads[parentId] ?? emptyThread();
        return {
          threads: {
            ...state.threads,
            [parentId]: { ...parent, loaded: true, blocks: [...parent.blocks, ...publicBlocks] },
          },
        };
      });
    }
  }
  clearProgressHeartbeat(parentId);
  set((state) => {
    const runningSessions = { ...state.runningSessions };
    delete runningSessions[parentId];
    return { runningSessions };
  });
  const task = activeAgentTasks.get(childId);
  if (task) {
    auditAgent({
      eventType: reviewable ? "agent.completed" : "agent.failed",
      ...task,
      endedAt: Date.now(),
      status: reviewable ? "success" : "failed",
      ...(summary?.kind === "agent" ? { outputSummary: summary.markdown } : {}),
      deliverables: deliverablesFor(parentId),
    });
    if (reviewable && review?.kind === "reviewer") {
      auditAgent({
        eventType: "review.decision",
        ...task,
        endedAt: Date.now(),
        status: inferredReviewStatus(review),
        deliverables: deliverablesFor(parentId),
        reviewDecision: review,
      });
    }
    activeAgentTasks.delete(childId);
  }
  agentDeliverables.delete(childId);
  agentDiffs.delete(childId);
  agentDeliverables.delete(parentId);
  agentDiffs.delete(parentId);
}

/** Send the reviewer in a persistent child session. It sees the frozen
 *  workspace, not the orchestrator's conversation context. */
async function startAutoReview(set: StoreSet, get: StoreGet, sid: string): Promise<void> {
  const s = get();
  // The user started another turn in the meantime: review after THAT one, or the
  // prompt would land on a busy session.
  if (s.runningSessions[sid] || s.sendingSessions[sid]) {
    if (!reviewQueue.includes(sid)) reviewQueue.push(sid);
    return;
  }
  const runtime = clientForSession(get, sid);
  if (!runtime) return;
  reviewInFlight = { parentId: sid, childId: null };
  // The parent stays visibly busy while its independent reviewer runs.
  set((st) => ({ runningSessions: { ...st.runningSessions, [sid]: true } }));
  startProgressHeartbeat(sid, get);
  try {
    const parentTitle = s.sessions.find((session) => session.id === sid)?.title ?? sid;
    const childId = await runtime.createSession(`Review: ${parentTitle}`, sid);
    if (!reviewInFlight || reviewInFlight.parentId !== sid) return;
    reviewInFlight.childId = childId;
    reviewTurns.set(childId, sid);
    const role = REVIEWER_AGENT;
    const task: ActiveAgentTask = {
      agentId: childId,
      role,
      sessionId: childId,
      parentSessionId: sid,
      parentTaskId: `auto-review:${sid}:${Date.now()}`,
      model: agentModelForRole(s.agents, role, s.defaultModel),
      startedAt: Date.now(),
      taskInput: { objective: AUTO_REVIEW_PROMPT, deliverables: deliverablesFor(sid) },
    };
    activeAgentTasks.set(childId, task);
    set((state) => ({ sessionParents: { ...state.sessionParents, [childId]: sid } }));
    auditAgent({ eventType: "agent.started", ...task, status: "running" });
    void get().refreshSessions();
    // No model or effort is passed on purpose: the reviewer's own model and
    // reasoning effort come from its per-agent config (#71), and an explicit
    // per-turn model would override exactly that setting.
    const preparedPrompt = await prepareModelPrompt(AUTO_REVIEW_PROMPT, {
      query: AUTO_REVIEW_PROMPT,
    });
    await runtime.sendPrompt(childId, preparedPrompt, REVIEWER_AGENT);
    void logDebug(`auto-review → ${sid} child=${childId}`);
  } catch (err) {
    // Best effort: a failed review must not break the session the user is in,
    // and must not leave the slot or the "Working…" row stuck.
    void logDebug(`auto-review failed: ${err instanceof Error ? err.message : String(err)}`);
    const childId = reviewInFlight?.parentId === sid ? reviewInFlight.childId : null;
    if (childId) {
      reviewTurns.delete(childId);
      const task = activeAgentTasks.get(childId);
      if (task) {
        auditAgent({
          eventType: "agent.failed",
          ...task,
          endedAt: Date.now(),
          status: "failed",
          outputSummary: err instanceof Error ? err.message : String(err),
          deliverables: deliverablesFor(sid),
        });
        activeAgentTasks.delete(childId);
      }
      agentDeliverables.delete(childId);
      agentDiffs.delete(childId);
    }
    agentDeliverables.delete(sid);
    agentDiffs.delete(sid);
    if (reviewInFlight?.parentId === sid) reviewInFlight = null;
    clearProgressHeartbeat(sid);
    set((st) => {
      const runningSessions = { ...st.runningSessions };
      delete runningSessions[sid];
      return { runningSessions };
    });
    drainReviewQueue(set, get);
  }
}

/** Start the next waiting review, if the single slot is free. */
function drainReviewQueue(set: StoreSet, get: StoreGet): void {
  if (reviewInFlight) return;
  const next = reviewQueue.shift();
  if (next) void startAutoReview(set, get, next);
}

/**
 * Auto-review bookkeeping for one `session.idle`. `reviewable` is false when the
 * turn ended in a user interrupt: there is nothing to review, but the slot still
 * has to be released if the interrupted turn WAS the review.
 */
function onTurnIdle(set: StoreSet, get: StoreGet, sid: string, reviewable: boolean): void {
  const reviewParent = reviewTurns.get(sid);
  const wasReview = reviewParent !== undefined;
  if (reviewParent) {
    reviewTurns.delete(sid);
    finishIsolatedReview(set, get, sid, reviewParent, reviewable);
  }
  if (wasReview && reviewInFlight?.childId === sid) reviewInFlight = null;
  // This turn's own changes are settled either way, so clear them. A review the
  // session was already OWED is different: the files that earned it are on disk
  // whether or not this turn touched anything, so its queue entry is consumed
  // only on an idle that can actually act on it — otherwise an interrupted or
  // errored turn silently cancels a review earned by an earlier one.
  const dirty = dirtyTurns.delete(sid);
  // Both are consumed, never one or the other: `dirty || dequeueReview(sid)`
  // short-circuits, so a session that was dirty AND already owed a review kept
  // its queue entry — and the moment that review ended early (interrupted, or
  // dead server-side) the drain turned the leftover into a second paid review of
  // the same state.
  const owed = reviewable && dequeueReview(sid);
  const changedFiles = reviewable && (dirty || owed);
  const s = get();
  if (
    reviewable &&
    shouldAutoReview({
      enabled: s.autoReview,
      changedFiles,
      wasReview,
      isSubagent: !!s.sessionParents[sid],
      hasReviewer: s.agents.some((a) => a.name === REVIEWER_AGENT),
    })
  ) {
    // The queue is the SET of sessions owed a review, so an id already waiting
    // must not be added twice: each duplicate survives the drain that started
    // its review and becomes a second, redundant paid review of the same state.
    if (reviewInFlight) {
      if (!reviewQueue.includes(sid)) reviewQueue.push(sid);
    } else void startAutoReview(set, get, sid);
    return;
  }
  if (wasReview) drainReviewQueue(set, get);
}

/** Shared core of the two destructive "go back to a past message" actions.
 * DSH returns a forked replacement session, while compatibility runtimes keep
 * the original id and mutate it in place. Rebind every pane and mirror the
 * history prefix in the replacement thread. */
async function revertToMessage(
  set: StoreSet,
  get: StoreGet,
  messageID: string,
  sessionId?: string,
): Promise<{ ok: boolean; sessionId?: string }> {
  const sid = sessionId ?? get().currentId;
  if (!sid || !client) return { ok: false };
  const c = client;
  if (!c.revert) {
    set({ error: "当前 DSH 运行时不支持回滚历史消息。" });
    return { ok: false };
  }
  // Check the visible transcript before mutating the remote session. A stale
  // pane can outlive a refresh; calling fork first would create an orphan
  // replacement that the user never gets attached to.
  const initial = get().threads[sid];
  const initialIndex = initial?.blocks.findIndex((b) => b.kind === "user" && b.messageID === messageID) ?? -1;
  if (initialIndex < 0) return { ok: false };
  if (get().runningSessions[sid]) await get().interrupt(sid);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const replacement = await c.revert(sid, messageID);
      const replacementId = typeof replacement === "string" && replacement ? replacement : sid;
      const current = get().threads[sid];
      const idx = current?.blocks.findIndex((b) => b.kind === "user" && b.messageID === messageID) ?? -1;
      if (idx < 0) return { ok: false };
      if (replacementId !== sid) {
        useLayoutStore.getState().replaceSession(sid, replacementId);
        set((s) => {
          const threads = {
            ...s.threads,
            [replacementId]: {
              ...(current ?? emptyThread()),
              blocks: current!.blocks.slice(0, idx),
              loaded: true,
            },
          };
          const sessionAgents = { ...s.sessionAgents };
          if (sessionAgents[sid]) sessionAgents[replacementId] = sessionAgents[sid];
          const sessionModels = { ...s.sessionModels };
          if (sessionModels[sid]) sessionModels[replacementId] = sessionModels[sid];
          const sessionVariants = { ...s.sessionVariants };
          if (sessionVariants[sid] !== undefined) sessionVariants[replacementId] = sessionVariants[sid];
          const panes = { ...s.panes };
          if (panes[sid]) panes[replacementId] = panes[sid];
          const deepResearchSessions = { ...s.deepResearchSessions };
          if (deepResearchSessions[sid]) deepResearchSessions[replacementId] = deepResearchSessions[sid];
          return {
            currentId: s.currentId === sid ? replacementId : s.currentId,
            sessionRedirects: { ...s.sessionRedirects, [sid]: replacementId },
            threads,
            sessionAgents,
            sessionModels,
            sessionVariants,
            panes,
            deepResearchSessions,
          };
        });
        saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
        void get().refreshSessions();
      } else {
        set((s) => {
          const cur = s.threads[sid];
          if (!cur) return {};
          return { threads: { ...s.threads, [sid]: { ...cur, blocks: cur.blocks.slice(0, idx) } } };
        });
      }
      return { ok: true, sessionId: replacementId };
    } catch (e) {
      if (attempt === 4) {
        set({ error: e instanceof Error ? e.message : "Failed to revert the message." });
        return { ok: false };
      }
      await sleep(200);
    }
  }
  return { ok: false };
}

/** The live DSH client (Settings talks to DSH's settings API directly). */
export function getClient(): DeepSeekHarnessClient | null {
  return dshClient;
}

/** The reasoning variant to send with a turn: the user's pick, but only when the
 *  current default model actually exposes it. Variant vocabularies differ per
 *  model (OpenAI has "minimal", Anthropic has "max", many models have none), so
 *  switching to a model without the chosen level cleanly sends nothing and lets
 *  DSH applies that model's default effort. */
function variantExposed(
  providers: RuntimeState["providers"],
  model: string | null,
  variant: string | null | undefined,
): string | undefined {
  if (!variant || !model) return undefined;
  const i = model.indexOf("/");
  if (i <= 0) return undefined;
  const m = providers
    .find((p) => p.id === model.slice(0, i))
    ?.models.find((mm) => mm.id === model.slice(i + 1));
  return m?.variants?.includes(variant) ? variant : undefined;
}
/** The model + reasoning effort for a session's turn: its own per-pane override
 *  if set, else the global default. Lets each split pane run a different model. */
function modelForSession(state: RuntimeState, key: string): { model: string | null; variant: string | undefined } {
  const sessionModel = state.sessionModels[key];
  const model = sessionModel ?? state.defaultModel ?? firstAvailableModel(state.providers);
  const variant = variantExposed(
    state.providers,
    model,
    state.sessionVariants[key] !== undefined ? state.sessionVariants[key] : state.reasoningVariant,
  );
  return { model, variant };
}

function firstAvailableModel(providers: ProviderInfo[]): string | null {
  return filterSelectableProviders(providers)
    .flatMap((provider) => provider.models.map((model) => `${provider.id}/${model.id}`))
    .find(Boolean) ?? null;
}

function bufferDeepResearchText(event: Extract<RuntimeMessageEvent, { type: "text.updated" }>): void {
  const parts = deepResearchTextBuffers.get(event.sessionId) ?? new Map();
  parts.set(event.partId, event);
  deepResearchTextBuffers.set(event.sessionId, parts);
}

function releaseDeepResearchTurn(
  sessionId: string,
  textEvents: Array<Extract<RuntimeMessageEvent, { type: "text.updated" }>>,
): void {
  deepResearchTextBuffers.delete(sessionId);
  deepResearchReleaseSessions.add(sessionId);
  try {
    for (const event of textEvents) sharedEventHandler?.(event);
  } finally {
    deepResearchReleaseSessions.delete(sessionId);
  }
  deepResearchIdlePassThrough.add(sessionId);
  sharedEventHandler?.({ type: "session.idle", sessionId });
}

async function finishDeepResearchTurn(
  run: DeepResearchRun,
  blockers: string[],
): Promise<void> {
  let current = run;
  try {
    const graph = await writeDeepResearchEvidence(current);
    current = recordDeepResearchGraphWrite(current, graph.hash);
  } catch (error) {
    blockers = [...blockers, `CEBRO evidence write failed: ${error instanceof Error ? error.message : String(error)}`];
  }
  const buffered = [...(deepResearchTextBuffers.get(current.sessionId)?.values() ?? [])];
  if (!blockers.length) {
    try {
      current = qualifyDeepResearchRun(current);
      releaseDeepResearchTurn(current.sessionId, buffered);
      return;
    } catch (error) {
      blockers = [`Deep Research state gate failed: ${error instanceof Error ? error.message : String(error)}`];
    }
  }
  current = incompleteDeepResearchRun(current, blockers);
  releaseDeepResearchTurn(current.sessionId, [{
    type: "text.updated",
    sessionId: current.sessionId,
    partId: `deep-research-incomplete:${current.runId}`,
    text: current.finalReport ?? buildDeepResearchIncompleteReport(current, blockers),
  }]);
}

async function finalizeDeepResearchIdle(sessionId: string, get: StoreGet): Promise<void> {
  const run = getDeepResearchRun(sessionId);
  if (!run || (run.status !== "running" && run.status !== "retrying")) {
    deepResearchIdlePassThrough.add(sessionId);
    sharedEventHandler?.({ type: "session.idle", sessionId });
    return;
  }
  const buffered = [...(deepResearchTextBuffers.get(sessionId)?.values() ?? [])];
  const blockers = deepResearchBlockers(run, buffered.some((event) => event.text.trim().length > 0));
  if (blockers.length && run.attempt < run.maxAttempts) {
    const retry = retryDeepResearchRun(run, blockers);
    deepResearchTextBuffers.delete(sessionId);
    const runtime = clientForSession(get, sessionId);
    if (!runtime) {
      await finishDeepResearchTurn(retry, [...blockers, "The session runtime was unavailable for the corrective attempt."]);
      return;
    }
    const state = get();
    const mode = state.sessionAgents[sessionId];
    const agent = mode === "plan" && state.agents.some((item) => item.name === "plan") ? "plan" : undefined;
    const { model, variant } = modelForSession(state, sessionId);
    startProgressHeartbeat(sessionId, get);
    turnPostAt.set(sessionId, performance.now());
    try {
      await runtime.sendPrompt(
        sessionId,
        buildDeepResearchCorrectionPrompt(retry),
        agent,
        model,
        variant,
        i18n.language,
      );
      return;
    } catch (error) {
      const current = getDeepResearchRun(sessionId) ?? retry;
      await finishDeepResearchTurn(current, [
        ...blockers,
        `Corrective attempt failed: ${error instanceof Error ? error.message : String(error)}`,
      ]);
      return;
    }
  }
  await finishDeepResearchTurn(run, blockers);
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "offline",
  capabilities: null,
  serverUrl: initialUrl(),
  sessions: [],
  currentId: null,
  sessionRedirects: {},
  threads: {},
  skills: [],
  agents: [],
  commands: [],
  defaultModel: null,
  providers: [],
  reasoningVariant: initialReasoningVariant(),
  setReasoningVariant: (variant) => {
    if (typeof window !== "undefined") {
      if (variant) window.localStorage.setItem(REASONING_KEY, variant);
      else window.localStorage.removeItem(REASONING_KEY);
    }
    set({ reasoningVariant: variant });
  },
  autoReview: initialAutoReview(),
  setAutoReview: (enabled) => {
    if (typeof window !== "undefined") {
      if (enabled) window.localStorage.setItem(AUTO_REVIEW_KEY, "1");
      else window.localStorage.removeItem(AUTO_REVIEW_KEY);
    }
    set({ autoReview: enabled });
  },
  modelSwitchError: null,
  approvalMode: "approve",
  tools: [],
  hiddenExamples: initialHidden(),
  error: null,
  questions: [],
  permissions: [],
  sessionParents: {},
  subagents: {},
  panes: {},
  sessionAgents: {},
  sessionModels: selectableSessionModels(),
  sessionVariants: loadRecord<string | null>(SESSION_VARIANTS_KEY),
  deepResearchSessions: loadRecord<boolean | ResearchAssistantMode>(DEEP_RESEARCH_SESSIONS_KEY),
  setSessionModel: (sessionId, model) =>
    set((s) => {
      const sessionModels = { ...s.sessionModels };
      sessionModels[sessionId] = model;
      saveRecord(SESSION_MODELS_KEY, sessionModels);
      return { sessionModels };
    }),
  setSessionVariant: (sessionId, variant) =>
    set((s) => {
      const sessionVariants = { ...s.sessionVariants, [sessionId]: variant };
      saveRecord(SESSION_VARIANTS_KEY, sessionVariants);
      return { sessionVariants };
    }),
  setDeepResearch: (enabled, sessionId) =>
    set((s) => {
      const key = sessionId ?? s.currentId ?? DRAFT_KEY;
      const deepResearchSessions = { ...s.deepResearchSessions };
      if (enabled) deepResearchSessions[key] = true;
      else delete deepResearchSessions[key];
      saveRecord(DEEP_RESEARCH_SESSIONS_KEY, deepResearchSessions);
      return { deepResearchSessions };
    }),
  setResearchAssistantMode: (mode, sessionId) =>
    set((s) => {
      const key = sessionId ?? s.currentId ?? DRAFT_KEY;
      const deepResearchSessions = { ...s.deepResearchSessions };
      if (mode) deepResearchSessions[key] = mode;
      else delete deepResearchSessions[key];
      saveRecord(DEEP_RESEARCH_SESSIONS_KEY, deepResearchSessions);
      return { deepResearchSessions };
    }),
  setAgentMode: (mode, sessionId) =>
    set((s) => ({ sessionAgents: { ...s.sessionAgents, [sessionId ?? s.currentId ?? DRAFT_KEY]: mode } })),
  projects: [],
  workspace: null,
  webReadOnly: false,
  draftWorkspaces: {},
  switching: false,
  sending: false,
  sendingSessions: {},
  runningSessions: {},
  stepCounts: {},
  shellTurns: {},
  retryNotices: {},
  contextUsage: {},
  compactingSessions: {},

  // These write the CURRENT session's pane (DRAFT_KEY on a draft), keeping the
  // artifact inspector, the Files browser, and the Runs pane mutually exclusive
  // — one pane at a time.
  openArtifact: (artifact, sessionId) =>
    set((s) => ({
      panes: {
        ...s.panes,
        [sessionId ?? s.currentId ?? DRAFT_KEY]: {
          artifact,
          showFiles: false,
          showRuns: false,
          showStructures: false,
          showWorkflowDag: false,
          showAgents: false,
        },
      },
    })),
  closeArtifact: (sessionId) =>
    set((s) => {
      const key = sessionId ?? s.currentId ?? DRAFT_KEY;
      const p = s.panes[key];
      return {
        panes: {
          ...s.panes,
          [key]: {
            artifact: null,
            showFiles: p?.showFiles ?? false,
            showRuns: p?.showRuns ?? false,
            showStructures: p?.showStructures ?? false,
            showWorkflowDag: p?.showWorkflowDag ?? false,
            showAgents: p?.showAgents ?? false,
          },
        },
      };
    }),
  // The right pane holds ONE thing: opening any view closes the others.
  setShowFiles: (show, sessionId) => set((s) => showOnly(s, sessionId, "showFiles", show)),
  setShowRuns: (show, sessionId) => set((s) => showOnly(s, sessionId, "showRuns", show)),
  setShowStructures: (show, sessionId) => set((s) => showOnly(s, sessionId, "showStructures", show)),
  setShowWorkflowDag: (show, sessionId) => set((s) => showOnly(s, sessionId, "showWorkflowDag", show)),
  setShowAgents: (show, sessionId) => set((s) => showOnly(s, sessionId, "showAgents", show)),

  steerSession: async (text, sessionId) => {
    const sid = sessionId ?? get().currentId;
    const content = text.trim();
    if (!sid || !content || !get().runningSessions[sid]) return false;
    const runtime = clientForSession(get, sid);
    if (!runtime?.steerSession) {
      set({ error: "This runtime does not support live steering." });
      return false;
    }
    try {
      await runtime.steerSession(sid, content, i18n.language);
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  answerQuestion: async (requestId, answers) => {
    const q = get().questions.find((x) => x.requestId === requestId);
    if (!q) return;
    // Route to the client whose folder owns the asking session (a split pane in
    // another project has its own directory-scoped instance).
    const c = clientForSession(get, q.sessionId);
    if (!c) return;
    set((s) => ({ questions: s.questions.filter((x) => x.requestId !== requestId) }));
    try {
      await c.answerQuestion(requestId, answers);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  rejectQuestion: async (requestId) => {
    const q = get().questions.find((x) => x.requestId === requestId);
    if (!q) return;
    const c = clientForSession(get, q.sessionId);
    if (!c) return;
    set((s) => ({ questions: s.questions.filter((x) => x.requestId !== requestId) }));
    try {
      await c.rejectQuestion(requestId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  replyPermission: async (requestId, reply) => {
    const p = get().permissions.find((x) => x.requestId === requestId);
    if (!p) return;
    const c = clientForSession(get, p.sessionId);
    if (!c) return;
    // Identical pending asks (same session, action and resources — e.g. three
    // parallel reads into one folder) are ONE question to the user: answer
    // them all with one click instead of re-asking for each tool call.
    const sig = (x: PermissionAskedEvent) =>
      `${x.sessionId}|${x.action}|${x.resources.join("|")}`;
    const batch = get().permissions.filter((x) => sig(x) === sig(p));
    set((s) => ({ permissions: s.permissions.filter((x) => sig(x) !== sig(p)) }));
    try {
      await Promise.all(batch.map((x) => c.replyPermission(x.requestId, reply)));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setServerUrl: (serverUrl) => {
    if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, serverUrl);
    set({ serverUrl, modelSwitchError: null });
  },

  loadCatalog: async () => {
    if (!client) return;
    const runtime = client;
    const dsh = dshClient;
    const loadSeq = ++catalogLoadSeq;
    try {
      const [skillsResult, agentsResult, defaultModel, commands, providerRows] = await Promise.all([
        listCatalogEventually(() => runtime.listSkills()),
        listCatalogEventually(() => runtime.listAgents()),
        runtime.getDefaultModel().catch(() => null),
        runtime.listCommands().catch(() => []),
        // Provider catalog is an optional DSH settings surface outside the
        // runtime-agnostic AgentRuntime contract.
        dsh ? listProvidersEventually(dsh).catch(() => []) : Promise.resolve([]),
      ]);
      if (loadSeq !== catalogLoadSeq) return;
      // Keep a previously populated catalog when a reconnect loses one list
      // temporarily. A fresh install still receives the successful retry
      // result, while an isolated agent failure no longer hides all skills.
      const firstSkills = skillsResult.succeeded || get().skills.length === 0
        ? skillsResult.items
        : get().skills;
      const agents = agentsResult.succeeded || get().agents.length === 0
        ? agentsResult.items
        : get().agents;
      // Keep the runtime catalog identical to the sidecar response so bundled
      // and user-configured providers can both be selected and persisted.
      const providers = filterSelectableProviders(providerRows);
      // DSH's host description can be briefly empty while the profile is
      // warming after a desktop restart. Keep the last deliberate choice as a
      // local fallback, then use the first advertised model when no choice has
      // ever been recorded. The explicit runtime value remains authoritative.
      const rememberedCandidate = get().defaultModel ?? initialDefaultModel();
      const rememberedDefault = rememberedCandidate;
      const firstAvailable = firstAvailableModel(providers);
      const rememberedIsAvailable = rememberedDefault
        ? providers.some((provider) => provider.models.some((model) => `${provider.id}/${model.id}` === rememberedDefault))
        : false;
      // An empty provider response is usually the DSH profile warming up, not
      // proof that the remembered model disappeared. Preserve it until a
      // non-empty catalog can validate or replace it.
      const resolvedDefault = defaultModel ?? (
        rememberedDefault && (providers.length === 0 || rememberedIsAvailable)
          ? rememberedDefault
          : firstAvailable
      );
      // A model switch in flight owns `defaultModel`: this read may predate
      // the switch's config write, and applying it would visibly revert the
      // just-selected model.
      set(
        get().switching
          ? { skills: firstSkills, agents, commands, providers }
          : { skills: firstSkills, agents, defaultModel: resolvedDefault, commands, providers },
      );
      // Self-heal a dangling default model. It can go stale out-of-band — its
      // provider removed, its id renamed, or the config edited outside the app
      // — and then every send fails with "model not found". Settings only
      // re-points it after a provider action, which never runs while the user
      // is just chatting, so heal it here (loadCatalog runs on every connect).
      // Skip while switching (a switch owns the model); an empty providers list
      // (transient read failure) yields no fallback, so it stays untouched. Also
      // skip a model the user just deliberately switched to (within the grace
      // window): right after a switch the reconnecting instance's provider list
      // can be incomplete, and reverting on that transient reads the user's own
      // switch as "dangling" and points it back at an old model (#37).
      const justSwitched =
        defaultModel === lastSwitchModel && Date.now() - lastSwitchAt < SWITCH_HEAL_GRACE_MS;
      if (loadSeq !== catalogLoadSeq) return;
      // Catalog loading runs in the background after every reconnect. Changing
      // the default model tears down and rebuilds the DSH connection, which is
      // safe while idle but would abort a newly-created first turn. Defer the
      // self-heal until the active send/turn has settled; the next reconnect or
      // catalog refresh will retry it.
      const turnInFlight = get().sending
        || Object.keys(get().sendingSessions).length > 0
        || Object.keys(get().runningSessions).length > 0;
      if (!get().switching && !justSwitched && !turnInFlight && defaultModel) {
        const next = fallbackDefaultModel(providers, defaultModel);
        if (next) {
          try {
            await get().setDefaultModel(next);
            toast.success(
              i18n.t("settings:toast.defaultModelReset", { old: defaultModel, model: next }),
            );
          } catch {
            // Leave it stale — the send-time error still guides to Settings.
          }
        }
      }
    } catch {
      /* ignore transient failures */
    }
  },

  detectTools: async () => {
    try {
      set({ tools: await probeTools() });
    } catch {
      /* ignore */
    }
  },

  setApprovalMode: async (mode) => {
    // A deliberate restart, like switchWorkspace: `switching` keeps the UI
    // rendering as connected — no status flip, no page flash.
    set({ switching: true });
    try {
      await persistApprovalMode(mode); // writes the config; restarts the sidecar
      set({ approvalMode: mode });
      await get().connectRetry();
    } finally {
      set({ switching: false });
    }
  },

  setProxySetting: async (mode, url) => {
    // Same masked restart as setApprovalMode: the proxy env applies at spawn.
    set({ switching: true });
    try {
      await persistProxySetting(mode, url); // persists; restarts the sidecar
      await get().connectRetry();
    } finally {
      set({ switching: false });
    }
  },

  setDefaultModel: async (model) => {
    if (!client) throw new Error("Not connected to the DeepSeek Harness runtime.");
    // #37 diagnostics: record what we ask for so a repro (e.g. switching after a
    // plan's quota runs out) shows the exact target model.
    void logDebug(`[provider] setDefaultModel → ${model}`);
    // Mark this as a deliberate switch so the reconnect's self-heal (loadCatalog)
    // won't revert it against a still-warming provider list (#37).
    lastSwitchModel = model;
    lastSwitchAt = Date.now();
    // Applying the model setting is a live DSH update, which may close the
    // event stream server-side. EventSource's own reconnect does not reliably
    // recover from that — it strands the app in "connecting"/disconnected until
    // a manual Connect. So do a deliberate masked reconnect (a fresh stream,
    // exactly what the manual Connect did): `switching` keeps the UI connected,
    // so switching models never flips the status or blocks the composer.
    set({ switching: true });
    try {
      await client.setDefaultModel(model);
      try {
        // Keep a secret-free desktop fallback so a missing or unreadable DSH
        // settings file can be repaired before the next sidecar start.
        await rememberDefaultModel(model);
      } catch (error) {
        void logDebug(
          `default model fallback write skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (typeof window !== "undefined") window.localStorage.setItem(DEFAULT_MODEL_KEY, model);
      set({ defaultModel: model });
      if (!(await get().connectRetry())) {
        throw new Error(
          get().error ?? "Runtime did not reconnect after setting the default model.",
        );
      }
      set({ modelSwitchError: null });
      // #37 diagnostics: confirm the switch actually persisted and which providers
      // the runtime now recognizes — pinpoints "switch doesn't take" / "provider
      // not recognized" vs. a stale config-vs-auth mismatch. Best-effort, never
      // fails the switch.
      try {
        const dsh = dshClient;
        if (dsh) {
          const [applied, provs] = await Promise.all([dsh.getDefaultModel(), dsh.listProviders()]);
          void logDebug(
            `[provider] applied=${applied ?? "null"} providers=[${provs.map((p) => p.id).join(",")}]`,
          );
        }
      } catch (e) {
        void logDebug(`[provider] post-switch probe failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } catch (err) {
      void logDebug(`[provider] setDefaultModel FAILED (${model}): ${err instanceof Error ? err.message : String(err)}`);
      set({ modelSwitchError: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set({ switching: false });
    }
  },

  connect: async () => {
    // Quiet teardown of any previous connection: within a (re)connect the
    // status must never pass through "offline" — on first boot the retry loop
    // runs for minutes (macOS TCC) and each flip repaints the whole page.
    teardownClient();
    let directory: string | null;
    let password: string | null;
    let baseUrl = get().serverUrl;
    if (isGatewayWeb) {
      // Web client: same-origin gateway; the pasted token authenticates the
      // gateway, while the DSH client speaks its API directly behind it.
      // password, and the workspace directory comes from /v1/whoami.
      baseUrl = gatewayOrigin();
      password = gatewayToken();
      directory = null;
      let readOnly = false;
      try {
        const r = await fetch(`${baseUrl}/v1/whoami`, {
          headers: password ? { Authorization: `Bearer ${password}` } : {},
        });
        if (r.ok) {
          const who = (await r.json()) as { directory?: string; mode?: string };
          directory = who.directory ?? null;
          // A read-only token 403s every write — surface that in the UI
          // instead of letting "New session" / the composer fail opaquely.
          readOnly = who.mode === "read-only";
        }
      } catch {
        /* whoami is best-effort; the client still connects */
      }
      set({ serverUrl: baseUrl, workspace: directory, webReadOnly: readOnly });
    } else {
      // Scope skill discovery to the sidecar's workspace (null in browser dev).
      directory = await workspacePath();
      set({ workspace: directory, approvalMode: await getApprovalMode() });
      // The WebView connects through the app-private loopback bridge. Its
      // per-launch bearer token is available only through Tauri IPC; the bridge
      // then strips it before forwarding requests to DSH.
      password = await runtimePassword();
    }
    const c = new DeepSeekHarnessClient({
      baseUrl,
      directory: directory ?? undefined,
      password: password ?? undefined,
    });
    c.registerToolGuard(researchToolGuard);
    dshClient = c;
    client = c;
    // The local adapter advertises the DSH core. In gateway mode the gateway
    // additionally applies its token/surface policy (for example read-only
    // web), so use that authenticated snapshot when it is available.
    const localCapabilities = c.getCapabilities?.() ?? null;
    const remoteCapabilities = isGatewayWeb ? await gatewayCapabilities() : null;
    set({ capabilities: remoteCapabilities ?? localCapabilities });
    // Background streams reuse the same sidecar; the foreground now streams this
    // folder, so drop any background stream that was covering it (avoid a double
    // fold of the same events).
    streamBaseUrl = baseUrl;
    streamPassword = password ?? undefined;
    if (directory) removeStreamClient(directory);
    clientStatusUnsub = c.onStatus((status) => {
      void logDebug(`status → ${status}`);
      if (status === "connecting" && get().status === "ready") {
        // Hold the flip for STATUS_BLIP_GRACE_MS: if the SDK's own reconnect
        // lands first ("ready" clears the timer), the UI never sees the blip.
        if (statusBlipTimer === null)
          statusBlipTimer = setTimeout(() => {
            statusBlipTimer = null;
            set({ status: "connecting" });
          }, STATUS_BLIP_GRACE_MS);
        return;
      }
      clearStatusBlip();
      set({ status });
    });
    if (!sharedEventHandler)
      sharedEventHandler = (event) => {
      // text.updated fires per streamed token, and a running bash tool fires
      // per stdout write (tqdm redraws dozens of times a second) — logging
      // each one would flood debug.log with an IPC call per event.
      if (
        event.type !== "text.updated" &&
        event.type !== "reasoning.updated" &&
        event.type !== "progress.updated" &&
        !(event.type === "tool.updated" && event.status === "running")
      )
        void logDebug(
          `event ← ${event.type}${"sessionId" in event ? " " + event.sessionId : ""}` +
            // An error's TEXT is the whole diagnostic value; logging only "error"
            // meant a real report ("Request blocked." on every retry) could not be
            // explained without reading the runtime's SQLite by hand. Redacted and
            // capped: a provider echoing a credential back must not land on disk.
            (event.type === "error" ? `: ${redactForLog(event.message)}` : ""),
        );
      if ("sessionId" in event && event.sessionId) {
        sseLast.set(event.sessionId, ++sseSeq);
        while (sseLast.size > 500) {
          const oldest = sseLast.keys().next().value;
          if (oldest === undefined) break;
          sseLast.delete(oldest);
        }
        // First streamed token after a send → log latency (multi-pane probe).
        const posted = turnPostAt.get(event.sessionId);
        if (posted !== undefined && (event.type === "text.updated" || event.type === "reasoning.updated" || event.type === "progress.updated")) {
          turnPostAt.delete(event.sessionId);
          void logDebug(`first token ← ${event.sessionId} ${Math.round(performance.now() - posted)}ms`);
        }
        // A streamed sign of life re-locks the session even when THIS app never
        // started its turn — after a reload the locks are gone (in-memory only)
        // while the server keeps working. Without this the Stop affordance never
        // comes back and a live turn can no longer be interrupted (#59). A
        // session the user just interrupted is exempt: the abort's own trailing
        // events must not resurrect its lock.
        // A stale re-lock (an SSE replay of a finished turn) is self-healing —
        // reconcileRunning checks the server and unlocks within one poll.
        const active = event.sessionId;
        if (
          ACTIVITY_EVENTS.has(event.type) &&
          !interruptedSessions.has(active) &&
          !get().runningSessions[active]
        ) {
          set((s) => ({ runningSessions: { ...s.runningSessions, [active]: true } }));
          startProgressHeartbeat(active, get);
        }
      }
      if (event.type === "error") {
        // A session-scoped error belongs IN the conversation (a red status
        // line where the user is looking), and it ends that session's turn so
        // the composer unlocks. Errors without a session keep the banner.
        const sid = event.sessionId;
        // After a user interrupt the abort's own "aborted" error is expected —
        // the thread already says "Interrupted"; don't add a second red line.
        if (sid) {
          clearLiveFolds(sid);
          clearProgressHeartbeat(sid);
        }
        if (sid && interruptedSessions.has(sid)) return;
        const message = explainRuntimeError(event.message);
        if (sid) {
          const deepRun = getDeepResearchRun(sid);
          if (deepRun && (deepRun.status === "running" || deepRun.status === "retrying")) {
            deepResearchTextBuffers.delete(sid);
            void writeDeepResearchEvidence(deepRun)
              .then((graph) => incompleteDeepResearchRun(
                recordDeepResearchGraphWrite(deepRun, graph.hash),
                [`Runtime error before synthesis: ${message}`],
              ))
              .catch((error) => incompleteDeepResearchRun(deepRun, [
                `Runtime error before synthesis: ${message}`,
                `CEBRO evidence write failed: ${error instanceof Error ? error.message : String(error)}`,
              ]));
          }
          finishOrchestratorAudit(sid, get, true, message);
          // This path ends the turn instead of session.idle (and returns before
          // the fold), so it owes the same auto-review bookkeeping: a turn that
          // died is not reviewed — the work is half-finished — but a REVIEW that
          // died must hand its slot back, or no session is ever reviewed again.
          onTurnIdle(set, get, sid, false);
          set((s) => {
            const cur = s.threads[sid] ?? emptyThread();
            const runningSessions = { ...s.runningSessions };
            delete runningSessions[sid];
            const retryNotices = { ...s.retryNotices };
            delete retryNotices[sid];
            return {
              runningSessions,
              retryNotices,
              threads: {
                ...s.threads,
                [sid]: {
                  ...cur,
                  loaded: true,
                  blocks: [
                    ...settleRunningToolBlocks(cur.blocks),
                    { kind: "status-line", text: message, tone: "error" },
                  ],
                },
              },
            };
          });
        } else {
          set({ error: message });
        }
        return;
      }
      // Interactive requests live outside the thread blocks (transient UI).
      switch (event.type) {
        case "context.updated":
          set((s) => ({ contextUsage: { ...s.contextUsage, [event.sessionId]: event.usage } }));
          return;
        case "session.compacted":
          set((s) => {
            if (!s.compactingSessions[event.sessionId]) return {};
            const compactingSessions = { ...s.compactingSessions };
            delete compactingSessions[event.sessionId];
            return { compactingSessions };
          });
          void get().refreshContextUsage(event.sessionId);
          break;
        case "question.asked":
          set((s) => ({
            questions: [...s.questions.filter((q) => q.requestId !== event.requestId), event],
          }));
          return;
        case "question.resolved":
          set((s) => ({ questions: s.questions.filter((q) => q.requestId !== event.requestId) }));
          return;
        case "permission.asked":
          if (!notifiedPermissions.has(event.requestId)) {
            remember(notifiedPermissions, event.requestId);
            void notifyPermissionRequest({ action: event.action, resources: event.resources });
          }
          set((s) => {
            const permissions = [
              ...s.permissions.filter((p) => p.requestId !== event.requestId),
              event,
            ];
            // Mark the tool the agent is blocked on — the newest running/pending
            // step in this session — as waiting-approval, right in the transcript
            // (not just the separate permission card). The permission event has
            // no callID to match on, but the blocked tool is always the latest
            // active one. The next tool.updated restores its real status.
            const sid = event.sessionId;
            const cur = sid ? s.threads[sid] : undefined;
            if (!cur) return { permissions };
            const blocks = [...cur.blocks];
            for (let i = blocks.length - 1; i >= 0; i--) {
              const b = blocks[i];
              if (b.kind === "tool-call" && (b.status === "running" || b.status === "pending")) {
                blocks[i] = { ...b, status: "waiting-approval" };
                return { permissions, threads: { ...s.threads, [sid]: { ...cur, blocks } } };
              }
            }
            return { permissions };
          });
          return;
        case "permission.resolved":
          set((s) => {
            const permissions = s.permissions.filter((p) => p.requestId !== event.requestId);
            const sid = event.sessionId;
            const cur = sid ? s.threads[sid] : undefined;
            if (!cur) return { permissions };
            let changed = false;
            const blocks = cur.blocks.map((b) => {
              if (b.kind === "tool-call" && b.status === "waiting-approval") {
                changed = true;
                return { ...b, status: "running" as const };
              }
              return b;
            });
            return changed
              ? { permissions, threads: { ...s.threads, [sid]: { ...cur, blocks } } }
              : { permissions };
          });
          return;
        case "step.updated":
          startProgressHeartbeat(event.sessionId, get);
          set((s) => ({ stepCounts: { ...s.stepCounts, [event.sessionId]: event.step } }));
          return;
        case "session.retry":
          set((s) => ({
            retryNotices: {
              ...s.retryNotices,
              [event.sessionId]: { attempt: event.attempt, message: event.message },
            },
          }));
          return;
        case "message.agent": {
          // A user message landed. Tag the newest still-untagged user block in
          // this thread with its server id — the optimistic echo from a send
          // starts id-less, and the id is what makes the row editable later.
          // Sends are serialized, so the last untagged block is this message.
          if (event.messageID) {
            const mid = event.messageID;
            set((s) => {
              const cur = s.threads[event.sessionId];
              if (!cur) return {};
              const blocks = [...cur.blocks];
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i];
                if (b.kind === "user" && !b.messageID) {
                  blocks[i] = { ...b, messageID: mid };
                  return { threads: { ...s.threads, [event.sessionId]: { ...cur, blocks } } };
                }
              }
              return {};
            });
          }
          // A user message names its agent. This is how the pill follows
          // The harness's own plan_exit "Yes" (it injects a build user message)
          // — and it self-confirms our own sends. Any OTHER agent (the auto-review
          // turn's `reviewer`, or a custom primary) is left alone: the pill only
          // speaks for the two modes it can actually show, and must not claim
          // "Build" because a turn the user did not send ran on something else.
          if (event.agent === "plan" || event.agent === "build") {
            const mode: AgentMode = event.agent;
            if (get().sessionAgents[event.sessionId] !== mode)
              set((s) => ({
                sessionAgents: { ...s.sessionAgents, [event.sessionId]: mode },
              }));
          }
          return;
        }
      }
      const sid = event.sessionId;
      if (!sid) return;
      if (event.type === "session.idle") clearProgressHeartbeat(sid);
      // Any other sign of life from the session supersedes its retry notice:
      // an attempt is streaming again (text/tool events) or the turn is over.
      if (get().retryNotices[sid]) {
        set((s) => {
          const retryNotices = { ...s.retryNotices };
          delete retryNotices[sid];
          return { retryNotices };
        });
      }
      if (event.type === "session.idle") clearLiveFolds(sid);
      // Idle after a user interrupt: the thread already ends with "Interrupted"
      // — keep the locks clear and skip the fold. An abort can emit MORE than
      // one idle, so the guard must survive every trailing idle (`.has`, not
      // `.delete`); it is cleared when the next turn starts (see `turn → sid`).
      if (event.type === "session.idle" && interruptedSessions.has(sid)) {
        deepResearchTextBuffers.delete(sid);
        removeDeepResearchRun(sid);
        set((s) => {
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          delete runningSessions[sid];
          delete shellTurns[sid];
          return { runningSessions, shellTurns };
        });
        // A turn the user stopped is not reviewed — half-finished work is not
        // what a review is for — but a stopped REVIEW still has to hand back
        // its slot.
        onTurnIdle(set, get, sid, false);
        void get().refreshSessions();
        return;
      }
      if (event.type === "tool.updated") {
        rememberAgentArtifact(event, get);
        trackDelegatedAgent(event, get);
        const researchSessionId = getDeepResearchRun(sid)
          ? sid
          : rootSessionOf(get().sessionParents, sid);
        if (getDeepResearchRun(researchSessionId)) {
          recordDeepResearchToolEvent(researchSessionId, event);
        }
      }
      // Only a file the agent actually wrote earns a review; a read-only turn
      // (questions, searches, plain analysis) has nothing to audit.
      if (event.type === "tool.updated" && isMutatingTool(event.tool, event.status)) {
        // Credited to the session at the top of the subagent chain, not to the one
        // that ran the tool. A subagent's own session is never reviewed (see the
        // `isSubagent` gate) because its parent's turn is what gets reviewed — so
        // attributing the write to the child meant a turn that delegated ALL of
        // its file work was reviewed by nobody.
        dirtyTurns.add(rootSessionOf(get().sessionParents, sid));
      }
      // The agent reached a compute host that authenticates interactively and
      // asked us to sign in (#73). The dialog opens here, in the conversation the
      // user is already watching, and the tool waits for the shared connection —
      // so the run continues instead of dying on "Permission denied".
      if (
        event.type === "tool.updated" &&
        event.tool === "ssh_connect" &&
        (event.status === "running" || event.status === "pending")
      ) {
        const host = typeof event.input?.host === "string" ? event.input.host : "";
        if (host && !relayedSignIns.has(event.callId)) {
          remember(relayedSignIns, event.callId);
          void useSshStore.getState().connect(host);
        }
      }
      // A task tool names the subagent session it spawned — remember the
      // parent link so the child's permission/question asks surface in THIS
      // conversation, and refresh the list so the child's title is known.
      if (
        event.type === "tool.updated" &&
        event.childSessionId &&
        get().sessionParents[event.childSessionId] !== sid
      ) {
        const child = event.childSessionId;
        set((s) => ({ sessionParents: { ...s.sessionParents, [child]: sid } }));
        void get().refreshSessions();
        void get().refreshSubagents(sid);
      }
      const deepResearchRun = getDeepResearchRun(sid);
      if (
        event.type === "text.updated"
        && deepResearchRun
        && (deepResearchRun.status === "running" || deepResearchRun.status === "retrying")
        && !deepResearchReleaseSessions.has(sid)
      ) {
        bufferDeepResearchText(event);
        return;
      }
      if (event.type === "session.idle" && deepResearchIdlePassThrough.delete(sid)) {
        // The async evidence gate reinjects the same idle only after it has
        // released a qualified answer or an explicit incomplete report.
      } else if (
        event.type === "session.idle"
        && deepResearchRun
        && (deepResearchRun.status === "running" || deepResearchRun.status === "retrying")
      ) {
        if (deepResearchFinalizingSessions.has(sid)) return;
        deepResearchFinalizingSessions.add(sid);
        void finalizeDeepResearchIdle(sid, get)
          .catch((error) => {
            const current = getDeepResearchRun(sid);
            if (current) return finishDeepResearchTurn(current, [
              `Deep Research finalization failed: ${error instanceof Error ? error.message : String(error)}`,
            ]);
          })
          .finally(() => deepResearchFinalizingSessions.delete(sid));
        return;
      }
      const applyFold = (ev: typeof event) =>
        set((s) => {
          const cur = s.threads[sid] ?? emptyThread();
          const folded = foldEvent(
            { blocks: cur.blocks, index: cur.index },
            ev,
            { shellTurn: !!s.shellTurns[sid] },
          );
          const threads = { ...s.threads, [sid]: { ...cur, ...folded, loaded: true } };
          // The turn is over — unlock the composer and drop the "Working…" row.
          // The shell flag clears HERE (not when the POST settles): within the
          // SSE stream the bash-output event always precedes session.idle.
          //
          // ONLY session.idle may touch these three maps. Cloning them on every
          // folded event handed a NEW identity to every whole-map subscriber on
          // every streamed token — repainting every pane and the sidebar for a
          // BACKGROUND session's stream, which is exactly what #34's per-field
          // selectors exist to prevent. With concurrent subagents that fan-out
          // multiplied per live child and starved the main thread (#50).
          if (ev.type !== "session.idle") return { threads };
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          const stepCounts = { ...s.stepCounts };
          delete runningSessions[sid];
          delete shellTurns[sid];
          delete stepCounts[sid];
          return { runningSessions, shellTurns, stepCounts, threads };
        });
      // A running bash tool streams its stdout tail on every write — dozens
      // of events per second under a progress bar. Fold at most one partial
      // update per LIVE_FOLD_MS per call (latest wins); everything else
      // (status changes, completion) folds immediately and supersedes.
      if (event.type === "tool.updated") {
        if (event.status === "running" && event.partialOutput !== undefined) {
          const now = Date.now();
          const last = liveFoldLast.get(event.callId) ?? 0;
          if (now - last < LIVE_FOLD_MS) {
            const pending = liveFoldPending.get(event.callId);
            if (pending) pending.event = event;
            else {
              const callId = event.callId;
              const timer = window.setTimeout(() => {
                const p = liveFoldPending.get(callId);
                liveFoldPending.delete(callId);
                if (!p) return;
                liveFoldLast.set(callId, Date.now());
                applyFold(p.event);
              }, LIVE_FOLD_MS - (now - last));
              liveFoldPending.set(event.callId, { sessionId: sid, timer, event });
            }
            return;
          }
          liveFoldLast.set(event.callId, now);
        } else {
          const pending = liveFoldPending.get(event.callId);
          if (pending) {
            window.clearTimeout(pending.timer);
            liveFoldPending.delete(event.callId);
          }
          liveFoldLast.delete(event.callId);
        }
      }
      applyFold(event);
      // After the fold, which is what clears this session's running lock — the
      // review claims it again for its own turn.
      if (event.type === "session.idle") {
        finishOrchestratorAudit(sid, get);
        onTurnIdle(set, get, sid, true);
      }
      const presentationEventKey =
        event.type === "tool.updated" ? `${sid}:${event.callId}` : null;
      if (
        event.type === "tool.updated" &&
        presentationEventKey &&
        !handledPresentations.has(presentationEventKey)
      ) {
        const presentation = deriveArtifactPresentation(event);
        if (presentation?.display === "panel") {
          remember(handledPresentations, presentationEventKey);
          if (presentation.target === "new-session") {
            void (async () => {
              const sourceDirectory =
                get().sessions.find((session) => session.id === sid)?.directory ?? get().workspace;
              let presentationClient: AgentRuntime | null = client;
              let temporaryClient: DeepSeekHarnessClient | null = null;
              try {
                if (sourceDirectory && sourceDirectory !== get().workspace) {
                  presentationClient = streamClients.get(sourceDirectory) ?? null;
                  if (!presentationClient && streamBaseUrl) {
                    temporaryClient = new DeepSeekHarnessClient({
                      baseUrl: streamBaseUrl,
                      directory: sourceDirectory,
                      password: streamPassword,
                    });
                    temporaryClient.registerToolGuard(researchToolGuard);
                    await temporaryClient.connect();
                    presentationClient = temporaryClient;
                  }
                }
                if (!presentationClient) throw new Error("The source workspace is not connected.");
                const title =
                  presentation.artifact.presentation?.title ?? presentation.artifact.filename;
                const dedicatedSessionId = await presentationClient.createSession(title);
                await get().refreshSessions();
                set((state) => ({
                  sessions: state.sessions.some((session) => session.id === dedicatedSessionId)
                    ? state.sessions
                    : [
                        {
                          id: dedicatedSessionId,
                          title,
                          ...(sourceDirectory ? { directory: sourceDirectory } : {}),
                          created: Date.now(),
                          updated: Date.now(),
                        },
                        ...state.sessions,
                      ],
                  threads: {
                    ...state.threads,
                    [dedicatedSessionId]: {
                      ...(state.threads[dedicatedSessionId] ?? emptyThread()),
                      loaded: true,
                    },
                  },
                }));
                useLayoutStore
                  .getState()
                  .presentArtifact(
                    dedicatedSessionId,
                    presentation.artifact,
                    presentation.placement,
                    "new-screen",
                  );
              } finally {
                temporaryClient?.close();
              }
            })().catch((error) =>
              set({ error: error instanceof Error ? error.message : String(error) }),
            );
          } else {
            useLayoutStore
              .getState()
              .presentArtifact(
                sid,
                presentation.artifact,
                presentation.placement,
                presentation.target,
              );
          }
        }
      }
      // Completed writes/runs are handled by the isolated audit integration;
      // it dedupes in memory and the Rust appenders dedupe again on disk.
      if (event.type === "tool.updated") {
        recordRuntimeToolArtifacts(event, sid, get().defaultModel);
      }
      if (event.type === "session.idle") {
        void get().refreshContextUsage(sid);
        void get().refreshSessions();
        // Name the session in the snapshot: a project folder is shared by many
        // sessions, and its git history must say which one made each change.
        const sessionName = get().sessions.find((s) => s.id === sid)?.title || sid;
        void commitWorkspaceSnapshot(`Snapshot session changes (${sessionName})`)
          .then((committed) => {
            if (committed) void logDebug(`git snapshot ✓ ${sid}`);
          })
          .catch((err) =>
            logDebug(`git snapshot skipped for ${sid}: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
      // The agent finished a skill install: it wrote the skill into THIS
      // session's workspace, which the next dated session folder would leave
      // behind — copy it into the profile's user skills dir, where the harness
      // finds it from every workspace (#61).
      if (event.type === "session.idle" && pendingSkillInstall?.sessionId === sid) {
        const pending = pendingSkillInstall;
        // Disarmed while the copy runs, so a second idle cannot adopt twice.
        pendingSkillInstall = null;
        void adoptWorkspaceSkills(pending.known)
          .then(async (adopted) => {
            if (!adopted.length) {
              // The turn may have stopped to ask a question or wait for an
              // approval — stay armed for the turn that finishes the install
              // (unless another install has started meanwhile).
              pendingSkillInstall ??= pending;
              return;
            }
            // adoptWorkspaceSkills restarted the sidecar so discovery reruns.
            await get().connectRetry();
            await get().loadCatalog();
            toast.success(
              i18n.t("pages:skills.install.installed", { name: adopted.join(", ") }),
            );
          })
          .catch((err) =>
            logDebug(`skill adoption failed: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
      };
    if (!sharedRuntimeEventHandler) {
      sharedRuntimeEventHandler = (event) => {
        if (event.type === "tool.pre") {
          if (event.decision !== "allow" && event.decision !== "pending") {
            const parentSessionId = get().sessionParents[event.sessionId];
            auditAgent({
              eventType:
                event.decision === "require-human-approval"
                  ? "governance.approval-required"
                  : "governance.blocked",
              agentId: event.sessionId,
              role: parentSessionId ? "specialist" : "orchestrator",
              sessionId: event.sessionId,
              ...(parentSessionId ? { parentSessionId } : {}),
              parentTaskId: event.callId,
              status: event.decision,
              taskInput: event.input,
              outputSummary: event.reason,
            });
          }
        }
      };
    }
    c.onEvent(sharedEventHandler);
    c.onRuntimeEvent(sharedRuntimeEventHandler);
    try {
      void logDebug(`connect → ${get().serverUrl}`);
      await c.connect();
      void logDebug("connect OK");
      set({ error: null });
      await get().refreshSessions();
      void get().refreshProjects();
      // Catalog (skills/agents/commands) fills in behind the page — a session
      // switch must not wait on it to show the conversation.
      void get().loadCatalog();
      // Every reconnect is a window where session.idle can have been missed
      // (the event stream is directory-scoped and torn down on purpose) —
      // check any session still holding a running lock against the server.
      void get().reconcileRunning();
      // Older versions wrote a blind 128k context limit for custom-endpoint
      // models with an unknown window; on models whose real window is larger
      // that guess made the harness manufacture a context-overflow and abort (#52).
      // Reset those once per run. Desktop only: a gateway web client may hold a
      // read-only token, and the host app does this anyway.
      if (!isGatewayWeb && !contextLimitsCleaned) {
        contextLimitsCleaned = true;
        // Best-effort: deferred into a promise chain so no failure — even a
        // synchronous throw — can flip an otherwise successful connect.
        void Promise.resolve()
          .then(() => c.clearDefaultCustomModelContextLimits())
          .catch((err) =>
            logDebug(`context-limit cleanup skipped: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void logDebug(`connect FAILED: ${msg}`);
      set({ error: msg, status: "error" });
    }
  },

  // First boot can be slow far beyond the process spawn: on a fresh install
  // macOS TCC ("access Documents") blocks the sidecar until the user answers,
  // so the window must cover minutes, not seconds — giving up early strands
  // the user on an error screen that a single manual Connect would fix.
  // Failed attempts are masked (status AND error): workspace switches
  // reconnect the event stream on purpose, and flashing "could not open the
  // event stream" at the user mid-switch reads as breakage. The last error is
  // surfaced only if the whole retry window is exhausted.
  connectRetry: async (tries = 120) => {
    set({ status: "connecting" });
    let lastError: string | null = null;
    for (let i = 0; i < tries; i++) {
      await get().connect();
      if (get().status === "ready") {
        set({ modelSwitchError: null });
        return true;
      }
      lastError = get().error ?? lastError;
      set({ status: "connecting", error: null });
      // Quick retries first — the server is usually up within a second (a
      // reconnect finds it already listening); back off to 1 s for the long
      // tail (first boot blocked on macOS TCC can take minutes).
      await sleep(i < 8 ? 250 : 1000);
    }
    set({ status: "error", error: lastError });
    return false;
  },

  bootstrap: () => {
    if (bootstrapInFlight) return bootstrapInFlight;
    const run = (async () => {
      void get().detectTools();
      // Web client (served by the gateway): the sidecar already runs on the host
      // — just connect to the gateway (same origin), no Tauri runtime to start.
      if (isGatewayWeb) {
        set({ serverUrl: gatewayOrigin() });
        await get().connectRetry();
        return;
      }
      if (!isTauri) return;
      void logDebug("bootstrap: starting bundled runtime");
      try {
        const remembered = initialDefaultModel();
        if (remembered) {
          try {
            // Bootstrap this fallback from the webview's durable preference as
            // well, covering upgrades from builds that had no Rust fallback.
            await rememberDefaultModel(remembered);
          } catch (error) {
            void logDebug(
              `default model bootstrap skipped: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        const url = await startRuntime();
        void logDebug(`bootstrap: runtime at ${url}`);
        if (url) set({ serverUrl: url });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void logDebug(`bootstrap FAILED: ${msg}`);
        set({ error: msg });
        return;
      }
      await get().connectRetry();
      // A remote client (LAN web / CLI) that creates or deletes a session emits
      // no harness session event, so the gateway pings us to re-list — its
      // sessions then show up in the sidebar exactly like locally-made ones.
      if (!gatewayListenerBound) {
        gatewayListenerBound = true;
        try {
          const { listen } = await import("@tauri-apps/api/event");
          await listen("gateway:sessions-changed", () => void get().refreshSessions());
        } catch {
          /* event API unavailable — nothing to sync */
        }
      }
    })();
    bootstrapInFlight = run;
    const clear = () => {
      if (bootstrapInFlight === run) bootstrapInFlight = null;
    };
    void run.then(clear, clear);
    return run;
  },

  disconnect: () => {
    catalogLoadSeq += 1;
    clearAllProgressHeartbeats();
    failOpenAgentAudits("Runtime disconnected before the agent reached a terminal state.");
    teardownClient();
    teardownStreamClients();
    // Nothing can be reviewed without a runtime; a stale queue would fire into
    // the next connection.
    dirtyTurns.clear();
    reviewTurns.clear();
    reviewQueue.length = 0;
    reviewInFlight = null;
    // Session ids are reused by DSH after reconnects (and by tests/mocks). A
    // stale interrupt guard must never suppress a later turn or review child.
    interruptedSessions.clear();
    deepResearchTextBuffers.clear();
    deepResearchReleaseSessions.clear();
    deepResearchIdlePassThrough.clear();
    deepResearchFinalizingSessions.clear();
    set({ status: "offline", modelSwitchError: null, sessionRedirects: {} });
  },

  refreshSessions: async () => {
    if (!client) return;
    try {
      const sessions = await client.listSessions();
      set((s) => {
        const listedIds = new Set(sessions.map((session) => session.id));
        // Keep a redirect only until the forked session is visible in the
        // authoritative list; afterward normal session truth is sufficient.
        const sessionRedirects = Object.fromEntries(
          Object.entries(s.sessionRedirects).filter(([, replacement]) => !listedIds.has(replacement)),
        );
        // The list also names each subagent session's parent — the recovery
        // path for parent links after a reload (no live task event to learn from).
        const sessionParents = { ...s.sessionParents };
        for (const m of sessions) if (m.parentId) sessionParents[m.id] = m.parentId;
        // Reconcile persisted mode flags against the authoritative runtime list.
        // Keep draft slots alive because they have no server session yet; a
        // successful empty list must still remove flags for deleted sessions.
        const known = new Set([
          DRAFT_KEY,
          ...Object.keys(s.draftWorkspaces),
          ...sessions.map((session) => session.id),
          ...Object.values(sessionRedirects),
          // A create is followed by a best-effort refresh before some DSH
          // deployments expose the new row in listSessions(). Keep an active
          // turn's flag until that session becomes listable or goes idle.
          ...Object.entries(s.runningSessions)
            .filter(([, running]) => running)
            .map(([id]) => id),
          ...Object.keys(s.sendingSessions),
        ]);
        const deepResearchSessions = s.sending || Object.keys(s.runningSessions).length > 0
          ? s.deepResearchSessions
          : Object.fromEntries(
              Object.entries(s.deepResearchSessions).filter(([id]) => known.has(id)),
            );
        return { sessions, sessionParents, sessionRedirects, deepResearchSessions };
      });
      // A successful empty list is meaningful on a fresh install: localStorage
      // can still contain panes from an older runtime profile. Reconcile after
      // the server truth is known, including the zero-session case.
      // A freshly-created DSH session can be absent from the list (or still
      // carry its blank metadata) until the first prompt is committed. Keep
      // panes for sends/turns already owned by this app so the authoritative
      // refresh cannot make the active conversation disappear mid-request.
      const liveSessionIds = new Set([
        ...sessions.map((session) => session.id),
        ...Object.values(get().sessionRedirects),
        ...Object.keys(get().sendingSessions),
        ...Object.entries(get().runningSessions)
          .filter(([, running]) => running)
          .map(([id]) => id),
      ]);
      useLayoutStore.getState().pruneSessions(liveSessionIds);
      saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
    } catch {
      /* ignore transient list failures */
    }
  },

  // "New" opens a blank draft — no session is created until the first message (#3).
  // Keep an explicitly registered project as the destination; a plain session
  // workspace still gets a fresh dated folder on the first send.
  startDraft: () => {
    set((s) => {
      const project = registeredProjectWorkspace(s);
      return {
        ...blankDraft(s),
        ...(project
          ? { draftWorkspaces: { ...s.draftWorkspaces, [DRAFT_KEY]: project } }
          : forgetDraftFolder(s, DRAFT_KEY)),
      };
    });
    saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
  },

  // Re-blank the draft VIEW without touching where the next session will live.
  // The folder is chosen at send time from the draft's own entry, but the user picks
  // it much earlier ("+ new session in project X"). Anything between the two
  // that merely resets the view — the focus effect when a pane loses its
  // session — must not reroute the session to a dated folder (#69); only an
  // explicit New may unpin.
  resetDraftView: () => {
    set((s) => blankDraft(s));
    saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
  },

  // Local /new and /clear: clear the visible chat context, but keep the active
  // folder. The first next message creates a new harness session in that same
  // folder; no session, database row, or file is deleted here. `key` is the
  // draft slot to reset — the pane's own `draft:<leafId>` for a tiled pane,
  // the global DRAFT_KEY for the single-pane fallback.
  startDraftInCurrentWorkspace: (key = DRAFT_KEY) => {
    set((s) => {
      const threads = { ...s.threads };
      threads[key] = {
        ...emptyThread(),
        loaded: true,
        blocks: [
          {
            kind: "status-line",
            text: i18n.t("session:localCommand.cleared"),
            tone: "review",
            divider: true,
          },
        ],
      };
      const panes = { ...s.panes };
      delete panes[key];
      const sessionAgents = { ...s.sessionAgents };
      delete sessionAgents[key];
      const deepResearchSessions = { ...s.deepResearchSessions };
      delete deepResearchSessions[key];
      // /new and /clear deliberately stay put: aim this draft at the folder
      // it is already in, so the next session lands there and not in a dated one.
      const draftWorkspaces = s.workspace
        ? { ...s.draftWorkspaces, [key]: s.workspace }
        : s.draftWorkspaces;
      return { currentId: null, draftWorkspaces, threads, panes, sessionAgents, deepResearchSessions };
    });
    saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
  },

  refreshProjects: async () => {
    if (!isTauri && !isGatewayWeb) return;
    try {
      set({ projects: await listProjects() });
    } catch {
      /* ignore transient scan failures */
    }
  },

  createProject: async (name) => {
    try {
      const project = await createProjectFolder(name);
      // Make the destination available immediately; the background refresh is
      // eventually consistent and a fast click on New must not lose the
      // project binding.
      set((s) => ({
        projects: s.projects.some((item) => item.id === project.id)
          ? s.projects
          : [...s.projects, project],
      }));
      void get().refreshProjects();
      await get().switchWorkspace({ path: project.path });
      return project;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  importProject: async (path, mode) => {
    try {
      const project = await importProjectFolder(path, mode);
      set((s) => ({
        projects: s.projects.some((item) => item.id === project.id)
          ? s.projects
          : [...s.projects, project],
      }));
      void get().refreshProjects();
      await get().switchWorkspace({ path: project.path });
      return project;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  setProjectPinned: async (id, pinned) => {
    // Optimistic: flip locally so the sidebar reacts immediately, then persist.
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, pinned } : p)) }));
    try {
      await setProjectPinnedCmd(id, pinned);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
    void get().refreshProjects();
  },

  deleteProject: async (id) => {
    try {
      await deleteProjectCmd(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
    void get().refreshProjects();
  },

  startDraftInWorkspace: async (path, key = DRAFT_KEY) => {
    // Aim the draft slot the composer will actually send under. "+ new session
    // in project X" opens its own pane, so that is `draft:<leafId>`, not the
    // global slot — aiming the wrong one sent the session to a dated folder.
    const aim = (s: RuntimeState) => ({
      draftWorkspaces: { ...s.draftWorkspaces, [key]: path },
    });
    if (samePath(get().workspace, path)) {
      // Already inside the project — a clean draft, no reconnect.
      set((s) => ({ ...blankDraft(s, key), ...aim(s) }));
      saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
      return;
    }
    await get().switchWorkspace({ path, key });
  },

  ensureDraftWorkspace: async (key = DRAFT_KEY) => {
    const s = get();
    // A session already has its folder; a draft aimed at one reuses it on send.
    // Only a draft with no folder of its own needs its dated folder materialized
    // now, so composer files and the eventual session share one workspace.
    if (!isTauri || s.draftWorkspaces[key]) return;
    // The legacy global composer follows currentId. A per-pane draft key is
    // independent of it: a new split pane can need a folder while another pane
    // still owns currentId, so the global session must not suppress that setup.
    if (key === DRAFT_KEY && s.currentId) return;
    // On relaunch the layout can restore a historical conversation before the
    // runtime has listed its sessions. Do not let the draft composer race that
    // restore and move the active project into a new dated folder. This guard
    // applies only to the legacy global draft; an explicit per-pane draft is a
    // real independent destination alongside restored session panes.
    const tree = useLayoutStore.getState().tree;
    if (key === DRAFT_KEY && tree && leaves(tree).some((leaf) => !!leaf.sessionId)) return;
    await get().switchWorkspace({ dated: datedWorkspaceName(), key });
  },

  refreshSubagents: async (parentSessionId) => {
    const c = clientForSession(get, parentSessionId);
    if (!c?.listSubagents) return;
    try {
      const entries = await c.listSubagents(parentSessionId);
      set((s) => ({ subagents: { ...s.subagents, [parentSessionId]: entries } }));
    } catch {
      // A compatibility runtime or a child that ended during listing may not
      // expose a catalog. The live tool/session links remain usable.
    }
  },

  switchWorkspace: async (target) => {
    set({ switching: true });
    try {
      // Either way the draft ends up aimed at a real folder: the one the user
      // picked, or the dated one just materialized (so a file pasted into the
      // draft and the eventual session share it, rather than the send creating
      // a second dated folder and orphaning the file).
      // Both commands answer with the canonical path the runtime resolved —
      // which is exactly what the session's own `directory` will report, so aim
      // the draft at that, not at the raw string the caller passed.
      const landed =
        "dated" in target ? await newDatedWorkspace(target.dated) : await setWorkspace(target.path);
      // Reset the local kernel so it respawns in the new folder, then reconnect
      // the event stream scoped to it (connect() re-reads the active folder —
      // the sidecar itself keeps running). The switch aims the draft at that
      // folder, so the next new session lands exactly there.
      await kernelReset().catch(() => {});
      set((s) => {
        // Back to a draft in the new folder — the draft pane must not carry
        // files from the previous folder. Session panes keep their memory.
        const panes = { ...s.panes };
        delete panes[DRAFT_KEY];
        const sessionAgents = { ...s.sessionAgents };
        delete sessionAgents[DRAFT_KEY];
        const deepResearchSessions = { ...s.deepResearchSessions };
        delete deepResearchSessions[DRAFT_KEY];
        const draftWorkspaces = { ...s.draftWorkspaces, [target.key ?? DRAFT_KEY]: landed };
        return { currentId: null, panes, draftWorkspaces, sessionAgents, deepResearchSessions };
      });
      saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
      await get().connectRetry();
      await Promise.all([get().refreshSessions(), get().loadCatalog()]);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ switching: false });
    }
  },

  openSession: async (id, options) => {
    const seq = ++openSessionSeq;
    set({ currentId: id });
    if (!client) return;
    // Follow the session into its own workspace folder: record it as active and
    // reconnect the event stream scoped to it, so the agent, kernel and Files
    // all operate where the session's files live. Sessions with no recorded
    // folder, or that already match the active folder, skip this.
    const dir = get().sessions.find((s) => s.id === id)?.directory;
    const followWorkspace = options?.followWorkspace ?? true;
    if (
      followWorkspace &&
      dir &&
      dir !== get().workspace &&
      shouldFollowSessionWorkspace(get().workspace, dir)
    ) {
      set({ switching: true });
      try {
        await setWorkspace(dir).catch(() => {});
        // A newer openSession has superseded this one — stop before starting a
        // second, dueling connectRetry. Two reconnect loops tear down each
        // other's in-flight EventSource, leaking half-open sockets until the
        // webview's per-host connection pool is exhausted and every later
        // session hangs on load. The winner (latest seq) does the reconnect.
        if (seq !== openSessionSeq) return;
        await kernelReset().catch(() => {});
        if (seq !== openSessionSeq) return;
        await get().connectRetry();
      } finally {
        // Only the still-current open clears `switching`; a superseded one must
        // not flip it off while the winner is mid-reconnect.
        if (seq === openSessionSeq) set({ switching: false });
      }
    }
    // Stamp the (now-active) workspace with this session's id so skill-recorded
    // remote runs attach to the session, not just the global Runs view.
    // A startup-restored historical pane may be displayed through a background
    // stream while the foreground remains on the registered project. Do not
    // stamp that historical id onto the project's provenance directory.
    if (dir && (followWorkspace || samePath(dir, get().workspace))) {
      void markSession(id).catch(() => {});
    }
    if (!client) return;
    // Recover any request the agent is blocked on (asked before connect/reload).
    void (async () => {
      try {
        const [qs, ps] = await Promise.all([
          client!.listQuestions(id),
          client!.listPermissions(id),
        ]);
        // Both lists are workspace-scoped (they include subagent sessions'
        // asks) — replace by requestId so live SSE copies don't duplicate.
        set((s) => {
          const qIds = new Set(qs.map((q) => q.requestId));
          const pIds = new Set(ps.map((p) => p.requestId));
          return {
            questions: [...s.questions.filter((q) => !qIds.has(q.requestId)), ...qs],
            permissions: [...s.permissions.filter((p) => !pIds.has(p.requestId)), ...ps],
          };
        });
      } catch {
        /* pending-request recovery is best-effort */
      }
    })();
    // A session reopened while "Working…" may have finished behind our back.
    void get().reconcileRunning();
    if (get().threads[id]?.loaded) return;
    try {
      let messages: HistoryMessage[];
      try {
        messages = await client.getMessages(id);
      } catch (firstError) {
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
        if (!isTransientHistoryError(firstMessage)) throw firstError;
        if (seq !== openSessionSeq || get().currentId !== id) return;

        // A 502 here means the desktop bridge answered while its DSH upstream
        // was unavailable. Re-establish the authoritative runtime connection,
        // then retry the idempotent history read. Do not cache the bridge blip
        // as a permanently loaded error page.
        void logDebug(`session history transient for ${id}; reconnecting`);
        const recovered = await get().connectRetry(20);
        if (seq !== openSessionSeq || get().currentId !== id) return;
        if (!recovered || !client) throw firstError;
        messages = await withRetry(() => client!.getMessages(id));
      }
      if (seq !== openSessionSeq || get().currentId !== id) return;
      const streaming = turnStillStreaming(messages);
      set((s) => ({
        threads: {
          ...s.threads,
          [id]: {
            ...historyToThread(projectDeepResearchHistory(messages, getDeepResearchRun(id)), s.commands),
            loaded: true,
          },
        },
        // Seed the agent pill from history: a session that was planning when
        // the app closed (or whose plan_exit flip fell into an SSE gap) must
        // reopen in the mode the server is actually in.
        sessionAgents: { ...s.sessionAgents, [id]: lastAgentMode(messages) },
        // …and seed the running lock the same way. The locks are in-memory, so
        // a session still mid-answer would otherwise reopen with no "Working…"
        // and no way to stop it — a silent long tool call streams no event to
        // re-lock it either (#59).
        runningSessions: runningStateAfterHistory(s.runningSessions, id, streaming),
      }));
      void get().refreshContextUsage(id);
      if (streaming) startProgressHeartbeat(id, get);
      else clearProgressHeartbeat(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingSessionError(msg)) {
        // The session list may have raced the history request during startup.
        // Re-list once; if the server confirms the id is absent, discard the
        // restored pane and return to a clean draft instead of showing an
        // unrecoverable history error.
        await get().refreshSessions();
        if (seq !== openSessionSeq || get().currentId !== id) return;
        if (!get().sessions.some((session) => session.id === id)) {
          set((s) => ({
            currentId: null,
            error: null,
            threads: { ...s.threads, [id]: { ...emptyThread(), loaded: true } },
          }));
          useLayoutStore.getState().pruneSessions(new Set(get().sessions.map((session) => session.id)));
          return;
        }
      }
      if (seq !== openSessionSeq || get().currentId !== id) return;
      set((s) => ({
        error: msg,
        threads: {
          ...s.threads,
          [id]: {
            ...emptyThread(),
            loaded: true,
            blocks: [{ kind: "status-line", text: `Failed to load messages: ${msg}`, tone: "error" }],
          },
        },
      }));
    }
  },

  loadHistory: async (id) => {
    const c = client;
    if (!c || get().threads[id]?.loaded) return;
    try {
      // getMessages is session-scoped (server routes by the session's folder),
      // so any connected client works — no folder switch, unlike openSession.
      const messages = await c.getMessages(id);
      if (get().threads[id]?.loaded) return; // a live fold beat us to it
      const streaming = turnStillStreaming(messages);
       set((s) => ({
        threads: { ...s.threads, [id]: { ...historyToThread(projectDeepResearchHistory(messages, getDeepResearchRun(id)), s.commands), loaded: true } },
        sessionAgents: { ...s.sessionAgents, [id]: lastAgentMode(messages) },
        // Same server-truth seeding as openSession — a background pane must not
        // adopt a still-running session as idle (#59).
        runningSessions: runningStateAfterHistory(s.runningSessions, id, streaming),
      }));
      void get().refreshContextUsage(id);
      if (streaming) startProgressHeartbeat(id, get);
      else clearProgressHeartbeat(id);
    } catch {
      /* best-effort; the pane keeps its skeleton and loads on focus */
    }
  },

  refreshContextUsage: async (id) => {
    const c = clientForSession(get, id);
    if (!c?.getContextUsage) return;
    try {
      const usage = await c.getContextUsage(id);
      set((s) => ({ contextUsage: { ...s.contextUsage, [id]: usage } }));
    } catch {
      /* best-effort; the projection may not exist on older profiles */
    }
  },

  compactSession: async (sessionId) => {
    const sid = sessionId ?? get().currentId;
    const c = sid ? clientForSession(get, sid) : null;
    if (!sid || !c?.compactSession) return false;
    if (get().runningSessions[sid] || get().sendingSessions[sid] || get().compactingSessions[sid]) return false;
    set((s) => ({ compactingSessions: { ...s.compactingSessions, [sid]: true } }));
    try {
      await c.compactSession(sid);
      const messages = await c.getMessages(sid);
      set((s) => ({
        threads: { ...s.threads, [sid]: { ...historyToThread(projectDeepResearchHistory(messages, getDeepResearchRun(sid)), s.commands), loaded: true } },
        sessionAgents: { ...s.sessionAgents, [sid]: lastAgentMode(messages) },
      }));
      await get().refreshContextUsage(sid);
      return true;
    } catch (error) {
      set((s) => {
        const compactingSessions = { ...s.compactingSessions };
        delete compactingSessions[sid];
        return {
          compactingSessions,
          error: error instanceof Error ? error.message : String(error),
        };
      });
      return false;
    } finally {
      set((s) => {
        if (!s.compactingSessions[sid]) return {};
        const compactingSessions = { ...s.compactingSessions };
        delete compactingSessions[sid];
        return { compactingSessions };
      });
    }
  },

  // The send lifecycle (new → input → send → response) is shared by plain
  // prompts, "!" shell commands and "/" slash commands — see performTurn.
  sendPrompt: (text, sessionId, draftKey) => {
    // Capture the mode BEFORE performTurn: on a draft, currentId is still null
    // here (the session is created inside), so this reads the pane's draft slot
    // correctly. Pin "plan" only when the catalog actually has it — a stale mode
    // against an older/custom sidecar must not fail every send with "Agent not
    // found".
    const s = get();
    const key = sessionId ?? draftKey ?? s.currentId ?? DRAFT_KEY;
    const mode = s.sessionAgents[key];
    const agent =
      mode === "plan" && s.agents.some((a) => a.name === "plan") ? "plan" : undefined;
    // This pane's own model + effort (falling back to the global default),
    // captured now so a draft's later graft still sends the pane's choice.
    const { model, variant } = modelForSession(s, key);
    // Plain-language DFT requests must enter the governed Materials workflow.
    // The slash command selects materials-supervisor and creates the DFT DAG.
    if (shouldRouteToMaterialsWorkflow(text)) {
      return performTurn(
        set,
        get,
        `/materials-run ${text}`,
        (sid) => client!.runCommand(sid, "materials-run", text, i18n.language),
        true,
        false,
        sessionId,
        draftKey,
      );
    }
    return performTurn(
      set,
      get,
      text,
      async (sid) => {
        // Resolve context inside the POST callback: performTurn has already
        // echoed and locked the composer synchronously, preserving the click
        // response contract even when workspace hydration needs an RPC.
        const storedResearchMode = s.deepResearchSessions[key];
        const researchMode: ResearchAssistantMode | null = storedResearchMode === true
          ? "deep-research"
          : storedResearchMode || null;
        const deepResearch = researchMode === "deep-research";
        const researchGraph = deepResearch ? await ensureDeepResearchGraph(sid, text) : undefined;
        const prepared = await prepareModelPromptDetailed(text, {
          query: text,
          ...(researchGraph ? { researchGraph } : {}),
          deepResearch,
          ...(researchMode && researchMode !== "deep-research"
            ? { researchAssistantMode: researchMode }
            : {}),
          availableSkills: s.skills,
        });
        if (deepResearch) {
          if (!prepared.knowledgeBundle || !prepared.researchGraph) {
            throw new Error("Deep Research could not create its Knowledge Universe and CEBRO receipts.");
          }
          deepResearchTextBuffers.delete(sid);
          startDeepResearchRun({
            sessionId: sid,
            query: text,
            researchId: prepared.researchGraph.researchId,
            graphHash: prepared.researchGraph.hash,
            knowledge: prepared.knowledgeBundle,
          });
        }
        try {
          await withRetry(() => client!.sendPrompt(sid, prepared.prompt, agent, model, variant, i18n.language));
        } catch (error) {
          if (deepResearch) removeDeepResearchRun(sid);
          throw error;
        }
      },
      false,
      false,
      sessionId,
      draftKey,
    );
  },

  // No retry for shell/command: re-POSTing would run the command twice.
  runShell: (command, sessionId, draftKey) => {
    const agent = get().agents.find((a) => a.mode === "primary")?.name ?? "build";
    return performTurn(
      set,
      get,
      `! ${command}`,
      (sid) => client!.runShell(sid, command, agent),
      true,
      true,
      sessionId,
      draftKey,
    );
  },

  runCommand: async (name, args, sessionId, draftKey) => {
    if (name === "new" || name === "clear") {
      get().startDraftInCurrentWorkspace(draftKey);
      return null;
    }
    return performTurn(
      set,
      get,
      args ? `/${name} ${args}` : `/${name}`,
      (sid) => client!.runCommand(sid, name, args, i18n.language),
      true,
      false,
      sessionId,
      draftKey,
    );
  },

  interrupt: async (sessionId) => {
    const sid = sessionId ?? get().currentId;
    // Deliberately NOT gated on the local running lock: that lock is this app's
    // guess, and a turn the app has lost track of — after a reload, or after an
    // earlier Stop cleared the lock without the turn actually dying — is exactly
    // the one the user is trying to stop (#59). Aborting an idle session is a
    // no-op server-side: the handler cancels whatever it finds (nothing) and
    // answers true, so there is nothing to protect against here.
    if (!sid || !client) return;
    // Arm the guard BEFORE the abort POST: the server answers an abort with its
    // own SSE burst (an "aborted" error and one or more session.idle events)
    // that streams back WHILE this POST is still awaited. If we armed it after
    // the await, those events would race in ahead and litter the thread with
    // "Aborted" / "done" lines before "Interrupted".
    remember(interruptedSessions, sid);
    // Descendant subagent sessions stream their own events; the abort takes the
    // whole subtree down server-side, so their trailing events need the same
    // guard — otherwise they re-lock the pane the user just stopped.
    const descendants = Object.keys(get().sessionParents).filter(
      (id) => rootSessionOf(get().sessionParents, id) === sid,
    );
    for (const id of descendants) remember(interruptedSessions, id);
    try {
      await client.abortSession(sid);
    } catch (err) {
      // The abort did NOT land. Saying "Interrupted" here would be a lie that
      // also hides the Stop button (the lock is what renders it), leaving a
      // live turn with no way to stop it. Keep the lock, un-arm the guard so
      // the session's events fold normally again, and surface the failure.
      interruptedSessions.delete(sid);
      for (const id of descendants) interruptedSessions.delete(id);
      set({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    for (const id of [sid, ...descendants]) clearProgressHeartbeat(id);
    set((s) => {
      const runningSessions = { ...s.runningSessions };
      const shellTurns = { ...s.shellTurns };
      for (const id of [sid, ...descendants]) {
        delete runningSessions[id];
        delete shellTurns[id];
      }
      const cur = s.threads[sid] ?? emptyThread();
      return {
        runningSessions,
        shellTurns,
        // Drop the asks the stopped turn was blocked on. The server deletes its
        // pending permission/question on interrupt but publishes NO resolved
        // event for it (Permission.ask only clears its own map in `ensuring`),
        // so nothing else would ever retire the card — it would sit there
        // forever, still clickable, answering into a request that no longer
        // exists (#59). Subagent asks go too: the abort took that subtree down.
        questions: s.questions.filter((q) => !stoppedAsk(s.sessionParents, sid, q.sessionId)),
        permissions: s.permissions.filter((p) => !stoppedAsk(s.sessionParents, sid, p.sessionId)),
        threads: {
          ...s.threads,
          [sid]: {
            ...cur,
            loaded: true,
            blocks: [
              ...settleRunningToolBlocks(cur.blocks),
              { kind: "status-line", text: "Interrupted", tone: "error" },
            ],
          },
        },
      };
    });
  },

  editMessage: async (messageID, newText, sessionId) => {
    const result = await revertToMessage(set, get, messageID, sessionId);
    if (result.ok) await get().sendPrompt(newText, result.sessionId ?? sessionId);
  },

  revertMessage: async (messageID, sessionId) => (await revertToMessage(set, get, messageID, sessionId)).ok,

  reconcileRunning: async () => {
    const c = client;
    const running = Object.keys(get().runningSessions);
    if (!c || running.length === 0) return;
    for (const sid of running) {
      try {
        const messages = await c.getMessages(sid);
        // Still ours to answer for? The lock may have cleared while we fetched.
        if (!turnIsOver(messages) || !get().runningSessions[sid]) continue;
        void logDebug(`reconcile: missed idle for ${sid} — unlocking`);
        set((s) => {
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          delete runningSessions[sid];
          delete shellTurns[sid];
          clearProgressHeartbeat(sid);
          return {
            runningSessions,
            shellTurns,
            // The idle was missed, so the tail of the turn was too — replace
            // the thread with the full history rather than leave it stale.
            threads: {
              ...s.threads,
              [sid]: { ...historyToThread(projectDeepResearchHistory(messages, getDeepResearchRun(sid)), s.commands), loaded: true },
            },
            // Same for the agent pill (a plan_exit flip may have been missed).
            sessionAgents: { ...s.sessionAgents, [sid]: lastAgentMode(messages) },
          };
        });
        void get().refreshContextUsage(sid);
      } catch {
        /* best-effort — the next reconnect or poll tries again */
      }
    }
  },

  deleteSession: async (id) => {
    if (!client?.deleteSession) {
      set({ error: "当前 DSH 运行时不支持删除会话；请使用归档。" });
      return false;
    }
    try {
      await client.deleteSession(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    // A queued review for a session that no longer exists would send into a
    // deleted conversation, and one in flight holds the slot forever.
    forgetAutoReview(id);
    drainReviewQueue(set, get);
    clearProgressHeartbeat(id);
    deepResearchTextBuffers.delete(id);
    removeDeepResearchRun(id);
    set((s) => {
      const threads = { ...s.threads };
      delete threads[id];
      const runningSessions = { ...s.runningSessions };
      delete runningSessions[id];
      const panes = { ...s.panes };
      delete panes[id];
      const sessionAgents = { ...s.sessionAgents };
      delete sessionAgents[id];
      const deepResearchSessions = { ...s.deepResearchSessions };
      delete deepResearchSessions[id];
      const contextUsage = { ...s.contextUsage };
      delete contextUsage[id];
      const compactingSessions = { ...s.compactingSessions };
      delete compactingSessions[id];
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        threads,
        runningSessions,
        panes,
        sessionAgents,
        deepResearchSessions,
        contextUsage,
        compactingSessions,
        currentId: s.currentId === id ? null : s.currentId,
      };
    });
    saveRecord(DEEP_RESEARCH_SESSIONS_KEY, get().deepResearchSessions);
    return true;
  },

  renameSession: async (id, title) => {
    const trimmed = title.trim();
    const current = get().sessions.find((s) => s.id === id);
    if (!client || !trimmed || !current || trimmed === current.title) return false;
    try {
      await client.renameSession(id, trimmed);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    // Rename locally rather than re-listing: the sidebar row must change under
    // the pointer, and a full refresh would also reorder the list.
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: trimmed } : x)),
    }));
    return true;
  },

  moveSessionToWorkspace: async (id, directory) => {
    const oc = getClient();
    // Re-homing a session is DSH control-plane surface, not part of the
    // runtime-agnostic port — go through the concrete client.
    if (!oc) return false;
    try {
      await oc.moveSession(id, directory);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, directory } : x)),
    }));
    // The move also re-parents the session's own children; re-list so their
    // grouping follows instead of pointing at the old folder.
    void get().refreshSessions();
    return true;
  },

  setSessionArchived: async (id, archived) => {
    if (!client) return false;
    try {
      await client.setSessionArchived(id, archived);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    // The sidebar's window holds only ACTIVE conversations, so an archived one
    // leaves it at once; a restored one comes back with the next refresh.
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
    if (!archived) void get().refreshSessions();
    return true;
  },

  hideExample: (id) => {
    const next = Array.from(new Set([...get().hiddenExamples, id]));
    if (typeof window !== "undefined") window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    set({ hiddenExamples: next });
  },

  // Install a skill (#1). Installed skills land in the app profile's user
  // skills dir, which the harness scans for every workspace — writing them into
  // the session's own .dsh/skills/ loses them with that dated folder (#61).
  installSkill: async (text) => {
    // A pasted SKILL.md needs no model: the app writes it itself. This also
    // works before any provider is configured.
    if (isTauri && looksLikeSkillFile(text)) {
      try {
        const name = await installSkillMarkdown(text);
        // The sidecar restarted to rediscover it — pick the new list up.
        await get().connectRetry();
        await get().loadCatalog();
        toast.success(i18n.t("pages:skills.install.installed", { name }));
        return { kind: "installed", name };
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    }
    if (!client) {
      set({ error: "Connect the runtime first to install skills." });
      return null;
    }
    try {
      // Installing a skill is not part of whatever project happens to be open:
      // give it its own plain dated folder (what any new session gets) so the
      // session does not end up filed under that project. Nobody pinned this
      // folder, so the user's next new session goes back to the default.
      if (isTauri) {
        await get().switchWorkspace({ dated: datedWorkspaceName() });
        set((s) => forgetDraftFolder(s, DRAFT_KEY));
        if (get().status !== "ready" || !client) {
          throw new Error("Runtime did not reconnect after creating the install folder.");
        }
      }
      // Snapshot: whatever the agent adds on top of this is what gets adopted.
      // Only the desktop can adopt (the profile lives on the host) — over the
      // web the skill stays workspace-scoped, which is all a web client can do.
      if (isTauri) {
        pendingSkillInstall = {
          sessionId: null,
          known: await workspaceSkillNames().catch(() => []),
        };
      }
      const title = i18n.t("pages:skills.install.sectionTitle");
      const id = await client.createSession(title);
      if (pendingSkillInstall) pendingSkillInstall.sessionId = id;
      await get().refreshSessions();
      // Its OWN Screen with its own pane. Binding the install onto whatever pane
      // happened to be focused took over a conversation the user was in the
      // middle of — an install is a new piece of work, not a hijack.
      useLayoutStore.getState().openInNewGroup(id, title);
      // The turn goes through the normal send path (echo, running lock, error
      // line, stream folding) — hand-rolling the POST left the pane with no
      // message, no spinner and no way to tell a failure from a slow model.
      // Both texts are localized: the thread shows one short ask around what the
      // user typed, the model gets the full install instructions.
      const echo = i18n.t("pages:skills.install.echo", { input: text });
      const prompt = i18n.t("pages:skills.install.agentPrompt", { input: text });
      const model = modelForSession(get(), id).model;
      // Deliberately not awaited: the caller opens the new pane immediately and
      // watches the turn there (performTurn reports failures into the thread).
      void performTurn(
        set,
        get,
        echo,
        (sid) => withRetry(() => client!.sendPrompt(sid, prompt, undefined, model, undefined, i18n.language)),
        false,
        false,
        id,
      );
      return { kind: "session", id };
    } catch (err) {
      pendingSkillInstall = null;
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  syncPaneStreams: (directories) => {
    // The foreground `client` already streams the active folder; web is
    // single-pane. Open one background stream per OTHER folder shown, and close
    // streams for folders no longer tiled.
    if (isGatewayWeb || !dshClient) return;
    const foreground = get().workspace;
    const wanted = new Set(directories.filter((d): d is string => !!d && d !== foreground));
    for (const dir of [...streamClients.keys()]) {
      if (!wanted.has(dir)) removeStreamClient(dir);
    }
    for (const dir of wanted) {
      if (streamClients.has(dir)) continue;
      const c = new DeepSeekHarnessClient({
        baseUrl: streamBaseUrl,
        directory: dir,
        password: streamPassword,
      });
      c.registerToolGuard(researchToolGuard);
      if (sharedEventHandler) c.onEvent(sharedEventHandler);
      if (sharedRuntimeEventHandler) c.onRuntimeEvent(sharedRuntimeEventHandler);
      streamClients.set(dir, c);
      // Best-effort: a background stream that can't open just leaves that pane
      // non-live until it's focused (foreground reconnect covers it).
      void c.connect().catch(() => {});
    }
  },
}));

/** Dated folder name like `2026-07-04-1615` for a fresh per-session workspace. */
export function datedWorkspaceName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
