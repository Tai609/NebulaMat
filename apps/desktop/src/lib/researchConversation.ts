import {
  addResearchEvidence,
  addResearchNode,
  evaluateClaimReadiness,
  stableHash,
  canAdvanceResearchAutopilotStage,
  type ResearchAutopilotStage,
  updateResearchAction,
  type ResearchActionType,
  parseResearchAgentProposal,
  researchAgentProposalNeedsApproval,
  type ResearchAgentProposal,
  type ResearchEvidenceRelation,
  type ResearchGraph,
  type ResearchNode,
} from "@ai4s/shared";
import type { ThreadBlock } from "@ai4s/shared";
import { initializeResearchWorkspace, researchWorkspaceKey } from "./researchWorkspace";
import { pathKey, samePath } from "./workspacePath";

const ACTIVE_RESEARCH_KEY = "ai4s.research.active.v1";
const RESEARCH_SELECTION_EVENT = "ai4s:research-selection-changed";
const AUTOPILOT_REQUEST_KEY = "ai4s.research.autopilot.request.v1";
const AUTOPILOT_STATE_KEY = "ai4s.research.autopilot.state.v1";
const AUTOPILOT_EVENT = "ai4s:research-autopilot-changed";
const AUTOPILOT_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
export const RESEARCH_CONTEXT_START = "[NEBULAMAT_INTERNAL_RESEARCH_CONTEXT]";
export const RESEARCH_CONTEXT_END = "[/NEBULAMAT_INTERNAL_RESEARCH_CONTEXT]";

type ResearchSelectionDetail = { researchId: string | null };
export type ResearchAutopilotStatus = "running" | "paused" | "approval" | "invalid" | "completed";
export type ResearchAutopilotState = {
  researchId: string;
  status: ResearchAutopilotStatus;
  stage: ResearchAutopilotStage;
  graphHash: string;
  cursor?: string;
  nextPrompt?: string;
  awaitingResponse?: boolean;
  updatedAt: number;
};

function resolvedWorkspace(workspace: string | null | undefined): string | null {
  return workspace === undefined ? researchWorkspaceKey() : workspace;
}

function workspaceStorageScope(workspace: string | null | undefined): string {
  const resolved = resolvedWorkspace(workspace);
  return resolved ? pathKey(resolved) : "<unbound>";
}

function sameWorkspaceScope(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null) || samePath(a, b);
}

function autopilotStateStorageKey(researchId: string, workspace?: string | null): string {
  return `${AUTOPILOT_STATE_KEY}:${workspaceStorageScope(workspace)}:${researchId}`;
}

function legacyAutopilotStateStorageKey(researchId: string, workspace?: string | null): string {
  return `${AUTOPILOT_STATE_KEY}:${resolvedWorkspace(workspace) ?? "<unbound>"}:${researchId}`;
}

/** Persist the autonomous loop state so a route change or app restart does not
 * turn a running research graph back into a manual, one-step workflow. */
export function getResearchAutopilotState(
  researchId: string,
  workspace?: string | null,
): ResearchAutopilotState | null {
  if (typeof window === "undefined") return null;
  try {
    const key = autopilotStateStorageKey(researchId, workspace);
    const legacyKey = legacyAutopilotStateStorageKey(researchId, workspace);
    const raw = window.localStorage.getItem(key)
      ?? (legacyKey === key ? null : window.localStorage.getItem(legacyKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResearchAutopilotState>;
    if (parsed.researchId !== researchId || typeof parsed.status !== "string") return null;
    return {
      ...parsed,
      stage: parsed.stage ?? "inspect",
      graphHash: parsed.graphHash ?? "",
    } as ResearchAutopilotState;
  } catch {
    return null;
  }
}

export function setResearchAutopilotState(
  researchId: string,
  state: Omit<ResearchAutopilotState, "researchId" | "updatedAt" | "stage" | "graphHash"> & {
    stage?: ResearchAutopilotStage;
    graphHash?: string;
  },
  workspace?: string | null,
): void {
  if (typeof window === "undefined") return;
  const previous = getResearchAutopilotState(researchId, workspace);
  const next: ResearchAutopilotState = {
    researchId,
    stage: state.stage ?? previous?.stage ?? "inspect",
    graphHash: state.graphHash ?? previous?.graphHash ?? "",
    ...state,
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(autopilotStateStorageKey(researchId, workspace), JSON.stringify(next));
  } catch {
    /* localStorage is optional; the mounted bar still owns live state. */
  }
  window.dispatchEvent(new CustomEvent(AUTOPILOT_EVENT, { detail: next }));
}

/** Request autonomous research from any route. The request is deliberately
 * durable for a short window: ResearchPage can navigate to /live and the
 * conversation bar will consume it after the live pane has mounted. */
export function requestResearchAutopilot(researchId: string, workspace?: string | null): void {
  setActiveResearchId(researchId, workspace);
  if (typeof window === "undefined") return;
  const request = { researchId, workspace: workspace ?? researchWorkspaceKey(), requestedAt: Date.now() };
  try {
    window.localStorage.setItem(AUTOPILOT_REQUEST_KEY, JSON.stringify(request));
  } catch {
    /* ignore optional storage failures */
  }
  setResearchAutopilotState(researchId, { status: "running", stage: "inspect", graphHash: "" }, workspace);
  window.dispatchEvent(new CustomEvent(AUTOPILOT_EVENT, { detail: request }));
}

export function consumeResearchAutopilotRequest(researchId: string, workspace?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(AUTOPILOT_REQUEST_KEY);
    if (!raw) return false;
    const request = JSON.parse(raw) as { researchId?: string; workspace?: string | null; requestedAt?: number };
    const currentWorkspace = workspace ?? researchWorkspaceKey();
    const fresh = typeof request.requestedAt === "number" && Date.now() - request.requestedAt < AUTOPILOT_REQUEST_MAX_AGE_MS;
    if (request.researchId !== researchId || !sameWorkspaceScope(request.workspace, currentWorkspace) || !fresh) return false;
    window.localStorage.removeItem(AUTOPILOT_REQUEST_KEY);
    return true;
  } catch {
    return false;
  }
}

export function subscribeResearchAutopilot(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AUTOPILOT_EVENT, listener);
  return () => window.removeEventListener(AUTOPILOT_EVENT, listener);
}

function storageKey(workspace?: string | null): string {
  return `${ACTIVE_RESEARCH_KEY}:${workspaceStorageScope(workspace)}`;
}

function legacyStorageKey(workspace?: string | null): string {
  return `${ACTIVE_RESEARCH_KEY}:${resolvedWorkspace(workspace) ?? "<unbound>"}`;
}

/** Read the active graph selection without touching the runtime or filesystem. */
export function getActiveResearchId(workspace?: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = storageKey(workspace);
    const legacyKey = legacyStorageKey(workspace);
    return window.localStorage.getItem(key)
      || (legacyKey === key ? null : window.localStorage.getItem(legacyKey))
      || null;
  } catch {
    return null;
  }
}

/** Select the graph that should be attached to new conversation turns. */
export function setActiveResearchId(researchId: string | null, workspace?: string | null): void {
  if (typeof window !== "undefined") {
    try {
      const key = storageKey(workspace);
      const legacyKey = legacyStorageKey(workspace);
      if (researchId) window.localStorage.setItem(key, researchId);
      else window.localStorage.removeItem(key);
      if (legacyKey !== key) window.localStorage.removeItem(legacyKey);
    } catch {
      /* localStorage is optional; the in-memory event still updates mounted UI. */
    }
    window.dispatchEvent(new CustomEvent<ResearchSelectionDetail>(RESEARCH_SELECTION_EVENT, {
      detail: { researchId },
    }));
  }
}

/** Subscribe to selection changes from the research page or another pane. */
export function subscribeResearchSelection(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => listener();
  window.addEventListener(RESEARCH_SELECTION_EVENT, onChange);
  return () => window.removeEventListener(RESEARCH_SELECTION_EVENT, onChange);
}

/** Resolve the currently selected graph while guarding against workspace drift. */
export async function getActiveResearchGraph(workspace?: string | null): Promise<ResearchGraph | null> {
  const id = getActiveResearchId(workspace);
  if (!id) return null;
  try {
    const runtime = await initializeResearchWorkspace();
    if (workspace !== undefined && !sameWorkspaceScope(researchWorkspaceKey(), workspace)) return null;
    return runtime.listResearch().find((graph) => graph.researchId === id) ?? null;
  } catch {
    return null;
  }
}

function compact(value: string, max = 420): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

/**
 * Build the model-facing context. The graph remains the source of truth, but
 * only decision-relevant state is sent on every turn so a long graph does not
 * become an opaque transcript dump.
 */
export function buildResearchPromptContext(graph: ResearchGraph): string {
  const claims = graph.nodes
    .filter((node): node is Extract<ResearchNode, { kind: "claim" }> => node.kind === "claim")
    .slice(0, 6)
    .map((node) => `- ${node.id}: ${compact(node.statement)}`);
  const hypotheses = graph.nodes
    .filter((node): node is Extract<ResearchNode, { kind: "hypothesis" }> => node.kind === "hypothesis" && (node.status === "open" || node.status === "favoured"))
    .slice(0, 8)
    .map((node) => `- ${node.id}: ${compact(node.statement)}`);
  const blockers = graph.nodes
    .filter((node): node is Extract<ResearchNode, { kind: "action" }> => node.kind === "action" && (node.status === "failed" || node.status === "inconclusive"))
    .slice(-5)
    .map((node) => `- ${node.id}: ${compact(node.objective)}`);
  const actions = graph.nodes
    .filter((node): node is Extract<ResearchNode, { kind: "action" }> => node.kind === "action" && (node.status === "proposed" || node.status === "approved" || node.status === "running"))
    .slice(-5)
    .map((node) => `- ${node.id} [${node.status}]: ${compact(node.objective)}`);
  const lines = [
    RESEARCH_CONTEXT_START,
    "This is advisory CEBRO context. Do not mark a claim supported unless the graph's evidence contract is satisfied.",
    `researchId: ${graph.researchId}`,
    `graphHash: ${graph.hash}`,
    `objective: ${compact(graph.objective, 600)}`,
    "claims:",
    ...(claims.length ? claims : ["- none"]),
    "openHypotheses:",
    ...(hypotheses.length ? hypotheses : ["- none"]),
    "activeActions:",
    ...(actions.length ? actions : ["- none"]),
    "blockers:",
    ...(blockers.length ? blockers : ["- none"]),
    "For this turn, identify falsifiers, evidence requirements, uncertainty, and the lowest-cost discriminating next action when relevant.",
    RESEARCH_CONTEXT_END,
  ];
  return lines.join("\n");
}

/** Compile the CEBRO fact boundary, then render an InnoClaw-style report
 * template without allowing prose generation to upgrade claim status. */
export async function compileInnoClawResearchReport(
  researchId: string,
  generatedBy = "desktop:cebro-report-template",
): Promise<string> {
  const runtime = await initializeResearchWorkspace();
  return runtime.compileInnoClawReport(researchId, generatedBy);
}

/** Add the context as an internal suffix understood by the runtime adapter. */
export function appendResearchPromptContext(prompt: string, graph: ResearchGraph | null): string {
  return graph ? `${prompt}\n\n${buildResearchPromptContext(graph)}` : prompt;
}

/** Prompt used by the autonomous loop. The fenced schema is intentionally
 * strict: prose is useful for a person, but never sufficient to mutate a graph. */
export function buildResearchAutopilotPrompt(
  graph: ResearchGraph,
  stage: ResearchAutopilotStage = "inspect",
): string {
  const stageInstruction: Record<ResearchAutopilotStage, string> = {
    inspect: "Inspect only. Summarize the current graph, missing contract fields, pending actions, and blockers without adding nodes.",
    hypothesize: "Add explicit competing, falsifiable hypotheses only. State alternatives and do not plan or execute actions yet.",
    plan: "Propose the lowest-cost discriminating actions only. Each action must test a claim and declare cost, risk, and reversibility.",
    execute: "Do not add nodes. Ask the application to execute the already-planned action through a registered adapter.",
    evaluate: "Interpret only traceable outputs already present in the graph. Model-authored evidence must remain qualifying or inconclusive.",
    synthesize: "Assess the claim contract and blockers. Finish only if readiness or a durable terminal blocker permits it.",
  };
  return [
    "Operate as the autonomous CEBRO research operator for this objective.",
    "Follow the stage machine exactly: inspect -> hypothesize -> plan -> execute -> evaluate -> synthesize.",
    `The required stage for this turn is ${stage}.`,
    stageInstruction[stage],
    "Read the current graph before acting. Never skip a stage or treat a transcript statement as a completed action.",
    "You may inspect files, run read-only analysis, derive arguments, or perform reversible work through available tools.",
    "Do not initiate paid compute, submit remote jobs, operate instruments, contact people, change external systems, or perform irreversible work.",
    "Represent those steps only as proposed actions with risk greater than 0 or reversibility below 1; the application will pause for approval.",
    "Never call speculation, a planned action, or a plain transcript statement evidence. Only adapter-produced outputs are execution evidence; model-added evidence must be inconclusive or qualifying.",
    "Set done=true only in the synthesize stage when the claim readiness report is ready, or when a durable failed/inconclusive action is an explicit blocker and no pending action remains.",
    "At the end of every turn, emit exactly one fenced JSON object using schemaVersion 1. Include the prompt graphHash exactly.",
    "```json",
    `{\"schemaVersion\":1,\"stage\":\"${stage}\",\"graphHash\":\"${graph.hash}\",\"summary\":\"...\",\"hypotheses\":[],\"actions\":[],\"evidence\":[],\"nextStage\":\"${stage}\",\"nextPrompt\":\"...\",\"done\":false}`,
    "```",
    "Use empty arrays when there is nothing new. Set done=true when no safe, useful next step remains.",
    buildResearchPromptContext(graph),
  ].join("\n\n");
}

export function parseAutopilotProposal(text: string): ResearchAgentProposal | null {
  return parseResearchAgentProposal(text);
}

export function autopilotProposalNeedsApproval(proposal: ResearchAgentProposal): boolean {
  return researchAgentProposalNeedsApproval(proposal);
}

export function researchGraphNeedsApproval(graph: ResearchGraph): boolean {
  return graph.nodes.some((node) => node.kind === "action" && node.status === "proposed" && (
    node.risk > 0 || node.reversibility < 1 || node.cost.normalized > 0.7
    || node.actionType === "measure" || node.actionType === "synthesize"
  ));
}

export function validateResearchAutopilotProposal(
  graph: ResearchGraph,
  proposal: ResearchAgentProposal,
  expectedStage: ResearchAutopilotStage,
): void {
  if (proposal.graphHash !== graph.hash) {
    throw new Error("Autonomous research response belongs to an older graph revision.");
  }
  if (proposal.stage !== expectedStage) {
    throw new Error(`Autonomous research stage mismatch: expected ${expectedStage}, received ${proposal.stage}.`);
  }
  if (!canAdvanceResearchAutopilotStage(proposal.stage, proposal.nextStage)) {
    throw new Error(`Invalid autonomous research stage transition: ${proposal.stage} -> ${proposal.nextStage}.`);
  }
  if (proposal.stage !== "hypothesize" && proposal.hypotheses.length) {
    throw new Error("Hypotheses may only be added during the hypothesize stage.");
  }
  if (proposal.stage !== "plan" && proposal.actions.length) {
    throw new Error("Actions may only be planned during the plan stage.");
  }
  if (proposal.stage !== "evaluate" && proposal.evidence.length) {
    throw new Error("Evidence interpretation may only be recorded during the evaluate stage.");
  }
  if (proposal.stage === "inspect" && (proposal.hypotheses.length || proposal.actions.length || proposal.evidence.length)) {
    throw new Error("Inspect stage may only describe the current graph; it cannot add nodes.");
  }
  if (proposal.stage === "execute" && (proposal.hypotheses.length || proposal.actions.length || proposal.evidence.length)) {
    throw new Error("Execute stage is controlled by the runtime and cannot append model-authored nodes.");
  }
  if (proposal.stage === "evaluate" && proposal.actions.length) {
    throw new Error("Evaluate stage cannot create a new action before recording the current result.");
  }
  if (proposal.evidence.some((evidence) => evidence.relation === "supports" || evidence.relation === "refutes")) {
    throw new Error("Only adapter-produced output may support or refute a claim; model evidence is limited to qualifying or inconclusive interpretation.");
  }
  if (proposal.done && (proposal.stage !== "synthesize" || proposal.nextStage !== "synthesize")) {
    throw new Error("Autonomous research can finish only from the synthesize stage.");
  }
  if (proposal.done) {
    const root = graph.nodes.find((node) => node.id === graph.rootClaimId && node.kind === "claim");
    const ready = root ? evaluateClaimReadiness(graph, root.id).ready : false;
    const pending = graph.nodes.some((node) => node.kind === "action" && ["proposed", "approved", "running"].includes(node.status));
    const hasTerminalBlocker = graph.nodes.some((node) => node.kind === "action" && ["failed", "inconclusive"].includes(node.status));
    if (!ready && (pending || !hasTerminalBlocker)) {
      throw new Error("Autonomous research cannot finish before claim readiness or an explicit terminal blocker.");
    }
  }
}

export async function applyResearchAgentProposal(
  researchId: string,
  proposal: ResearchAgentProposal,
  source = "agent:research-autopilot",
  workspace?: string | null,
): Promise<ResearchGraph> {
  const runtime = await initializeResearchWorkspace();
  if (workspace !== undefined && !sameWorkspaceScope(researchWorkspaceKey(), workspace)) {
    throw new Error("Research workspace changed while autonomous research was running.");
  }
  let graph = runtime.getResearch(researchId);
  const state = getResearchAutopilotState(researchId, workspace);
  validateResearchAutopilotProposal(graph, proposal, state?.stage ?? proposal.stage);
  graph = runtime.applyAgentProposal(researchId, proposal, source);

  // A proposal is allowed to advance without a backend. When a backend is
  // available, however, automatically run only explicitly safe adapters so
  // the next model turn sees real derived evidence rather than another plan.
  // Unknown, external-effect, and under-specified adapters remain proposed.
  const candidates = proposal.stage === "plan"
    ? proposal.actions
    : proposal.stage === "execute"
      ? graph.nodes.filter((node): node is Extract<ResearchNode, { kind: "action" }> => node.kind === "action" && node.status === "proposed")
        .map((action) => ({ id: action.id, risk: action.risk, reversibility: action.reversibility, cost: action.cost.normalized, objective: action.objective }))
      : [];
  for (const candidate of candidates) {
    const action = graph.nodes.find((node) => node.kind === "action" && (
      candidate.id ? node.id === candidate.id : node.objective === candidate.objective
    ));
    if (!action || action.kind !== "action" || action.status !== "proposed") continue;
    if ((candidate.risk ?? 0) > 0 || (candidate.reversibility ?? 1) < 1 || (candidate.cost ?? 0.3) > 0.7) continue;
    const safeAdapter = runtime.listAdapters().find((adapter) => {
      if (!adapter.capabilities || adapter.capabilities.externalEffects) return false;
      if (!adapter.capabilities.safetyClasses.some((safetyClass) => safetyClass === "read-only" || safetyClass === "reversible")) return false;
      if (!adapter.actionTypes.includes(action.actionType)) return false;
      return graph.modes.includes("hybrid") || adapter.modes.includes("hybrid")
        || adapter.modes.some((mode) => graph.modes.includes(mode));
    });
    if (!safeAdapter) continue;
    try {
      graph = (await runtime.executeAction(researchId, action.id)).research;
    } catch {
      // The runtime records adapter failures durably; the next turn can inspect
      // that failed action and choose a different discriminating path.
      graph = runtime.getResearch(researchId);
    }
  }
  return graph;
}

export function latestAgentResponse(blocks: ThreadBlock[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind === "agent" && block.markdown.trim()) return block.markdown.trim();
  }
  return null;
}

export type ConversationOutputKind = "evidence" | "hypothesis" | "action" | "artifact";

function outputId(kind: ConversationOutputKind, researchId: string): string {
  return `conversation:${kind}:${researchId}:${Date.now()}`;
}

/** Persist a user-approved conversation result as a typed graph node. */
export async function recordConversationOutput(input: {
  researchId: string;
  kind: ConversationOutputKind;
  text: string;
  sessionId?: string | null;
}): Promise<ResearchGraph> {
  const text = input.text.trim();
  if (!text) throw new Error("Conversation output is empty");
  const runtime = await initializeResearchWorkspace();
  const graph = runtime.getResearch(input.researchId);
  const branchId = "branch:main";
  const now = Date.now();
  const source = input.sessionId ? `session:${input.sessionId}` : "conversation:active";
  const contentHash = stableHash({ source, text });

  if (input.kind === "evidence") {
    const evidence = {
      id: outputId("evidence", graph.researchId),
      kind: "evidence" as const,
      label: "Conversation evidence",
      branchId,
      createdAt: now,
      evidenceKind: "argument" as const,
      summary: text,
      relation: "inconclusive" as ResearchEvidenceRelation,
      strength: 0.25,
      uncertainty: "Conversation output is a proposal until independently checked.",
      sourceRefs: [source],
      artifactIds: [],
      contentHash,
      independent: false,
      sourceFamily: source,
      metadata: { origin: "conversation", sessionId: input.sessionId ?? null },
    };
    const next = addResearchEvidence(graph, { evidence, claimId: graph.rootClaimId, actor: "desktop:conversation" });
    runtime.replaceResearch(next);
    return next;
  }

  if (input.kind === "hypothesis") {
    const node: Extract<ResearchNode, { kind: "hypothesis" }> = {
      id: outputId("hypothesis", graph.researchId),
      kind: "hypothesis",
      label: "Conversation hypothesis",
      branchId,
      createdAt: now,
      statement: text,
      status: "open",
      metadata: { origin: "conversation", sessionId: input.sessionId ?? null },
    };
    const next = addResearchNode(graph, node, { actor: "desktop:conversation", at: now });
    runtime.replaceResearch(next);
    return next;
  }

  if (input.kind === "action") {
    const action = runtime.proposeAction(input.researchId, {
      id: outputId("action", graph.researchId),
      actionType: "challenge" satisfies ResearchActionType,
      objective: text,
      expectedInformationGain: 0.6,
      expectedConfidenceGain: 0.3,
      cost: { normalized: 0.3 },
      risk: 0,
      reversibility: 1,
      testsClaimIds: [graph.rootClaimId],
      branchId,
    });
    const next = updateResearchAction(runtime.getResearch(input.researchId), action.id, {
      metadata: { origin: "conversation", sessionId: input.sessionId ?? null, contentHash },
    }, { actor: "desktop:conversation" });
    runtime.replaceResearch(next);
    return next;
  }

  const artifact: Extract<ResearchNode, { kind: "artifact" }> = {
    id: outputId("artifact", graph.researchId),
    kind: "artifact",
    label: "Conversation note",
    branchId,
    createdAt: now,
    artifactType: "report",
    locator: source,
    contentHash,
    reproducibility: { inputs: [source] },
    metadata: { origin: "conversation", text },
  };
  const next = addResearchNode(graph, artifact, { actor: "desktop:conversation", at: now });
  runtime.replaceResearch(next);
  return next;
}
