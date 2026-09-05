import {
  addResearchEdge,
  addResearchNode,
  compileResearchReport,
  createResearchGraph,
  createResearchBranch,
  createInnoClawContextArchiveArtifact,
  mergeResearchBranch,
  migrateResearchGraph,
  renderInnoClawResearchReport,
  scoreResearchAction,
  selectNextResearchAction,
  stableHash,
  updateResearchAction,
  type ResearchActionCandidate,
  type ResearchActionNode,
  type ResearchActionType,
  type ResearchArtifactNode,
  type ResearchEvidenceNode,
  type InnoClawEvidenceCard,
  type ResearchGraph,
  type ResearchMode,
  type ResearchNode,
  type ResearchReplayability,
  type ResearchReplayRecipe,
  type ResearchReport,
  type ResearchRole,
  type ResearchSafetyClass,
} from "@ai4s/shared";
import type { ResearchAgentProposal } from "@ai4s/shared";
import type { AgentRuntime } from "./runtime";

export interface ResearchActionExecution {
  status: "completed" | "failed" | "inconclusive";
  summary: string;
  evidence?: ResearchEvidenceNode[];
  artifacts?: ResearchArtifactNode[];
  replay?: Omit<ResearchReplayRecipe, "hash">;
}

export interface ResearchAdapterCapabilities {
  version: string;
  modes: readonly ResearchMode[];
  actionTypes: readonly ResearchActionType[];
  safetyClasses: readonly ResearchSafetyClass[];
  replayability: readonly ResearchReplayability[];
  externalEffects: boolean;
}

export interface ResearchActionAdapterContext {
  graph: ResearchGraph;
  action: ResearchActionNode;
  signal?: AbortSignal;
}

/** A backend adapter is the only discipline-specific part of CEBRO. */
export interface ResearchActionAdapter {
  id: string;
  modes: readonly ResearchMode[];
  actionTypes: readonly ResearchActionType[];
  capabilities?: ResearchAdapterCapabilities;
  canHandle?: (context: ResearchActionAdapterContext) => boolean;
  execute(context: ResearchActionAdapterContext): Promise<ResearchActionExecution>;
}

export interface ResearchRuntimeOptions {
  agentRuntime?: AgentRuntime;
  actor?: string;
  now?: () => number;
  /** The application owns durable storage; this callback receives every new immutable graph version. */
  onGraphChanged?: (graph: ResearchGraph) => void;
}

export interface ResearchAgentTurnOptions {
  agent?: string;
  model?: string | null;
  variant?: string | null;
  language?: string | null;
}

export interface ResearchExecutionResult {
  research: ResearchGraph;
  execution: ResearchActionExecution;
}

export interface InnoClawRolePlan {
  role: ResearchRole;
  branchId: string;
  actionId: string;
  actionType: ResearchActionType;
  objective: string;
}

function validateAdapterExecution(
  graph: ResearchGraph,
  action: ResearchActionNode,
  adapter: ResearchActionAdapter,
  execution: ResearchActionExecution,
): void {
  if (!execution || !["completed", "failed", "inconclusive"].includes(execution.status)) {
    throw new Error("Research adapter returned an invalid execution status");
  }
  if (typeof execution.summary !== "string" || execution.summary.trim().length === 0) {
    throw new Error("Research adapter execution summary must not be empty");
  }
  if (execution.artifacts !== undefined && !Array.isArray(execution.artifacts)) {
    throw new Error("Research adapter artifacts must be an array");
  }
  if (execution.evidence !== undefined && !Array.isArray(execution.evidence)) {
    throw new Error("Research adapter evidence must be an array");
  }
  const outputs: ResearchNode[] = [
    ...(execution.artifacts ?? []),
    ...(execution.evidence ?? []),
  ];
  const outputIds = new Set<string>();
  for (const node of outputs) {
    if (outputIds.has(node.id) || graph.nodes.some((existing) => existing.id === node.id)) {
      throw new Error(`Research adapter returned a duplicate node id: ${node.id}`);
    }
    if (node.branchId !== action.branchId) {
      throw new Error(`Research adapter output ${node.id} crosses the action branch boundary`);
    }
    outputIds.add(node.id);
  }
  if (execution.replay) {
    if (execution.replay.adapterId !== adapter.id) {
      throw new Error("Research adapter replay recipe must identify the executing adapter");
    }
    if (adapter.capabilities && !adapter.capabilities.replayability.includes(execution.replay.replayability)) {
      throw new Error(`Research adapter does not support replayability ${execution.replay.replayability}`);
    }
    if (execution.replay.inputNodeIds.some((nodeId) => !graph.nodes.some((node) => node.id === nodeId))) {
      throw new Error("Research adapter replay recipe references an unknown input node");
    }
  }
}

/**
 * In-memory orchestration facade for the shared CEBRO kernel.
 *
 * Persistence belongs to the application workspace/provenance layer. This
 * class deliberately owns no filesystem and can therefore be used by desktop,
 * web, notebook or headless runners with the same graph semantics.
 */
export class ResearchRuntime {
  private readonly graphs = new Map<string, ResearchGraph>();
  private readonly adapters = new Map<string, ResearchActionAdapter>();
  private readonly actor: string;
  private readonly now: () => number;

  constructor(private readonly options: ResearchRuntimeOptions = {}) {
    this.actor = options.actor ?? "system:research-runtime";
    this.now = options.now ?? (() => Date.now());
  }

  registerAdapter(adapter: ResearchActionAdapter): () => void {
    if (!adapter.id.trim()) throw new Error("Research adapter id must not be empty");
    if (this.adapters.has(adapter.id)) throw new Error(`Research adapter already registered: ${adapter.id}`);
    if (adapter.capabilities) {
      if (!adapter.capabilities.version.trim()) throw new Error(`Research adapter ${adapter.id} must declare a capability version`);
      if (adapter.capabilities.externalEffects
        && !adapter.capabilities.safetyClasses.some((safetyClass) => safetyClass === "external-effect" || safetyClass === "irreversible")) {
        throw new Error(`Research adapter ${adapter.id} declares external effects without an external safety class`);
      }
      if (adapter.capabilities.modes.some((mode) => !adapter.modes.includes(mode))) {
        throw new Error(`Research adapter ${adapter.id} capability modes must be a subset of adapter modes`);
      }
      if (adapter.capabilities.actionTypes.some((actionType) => !adapter.actionTypes.includes(actionType))) {
        throw new Error(`Research adapter ${adapter.id} capability actions must be a subset of adapter actions`);
      }
    }
    this.adapters.set(adapter.id, adapter);
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id);
    };
  }

  listAdapters(): ResearchActionAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  createResearch(input: Parameters<typeof createResearchGraph>[0]): ResearchGraph {
    if (this.graphs.has(input.researchId)) throw new Error(`Research already exists: ${input.researchId}`);
    const graph = createResearchGraph({ ...input, actor: input.actor ?? this.actor, now: input.now ?? this.now() });
    this.commit(graph);
    return graph;
  }

  getResearch(researchId: string): ResearchGraph {
    const graph = this.graphs.get(researchId);
    if (!graph) throw new Error(`Unknown research: ${researchId}`);
    return graph;
  }

  listResearch(): ResearchGraph[] {
    return [...this.graphs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  replaceResearch(graph: ResearchGraph): ResearchGraph {
    if (!this.graphs.has(graph.researchId)) throw new Error(`Unknown research: ${graph.researchId}`);
    const normalized = migrateResearchGraph(graph);
    this.commit(normalized);
    return normalized;
  }

  /** Load a validated graph from the application-owned workspace store.
   * Hydration deliberately does not emit onGraphChanged, so opening a workspace
   * never creates a new provenance record for an unchanged graph. */
  hydrateResearch(graph: ResearchGraph): ResearchGraph {
    const normalized = migrateResearchGraph(graph);
    const existing = this.graphs.get(normalized.researchId);
    if (existing && existing.hash !== normalized.hash) {
      throw new Error(`Research already hydrated with a different graph: ${normalized.researchId}`);
    }
    this.graphs.set(normalized.researchId, normalized);
    return normalized;
  }

  proposeAction(researchId: string, candidate: ResearchActionCandidate): ResearchActionNode {
    const graph = this.getResearch(researchId);
    const branchId = candidate.branchId ?? "branch:main";
    if (!graph.branches.some((branch) => branch.id === branchId)) throw new Error(`Unknown research branch: ${branchId}`);
    const action: ResearchActionNode = {
      id: candidate.id,
      kind: "action",
      label: candidate.objective,
      branchId,
      createdAt: this.now(),
      actionType: candidate.actionType,
      objective: candidate.objective,
      status: "proposed",
      expectedInformationGain: candidate.expectedInformationGain,
      expectedConfidenceGain: candidate.expectedConfidenceGain,
      cost: candidate.cost,
      risk: candidate.risk ?? 0,
      reversibility: candidate.reversibility ?? 1,
      testsClaimIds: [...(candidate.testsClaimIds ?? [])],
      producedNodeIds: [],
      ...(candidate.adapter ? { adapter: candidate.adapter } : {}),
      ...(candidate.intervention ? { intervention: candidate.intervention } : {}),
      ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
    };
    const next = addResearchNode(graph, action, { actor: this.actor, at: action.createdAt });
    this.commit(next);
    return action;
  }

  /** Ingest one Paper Study/Evidence Card through the normal action lifecycle. */
  async ingestInnoClawEvidenceCard(
    researchId: string,
    card: InnoClawEvidenceCard,
    options: { claimIds?: string[]; relation?: "supports" | "refutes" | "qualifies" | "inconclusive"; actionId?: string } = {},
  ): Promise<ResearchExecutionResult> {
    const graph = this.getResearch(researchId);
    const action = this.proposeAction(researchId, {
      id: options.actionId ?? `action:innoclaw:evidence:${card.id}:${this.now()}`,
      actionType: "retrieve",
      objective: `Ingest InnoClaw evidence card: ${card.query}`,
      expectedInformationGain: 0.6,
      expectedConfidenceGain: 0.3,
      cost: { normalized: 0.2 },
      testsClaimIds: options.claimIds ?? [graph.rootClaimId],
      adapter: "innoclaw:evidence-card",
      metadata: {
        innoclawEvidenceCard: card,
        ...(options.relation ? { evidenceRelation: options.relation } : {}),
      },
    });
    return this.executeAction(researchId, action.id);
  }

  /** Create an isolated InnoClaw-style specialist branch. */
  createRoleBranch(
    researchId: string,
    role: ResearchRole,
    options: { branchId?: string; label?: string; parentBranchId?: string; hypothesisIds?: string[] } = {},
  ) {
    const graph = this.getResearch(researchId);
    const branchId = options.branchId ?? `branch:${role}:${this.now()}`;
    const next = createResearchBranch(graph, {
      branchId,
      role,
      label: options.label ?? `${role} research line`,
      parentBranchId: options.parentBranchId,
      hypothesisIds: options.hypothesisIds,
      now: this.now(),
    }, { actor: this.actor });
    this.commit(next);
    return next.branches.find((branch) => branch.id === branchId)!;
  }

  /** Seed the five InnoClaw specialist lanes without granting any lane an
   * implicit merge or execution authority. Each lane gets its own branch and
   * one auditable action proposal; a later merge is always explicit. */
  createInnoClawRoleTeam(
    researchId: string,
    options: { roles?: ResearchRole[]; parentBranchId?: string; query?: string } = {},
  ): { research: ResearchGraph; plans: InnoClawRolePlan[] } {
    const roles = options.roles ?? ["researcher", "skeptic", "librarian", "reproducer", "scribe"];
    const uniqueRoles = [...new Set(roles)];
    const plans: InnoClawRolePlan[] = [];
    let graph = this.getResearch(researchId);
    for (const role of uniqueRoles) {
      const branchId = `branch:${role}:${this.now()}:${plans.length}`;
      graph = this.getResearch(researchId);
      this.createRoleBranch(researchId, role, { branchId, parentBranchId: options.parentBranchId });
      const actionType: ResearchActionType = role === "researcher"
        ? "derive"
        : role === "skeptic"
          ? "challenge"
          : role === "librarian"
            ? "retrieve"
            : role === "reproducer"
              ? "compute"
              : "synthesize";
      const objective = role === "researcher"
        ? "Develop the strongest derivation or mechanism for the active claim."
        : role === "skeptic"
          ? "Search for falsifiers, boundary conditions, and competing explanations."
          : role === "librarian"
            ? options.query?.trim() ? `Retrieve and triage literature for: ${options.query.trim()}` : "Retrieve and triage the most relevant literature."
            : role === "reproducer"
              ? "Reproduce the strongest available result with an independent setup."
              : "Compile a report from the graph without upgrading claim readiness.";
      const actionId = `action:${role}:${this.now()}:${plans.length}`;
      this.proposeAction(researchId, {
        id: actionId,
        actionType,
        objective,
        expectedInformationGain: role === "scribe" ? 0.1 : 0.55,
        expectedConfidenceGain: role === "scribe" ? 0.05 : 0.25,
        cost: { normalized: role === "librarian" ? 0.25 : 0.35 },
        risk: role === "reproducer" ? 0.2 : 0,
        reversibility: 1,
        branchId,
        // Specialist outputs stay isolated until mergeRoleBranchOutputs clones
        // reviewed evidence into the target branch.
        testsClaimIds: [],
        ...(role === "librarian" && options.query?.trim() ? { adapter: "innoclaw:literature-provider" } : {}),
        metadata: {
          innoclawRole: role,
          ...(options.query?.trim() && role === "librarian" ? { literatureQuery: options.query.trim() } : {}),
        },
      });
      plans.push({ role, branchId, actionId, actionType, objective });
    }
    graph = this.getResearch(researchId);
    return { research: graph, plans };
  }

  /** Explicitly merge a specialist branch; graph edges never cross implicitly. */
  mergeRoleBranch(
    researchId: string,
    branchId: string,
    targetBranchId = "branch:main",
    note?: string,
  ): ResearchGraph {
    const graph = this.getResearch(researchId);
    const next = mergeResearchBranch(graph, {
      branchId,
      targetBranchId,
      note,
      now: this.now(),
    }, { actor: this.actor });
    this.commit(next);
    return next;
  }

  /** Promote reviewed artifacts/evidence into a target branch, then close the
   * specialist branch. Clones keep an explicit mergedFrom provenance pointer;
   * source nodes remain immutable in their original branch. */
  mergeRoleBranchOutputs(
    researchId: string,
    branchId: string,
    options: { targetBranchId?: string; targetClaimId?: string; nodeIds?: string[]; note?: string } = {},
  ): ResearchGraph {
    let graph = this.getResearch(researchId);
    const targetBranchId = options.targetBranchId ?? "branch:main";
    const targetClaimId = options.targetClaimId ?? graph.rootClaimId;
    const targetClaim = graph.nodes.find((node) => node.id === targetClaimId && node.kind === "claim");
    if (!targetClaim || targetClaim.branchId !== targetBranchId) {
      throw new Error("Role branch output merge requires a claim in the target branch");
    }
    const requested = options.nodeIds ? new Set(options.nodeIds) : null;
    const evidence = graph.nodes.filter((node): node is ResearchEvidenceNode => (
      node.kind === "evidence" && node.branchId === branchId && (!requested || requested.has(node.id))
    ));
    const requiredArtifactIds = new Set(evidence.flatMap((node) => node.artifactIds));
    const artifacts = graph.nodes.filter((node): node is ResearchArtifactNode => (
      node.kind === "artifact"
      && node.branchId === branchId
      && ((!requested && requiredArtifactIds.has(node.id)) || requested?.has(node.id) || requiredArtifactIds.has(node.id))
    ));
    const unknownRequested = requested ? [...requested].filter((id) => !evidence.some((node) => node.id === id) && !artifacts.some((node) => node.id === id)) : [];
    if (unknownRequested.length) throw new Error(`Role branch merge contains unknown or unsupported nodes: ${unknownRequested.join(", ")}`);

    const at = this.now();
    const artifactIds = new Map<string, string>();
    for (const artifact of artifacts) {
      const id = `${artifact.id}:merged:${targetBranchId}:${at}`;
      artifactIds.set(artifact.id, id);
      graph = addResearchNode(graph, {
        ...artifact,
        id,
        branchId: targetBranchId,
        createdAt: at,
        metadata: { ...artifact.metadata, mergedFromNodeId: artifact.id, mergedFromBranchId: branchId },
      }, { actor: this.actor, at });
    }
    for (const item of evidence) {
      const id = `${item.id}:merged:${targetBranchId}:${at}`;
      graph = addResearchNode(graph, {
        ...item,
        id,
        branchId: targetBranchId,
        createdAt: at,
        artifactIds: item.artifactIds.map((artifactId) => artifactIds.get(artifactId)).filter((artifactId): artifactId is string => Boolean(artifactId)),
        metadata: { ...item.metadata, mergedFromNodeId: item.id, mergedFromBranchId: branchId },
      }, { actor: this.actor, at });
      graph = addResearchEdge(graph, {
        source: id,
        target: targetClaimId,
        kind: item.relation,
        branchId: targetBranchId,
        at,
      }, { actor: this.actor });
    }
    graph = mergeResearchBranch(graph, {
      branchId,
      targetBranchId,
      note: options.note ?? `Promoted ${evidence.length} evidence and ${artifacts.length} artifact node(s).`,
      now: at,
    }, { actor: this.actor });
    this.commit(graph);
    return graph;
  }

  attachInnoClawContextArchive(
    researchId: string,
    input: { locator: string; contentHash: string; sourceArtifactIds: string[]; branchId?: string; summary?: string },
  ): ResearchArtifactNode {
    const graph = this.getResearch(researchId);
    const at = this.now();
    const artifact = createInnoClawContextArchiveArtifact({
      id: `artifact:innoclaw-context:${researchId}:${at}`,
      branchId: input.branchId ?? "branch:main",
      locator: input.locator,
      contentHash: input.contentHash,
      sourceArtifactIds: input.sourceArtifactIds,
      now: at,
      summary: input.summary,
    });
    this.commit(addResearchNode(graph, artifact, { actor: this.actor, at }));
    return artifact;
  }

  /** Human approval gate for actions with external effects or material cost. */
  approveAction(researchId: string, actionId: string, actor = "human:desktop"): ResearchActionNode {
    if (!actor.startsWith("human:")) throw new Error("Research action approval requires a named human actor");
    const graph = this.getResearch(researchId);
    const action = graph.nodes.find((node): node is ResearchActionNode => node.id === actionId && node.kind === "action");
    if (!action) throw new Error(`Unknown research action: ${actionId}`);
    if (action.status !== "proposed") throw new Error(`Research action is not awaiting approval: ${action.status}`);
    const next = updateResearchAction(graph, actionId, { status: "approved" }, { actor, at: this.now() });
    this.commit(next);
    return next.nodes.find((node): node is ResearchActionNode => node.id === actionId && node.kind === "action")!;
  }

  /** Dispatch an approved specialist action to an isolated agent session. The
   * worker may return a card or proposal, but it receives no graph mutation
   * capability through this method. */
  async dispatchRoleAction(
    researchId: string,
    actionId: string,
    sessionId: string,
    send: (prompt: string) => Promise<void>,
  ): Promise<ResearchActionNode> {
    let graph = this.getResearch(researchId);
    const action = graph.nodes.find((node): node is ResearchActionNode => node.kind === "action" && node.id === actionId);
    if (!action) throw new Error(`Unknown research action: ${actionId}`);
    if (action.status !== "approved") throw new Error(`Role action must be approved before dispatch: ${action.status}`);
    const branch = graph.branches.find((candidate) => candidate.id === action.branchId);
    const role = typeof action.metadata?.innoclawRole === "string" ? action.metadata.innoclawRole : branch?.role;
    if (!role) throw new Error("Research action is not assigned to an InnoClaw role branch");
    const at = this.now();
    graph = updateResearchAction(graph, action.id, {
      status: "running",
      metadata: { ...action.metadata, roleSessionId: sessionId, dispatchedAt: at },
    }, { actor: this.actor, at });
    this.commit(graph);
    const rootClaim = graph.nodes.find((node): node is Extract<ResearchNode, { kind: "claim" }> => (
      node.id === graph.rootClaimId && node.kind === "claim"
    ));
    const prompt = [
      `You are the ${role} specialist for one isolated CEBRO research branch.`,
      `Research: ${graph.title}`,
      `Objective: ${graph.objective}`,
      `Branch: ${action.branchId}`,
      `Assigned action: ${action.objective}`,
      `Root claim: ${rootClaim?.statement ?? graph.rootClaimId}`,
      `Graph hash at dispatch: ${graph.hash}`,
      "Do not modify the CEBRO graph or claim status. Return source-grounded findings, uncertainty, falsifiers, and typed Evidence Card data when literature is used.",
      "Any result remains branch-local until a human explicitly merges reviewed outputs.",
    ].join("\n\n");
    try {
      await send(prompt);
    } catch (error) {
      graph = updateResearchAction(this.getResearch(researchId), action.id, {
        status: "failed",
        metadata: { ...action.metadata, roleSessionId: sessionId, dispatchError: error instanceof Error ? error.message : String(error) },
      }, { actor: this.actor, at: this.now() });
      this.commit(graph);
      throw error;
    }
    return this.getResearch(researchId).nodes.find((node): node is ResearchActionNode => node.kind === "action" && node.id === action.id)!;
  }

  /** Apply one validated model proposal as an immutable graph transaction. */
  applyAgentProposal(researchId: string, proposal: ResearchAgentProposal, source = "agent:research-autopilot"): ResearchGraph {
    let graph = this.getResearch(researchId);
    const branchId = "branch:main";
    const now = this.now();
    let pendingCommit = false;
    for (const hypothesis of proposal.hypotheses) {
      const id = hypothesis.id?.trim() || `${researchId}:autopilot:hypothesis:${now}:${graph.nodes.length}`;
      if (graph.nodes.some((node) => node.id === id)) continue;
      const node = {
        id,
        kind: "hypothesis" as const,
        label: hypothesis.label ?? hypothesis.statement,
        branchId,
        createdAt: now,
        statement: hypothesis.statement,
        ...(hypothesis.alternatives ? { alternatives: [...hypothesis.alternatives] } : {}),
        status: "open" as const,
        metadata: { origin: "research-autopilot", source },
      };
      graph = addResearchNode(graph, node, { actor: this.actor, at: now });
      graph = addResearchEdge(graph, {
        source: id,
        target: graph.rootClaimId,
        kind: "challenges",
        branchId,
        at: now,
      }, { actor: this.actor });
      pendingCommit = true;
    }
    if (pendingCommit) {
      this.commit(graph);
      pendingCommit = false;
    }
    for (const candidate of proposal.actions) {
      const id = candidate.id?.trim() || `${researchId}:autopilot:action:${now}:${graph.nodes.length}`;
      if (graph.nodes.some((node) => node.id === id)) continue;
      const action = this.proposeAction(researchId, {
        id,
        actionType: candidate.actionType,
        objective: candidate.objective,
        expectedInformationGain: candidate.expectedInformationGain ?? 0.5,
        expectedConfidenceGain: candidate.expectedConfidenceGain ?? 0.25,
        cost: { normalized: candidate.cost ?? 0.3 },
        risk: candidate.risk ?? 0,
        reversibility: candidate.reversibility ?? 1,
        testsClaimIds: (candidate.testsClaimIds ?? [graph.rootClaimId]).filter((claimId) => graph.nodes.some((node) => node.id === claimId && node.kind === "claim")),
        branchId,
        ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
      });
      graph = this.getResearch(researchId);
      graph = updateResearchAction(graph, action.id, {
        metadata: { origin: "research-autopilot", source },
      }, { actor: this.actor, at: now });
      graph = addResearchEdge(graph, {
        source: action.id,
        target: graph.rootClaimId,
        kind: "tests",
        branchId,
        at: now,
      }, { actor: this.actor });
      this.commit(graph);
    }
    for (const item of proposal.evidence) {
      const id = item.id?.trim() || `${researchId}:autopilot:evidence:${now}:${graph.nodes.length}`;
      if (graph.nodes.some((node) => node.id === id)) continue;
      const evidence: ResearchEvidenceNode = {
        id,
        kind: "evidence",
        label: item.label ?? "Autopilot evidence",
        branchId,
        createdAt: now,
        evidenceKind: item.evidenceKind ?? "argument",
        summary: item.summary,
        relation: item.relation,
        strength: item.strength ?? 0.25,
        ...(item.uncertainty ? { uncertainty: item.uncertainty } : {}),
        sourceRefs: [source],
        artifactIds: [],
        independent: false,
        ...(item.sourceFamily ? { sourceFamily: item.sourceFamily } : {}),
        metadata: { origin: "research-autopilot", source },
      };
      graph = addResearchNode(graph, evidence, { actor: this.actor, at: now });
      graph = addResearchEdge(graph, {
        source: evidence.id,
        target: graph.rootClaimId,
        kind: evidence.relation,
        branchId,
        at: now,
      }, { actor: this.actor });
      pendingCommit = true;
    }
    if (pendingCommit) this.commit(graph);
    return this.getResearch(researchId);
  }

  chooseNextAction(
    researchId: string,
    candidates: ResearchActionCandidate[],
    options: Parameters<typeof selectNextResearchAction>[1] = {},
  ): ResearchActionCandidate | undefined {
    this.getResearch(researchId);
    return selectNextResearchAction(candidates, options);
  }

  scoreAction(candidate: ResearchActionCandidate, weights?: Parameters<typeof scoreResearchAction>[1]) {
    return scoreResearchAction(candidate, weights);
  }

  async executeAction(researchId: string, actionId: string, signal?: AbortSignal): Promise<ResearchExecutionResult> {
    let graph = this.getResearch(researchId);
    const action = graph.nodes.find((node): node is ResearchActionNode => node.id === actionId && node.kind === "action");
    if (!action) throw new Error(`Unknown research action: ${actionId}`);
    const safetyClass = action.intervention?.safetyClass ?? "read-only";
    if (action.status === "proposed") {
      const requiresHumanApproval = safetyClass === "external-effect" || safetyClass === "irreversible";
      if (requiresHumanApproval) {
        const execution: ResearchActionExecution = {
          status: "inconclusive",
          summary: "Research action requires explicit human approval before execution.",
        };
        return { research: graph, execution };
      }
      // Safe local/retrieval work can advance through the checkpoint without
      // blocking the autonomous loop; external effects cannot.
      graph = updateResearchAction(graph, action.id, { status: "approved" }, { actor: this.actor, at: this.now() });
      this.commit(graph);
    } else if (action.status !== "approved") {
      const execution: ResearchActionExecution = {
        status: "failed",
        summary: `Research action is not executable from status ${action.status}.`,
      };
      return { research: graph, execution };
    }
    const adapter = this.findAdapter(action);
    if (!adapter) {
      const execution: ResearchActionExecution = {
        status: "failed",
        summary: `No adapter supports action ${action.actionType}${action.adapter ? ` (${action.adapter})` : ""}`,
      };
      graph = updateResearchAction(graph, action.id, { status: "failed" }, { actor: this.actor, at: this.now() });
      this.commit(graph);
      return { research: graph, execution };
    }

    graph = updateResearchAction(graph, action.id, { status: "running", adapter: adapter.id }, { actor: this.actor, at: this.now() });
    this.commit(graph);
    const producedNodeIds: string[] = [];
    try {
      const execution = await adapter.execute({ graph, action, signal });
      validateAdapterExecution(graph, action, adapter, execution);
      for (const artifact of execution.artifacts ?? []) {
        graph = addResearchNode(graph, artifact, { actor: this.actor, at: this.now() });
        graph = addResearchEdge(graph, {
          source: action.id,
          target: artifact.id,
          kind: "produces",
          branchId: action.branchId,
          at: this.now(),
        }, { actor: this.actor });
        producedNodeIds.push(artifact.id);
      }
      for (const evidence of execution.evidence ?? []) {
        graph = addResearchNode(graph, evidence, { actor: this.actor, at: this.now() });
        graph = addResearchEdge(graph, {
          source: action.id,
          target: evidence.id,
          kind: "produces",
          branchId: action.branchId,
          at: this.now(),
        }, { actor: this.actor });
        producedNodeIds.push(evidence.id);
        for (const claimId of action.testsClaimIds) {
          graph = addResearchEdge(graph, {
            source: evidence.id,
            target: claimId,
            kind: evidence.relation,
            branchId: action.branchId,
            at: this.now(),
          }, { actor: this.actor });
        }
      }
      const replay = execution.replay
        ? { ...execution.replay, hash: stableHash(execution.replay) }
        : undefined;
      graph = updateResearchAction(graph, action.id, {
        status: execution.status,
        producedNodeIds,
        ...(replay ? { replay } : {}),
      }, { actor: this.actor, at: this.now() });
      this.commit(graph);
      return { research: graph, execution };
    } catch (error) {
      const execution: ResearchActionExecution = {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
      };
      graph = updateResearchAction(graph, action.id, {
        status: "failed",
        producedNodeIds,
      }, { actor: this.actor, at: this.now() });
      this.commit(graph);
      return { research: graph, execution };
    }
  }

  compileReport(researchId: string): ResearchReport {
    return compileResearchReport(this.getResearch(researchId), this.now());
  }

  compileInnoClawReport(researchId: string, generatedBy = "cebro:innoclaw-template"): string {
    return renderInnoClawResearchReport(this.compileReport(researchId), { generatedBy });
  }

  async askAgent(
    researchId: string,
    sessionId: string,
    objective: string,
    options: ResearchAgentTurnOptions = {},
  ): Promise<void> {
    if (!this.options.agentRuntime) throw new Error("ResearchRuntime has no AgentRuntime adapter");
    const graph = this.getResearch(researchId);
    const context = {
      researchId: graph.researchId,
      objective: graph.objective,
      activeBranchIds: graph.branches.filter((branch) => branch.status === "active").map((branch) => branch.id),
      claims: graph.nodes.filter((node) => node.kind === "claim").map((node) => ({ id: node.id, statement: node.statement, status: node.status })),
      unresolvedHypotheses: graph.nodes
        .filter((node): node is Extract<ResearchGraph["nodes"][number], { kind: "hypothesis" }> => (
          node.kind === "hypothesis" && (node.status === "open" || node.status === "favoured")
        ))
        .map((node) => ({ id: node.id, statement: node.statement })),
      recentEvents: graph.events.slice(-8).map((event) => ({ type: event.type, branchId: event.branchId, payload: event.payload })),
    };
    const prompt = [
      "You are operating inside the CEBRO discipline-neutral research kernel.",
      "Treat claims as contracts: propose falsifiers, evidence requirements, and a lowest-cost discriminating action.",
      "Do not present speculation, proxy results, or tool intent as evidence.",
      `Research objective: ${objective}`,
      `Current graph context: ${JSON.stringify(context)}`,
      "Return a structured proposal that can be recorded as hypotheses, actions, evidence requirements, or blockers.",
    ].join("\n\n");
    await this.options.agentRuntime.sendPrompt(
      sessionId,
      prompt,
      options.agent,
      options.model,
      options.variant,
      options.language,
    );
  }

  private commit(graph: ResearchGraph): void {
    this.graphs.set(graph.researchId, graph);
    this.options.onGraphChanged?.(graph);
  }

  private findAdapter(action: ResearchActionNode): ResearchActionAdapter | undefined {
    const graph = [...this.graphs.values()].find((candidate) => candidate.nodes.some((node) => node.id === action.id));
    if (!graph) return undefined;
    const safetyClass = action.intervention?.safetyClass ?? "read-only";
    const supports = (adapter: ResearchActionAdapter): boolean => {
      const modeCompatible = graph.modes.includes("hybrid") || adapter.modes.includes("hybrid")
        || adapter.modes.some((mode) => graph.modes.includes(mode));
      if (!adapter.actionTypes.includes(action.actionType) || !modeCompatible) return false;
      if (adapter.capabilities && !adapter.capabilities.safetyClasses.includes(safetyClass)) return false;
      return !adapter.canHandle || adapter.canHandle({ graph, action });
    };
    if (action.adapter) {
      const explicit = this.adapters.get(action.adapter);
      if (explicit && supports(explicit)) return explicit;
      return undefined;
    }
    return [...this.adapters.values()].find(supports);
  }
}
