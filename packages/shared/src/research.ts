/**
 * CEBRO: Causal-Evidence Branching Research OS.
 *
 * This module is deliberately transport- and discipline-neutral. It models a
 * research trajectory as an immutable, branchable graph of claims, hypotheses,
 * actions, evidence and artifacts. Physical experiments, simulations,
 * derivations and speculative arguments enter through the same contracts.
 */

import { stableEventId, stableHash } from "./dft";

export const RESEARCH_GRAPH_SCHEMA_VERSION = 2;
export const RESEARCH_BUNDLE_SCHEMA_VERSION = 2;
export const LEGACY_RESEARCH_GRAPH_SCHEMA_VERSION = 1;
export const LEGACY_RESEARCH_BUNDLE_SCHEMA_VERSION = 1;

export type ResearchMode = "theory" | "computation" | "experiment" | "speculation" | "hybrid";
export type ResearchNodeKind = "claim" | "hypothesis" | "action" | "evidence" | "artifact" | "counterfactual";
export type ResearchClaimStatus = "candidate" | "supported" | "contested" | "rejected" | "retired";
export type ResearchActionType =
  | "retrieve"
  | "observe"
  | "measure"
  | "compute"
  | "derive"
  | "simulate"
  | "challenge"
  | "synthesize"
  | "speculate";
export type ResearchActionStatus = "proposed" | "approved" | "running" | "completed" | "inconclusive" | "failed" | "cancelled";
export type ResearchEvidenceKind =
  | "literature"
  | "observation"
  | "measurement"
  | "simulation"
  | "derivation"
  | "argument"
  | "reproduction"
  | "negative"
  | "artifact";
export type ResearchEvidenceRelation = "supports" | "refutes" | "qualifies" | "inconclusive";
export type ResearchEdgeKind =
  | ResearchEvidenceRelation
  | "tests"
  | "derived-from"
  | "produces"
  | "challenges"
  | "alternative-to"
  | "depends-on"
  | "reproduces"
  | "invalidates"
  | "scopes";
export type ResearchBranchStatus = "active" | "paused" | "merged" | "rejected";
export type ResearchEpistemicLevel =
  | "observation"
  | "measurement"
  | "literature"
  | "derivation"
  | "simulation"
  | "inference"
  | "hypothesis"
  | "speculation";
export type ResearchSafetyClass = "read-only" | "reversible" | "external-effect" | "irreversible";
export type ResearchReplayability = "deterministic" | "seeded" | "stochastic" | "manual" | "not-replayable";
export type ResearchRole = "researcher" | "skeptic" | "librarian" | "reproducer" | "scribe" | (string & {});

export interface ResearchPrediction {
  id: string;
  hypothesisId: string;
  expected: string;
  probability?: number;
  metric?: string;
}

export interface ResearchInterventionProtocol {
  preconditions: string[];
  target?: string;
  controls: string[];
  predictions: ResearchPrediction[];
  falsifiers: string[];
  rollbackPlan?: string;
  sideEffects?: string[];
  safetyClass: ResearchSafetyClass;
  replayability: ResearchReplayability;
}

export interface ResearchBeliefState {
  prior: number;
  posterior: number;
  updateCount: number;
  lastEvidenceId?: string;
  lastUpdatedAt: number;
  calibrationLoss?: number;
}

export interface ResearchEvidenceRequirement {
  id: string;
  description: string;
  kind?: ResearchEvidenceKind;
  minimumStrength?: number;
  minimumEpistemicLevel?: ResearchEpistemicLevel;
  required?: boolean;
}

export interface ResearchClaimContract {
  requiredEvidence: ResearchEvidenceRequirement[];
  /** Human-readable falsifiers; actions can later link to these conditions. */
  falsifiers: string[];
  /** A claim is not ready unless at least one challenge has been checked. */
  requireChallenge: boolean;
  /** 0..1 threshold for evidence coverage before compilation. */
  minimumCoverage: number;
  /** Conservative evidence-family requirement; defaults to one group. */
  minimumIndependentGroups?: number;
  /** Do not allow an inference or speculation to satisfy a stronger claim. */
  minimumEpistemicLevel?: ResearchEpistemicLevel;
}

export interface ResearchNodeBase {
  id: string;
  kind: ResearchNodeKind;
  label: string;
  branchId: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchClaimNode extends ResearchNodeBase {
  kind: "claim";
  statement: string;
  scope: string;
  status: ResearchClaimStatus;
  contract: ResearchClaimContract;
}

export interface ResearchHypothesisNode extends ResearchNodeBase {
  kind: "hypothesis";
  statement: string;
  alternatives?: string[];
  status: "open" | "favoured" | "rejected" | "merged";
  belief?: ResearchBeliefState;
}

export interface ResearchActionCost {
  /** Normalized cost used by the scheduler. Keep raw units in metadata. */
  normalized: number;
  tokens?: number;
  computeMinutes?: number;
  wallMinutes?: number;
  money?: number;
}

export interface ResearchActionNode extends ResearchNodeBase {
  kind: "action";
  actionType: ResearchActionType;
  objective: string;
  status: ResearchActionStatus;
  expectedInformationGain: number;
  expectedConfidenceGain: number;
  cost: ResearchActionCost;
  risk: number;
  reversibility: number;
  testsClaimIds: string[];
  producedNodeIds: string[];
  adapter?: string;
  intervention?: ResearchInterventionProtocol;
  replay?: ResearchReplayRecipe;
}

export interface ResearchReplayRecipe {
  adapterId: string;
  inputNodeIds: string[];
  command?: string;
  environment?: string;
  replayability: ResearchReplayability;
  hash: string;
}

export interface ResearchEvidenceNode extends ResearchNodeBase {
  kind: "evidence";
  evidenceKind: ResearchEvidenceKind;
  summary: string;
  relation: ResearchEvidenceRelation;
  strength: number;
  uncertainty?: string;
  sourceRefs: string[];
  artifactIds: string[];
  /** A deterministic identity of the source, measurement, derivation or argument. */
  contentHash?: string;
  independent?: boolean;
  epistemicLevel?: ResearchEpistemicLevel;
  sourceFamily?: string;
  modelFamily?: string;
  codeFamily?: string;
  sharedAssumptions?: string[];
  prediction?: {
    predicted: number;
    observed: number;
    loss?: number;
  };
}

export interface ResearchArtifactNode extends ResearchNodeBase {
  kind: "artifact";
  artifactType: "data" | "code" | "figure" | "report" | "notebook" | "model" | "other";
  locator: string;
  contentHash: string;
  reproducibility?: {
    inputs: string[];
    environment?: string;
    command?: string;
  };
}

export interface ResearchCounterfactualNode extends ResearchNodeBase {
  kind: "counterfactual";
  premise: string;
  predictedObservation: string;
  falsifier: string;
  status: "proposed" | "checked" | "failed" | "inconclusive";
}

export type ResearchNode =
  | ResearchClaimNode
  | ResearchHypothesisNode
  | ResearchActionNode
  | ResearchEvidenceNode
  | ResearchArtifactNode
  | ResearchCounterfactualNode;

export interface ResearchEdge {
  id: string;
  source: string;
  target: string;
  kind: ResearchEdgeKind;
  branchId: string;
  note?: string;
  createdAt: number;
  hash: string;
}

export interface ResearchBranch {
  id: string;
  parentBranchId?: string;
  label: string;
  role?: ResearchRole;
  status: ResearchBranchStatus;
  hypothesisIds: string[];
  createdAt: number;
  mergedInto?: string;
}

export type ResearchEventType =
  | "research.created"
  | "node.added"
  | "edge.added"
  | "branch.created"
  | "branch.updated"
  | "claim.updated"
  | "action.updated"
  | "branch.merged"
  | "belief.updated"
  | "report.compiled";

export interface ResearchEvent {
  id: string;
  type: ResearchEventType;
  at: number;
  actor: string;
  branchId: string;
  payload: Record<string, unknown>;
  hash: string;
}

export interface ResearchGraph {
  schemaVersion: number;
  researchId: string;
  title: string;
  objective: string;
  modes: ResearchMode[];
  rootClaimId: string;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  branches: ResearchBranch[];
  events: ResearchEvent[];
  createdAt: number;
  updatedAt: number;
  hash: string;
  eventId: string;
}

export interface ResearchActionCandidate {
  id: string;
  actionType: ResearchActionType;
  objective: string;
  expectedInformationGain: number;
  expectedConfidenceGain: number;
  cost: ResearchActionCost;
  risk?: number;
  reversibility?: number;
  testsClaimIds?: string[];
  branchId?: string;
  adapter?: string;
  intervention?: ResearchInterventionProtocol;
  metadata?: Record<string, unknown>;
}

export interface ResearchSchedulerWeights {
  informationGain: number;
  confidenceGain: number;
  risk: number;
  irreversibility: number;
}

export interface ResearchActionScore {
  candidateId: string;
  score: number;
  benefit: number;
  denominator: number;
}

export interface ResearchClaimReadiness {
  claimId: string;
  coverage: number;
  requiredEvidence: Array<{
    id: string;
    satisfied: boolean;
    matchingEvidenceIds: string[];
  }>;
  challengeChecked: boolean;
  independence: ResearchEvidenceIndependence;
  epistemicBlockers: string[];
  ready: boolean;
  blockers: string[];
}

export interface ResearchEvidenceIndependenceGroup {
  key: string;
  evidenceIds: string[];
  sharedFactors: string[];
}

export interface ResearchEvidenceIndependence {
  evidenceCount: number;
  independentGroups: number;
  effectiveEvidenceCount: number;
  groups: ResearchEvidenceIndependenceGroup[];
  warnings: string[];
}

export interface ResearchBeliefUpdateInput {
  evidenceId: string;
  likelihoodUnderHypothesis: number;
  likelihoodUnderAlternative: number;
  observedProbability?: number;
}

export interface ResearchReportClaim {
  claimId: string;
  statement: string;
  scope: string;
  status: ResearchClaimStatus;
  readiness: ResearchClaimReadiness;
  independence: ResearchEvidenceIndependence;
  evidenceIds: string[];
}

export interface ResearchReport {
  researchId: string;
  title: string;
  objective: string;
  generatedAt: number;
  claims: ResearchReportClaim[];
  unresolvedHypotheses: string[];
  failedActions: string[];
  artifactIds: string[];
  beliefStates: Array<{ hypothesisId: string; belief: ResearchBeliefState }>;
  diagnostics: string[];
  branchSummary: Array<Pick<ResearchBranch, "id" | "label" | "status" | "parentBranchId">>;
  graphHash: string;
}

export interface ResearchAdapterRequirement {
  actionType: ResearchActionType;
  adapter?: string;
}

export interface PortableResearchBundle {
  schemaVersion: number;
  graph: ResearchGraph;
  requiredModes: ResearchMode[];
  requiredAdapters: ResearchAdapterRequirement[];
  exportedAt: number;
  hash: string;
}

export interface ResearchValidationResult {
  valid: boolean;
  errors: string[];
}

const DEFAULT_SCHEDULER_WEIGHTS: ResearchSchedulerWeights = {
  informationGain: 1,
  confidenceGain: 0.6,
  risk: 0.45,
  irreversibility: 0.35,
};

const EPISTEMIC_ORDER: ResearchEpistemicLevel[] = [
  "speculation",
  "hypothesis",
  "inference",
  "literature",
  "simulation",
  "derivation",
  "observation",
  "measurement",
];

export function epistemicLevelRank(level: ResearchEpistemicLevel): number {
  return EPISTEMIC_ORDER.indexOf(level);
}

export function epistemicLevelForEvidenceKind(kind: ResearchEvidenceKind): ResearchEpistemicLevel {
  switch (kind) {
    case "observation": return "observation";
    case "measurement": return "measurement";
    case "literature": return "literature";
    case "derivation": return "derivation";
    case "simulation": return "simulation";
    case "argument": return "speculation";
    case "negative": return "observation";
    case "reproduction": return "measurement";
    case "artifact": return "inference";
  }
}

function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number between 0 and 1`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must not be empty`);
}

function validatePrediction(prediction: ResearchPrediction): void {
  assertNonEmpty(prediction.id, "prediction id");
  assertNonEmpty(prediction.hypothesisId, "prediction hypothesisId");
  assertNonEmpty(prediction.expected, "prediction expected");
  if (prediction.probability !== undefined) assertUnitInterval(prediction.probability, "prediction probability");
}

function validateIntervention(protocol: ResearchInterventionProtocol): void {
  if (!Array.isArray(protocol.preconditions) || !Array.isArray(protocol.controls)
    || !Array.isArray(protocol.predictions) || !Array.isArray(protocol.falsifiers)) {
    throw new Error("intervention protocol arrays are required");
  }
  protocol.predictions.forEach(validatePrediction);
  if (protocol.safetyClass === "external-effect" || protocol.safetyClass === "irreversible") {
    if (!protocol.rollbackPlan && protocol.safetyClass === "external-effect") {
      throw new Error("external-effect interventions require a rollbackPlan or explicit compensation");
    }
  }
}

function branchExists(graph: ResearchGraph, branchId: string): boolean {
  return graph.branches.some((branch) => branch.id === branchId);
}

function nodeExists(graph: ResearchGraph, nodeId: string): boolean {
  return graph.nodes.some((node) => node.id === nodeId);
}

function graphBase(graph: ResearchGraph): Omit<ResearchGraph, "hash" | "eventId"> {
  const { hash: _hash, eventId: _eventId, ...base } = graph;
  return base;
}

function finalizeGraph(base: Omit<ResearchGraph, "hash" | "eventId">): ResearchGraph {
  const hash = stableHash(base);
  return {
    ...base,
    hash,
    eventId: stableEventId("research-graph", { researchId: base.researchId, hash }),
  };
}

function appendEvent(
  graph: ResearchGraph,
  type: ResearchEventType,
  branchId: string,
  actor: string,
  payload: Record<string, unknown>,
  at: number,
): ResearchGraph {
  assertNonEmpty(actor, "event actor");
  if (!branchExists(graph, branchId)) throw new Error(`Unknown research branch: ${branchId}`);
  const eventBase = {
    researchId: graph.researchId,
    sequence: graph.events.length,
    type,
    branchId,
    actor,
    payload,
    at,
  };
  const event: ResearchEvent = {
    id: stableEventId("research-event", eventBase),
    type,
    at,
    actor,
    branchId,
    payload,
    hash: stableHash(eventBase),
  };
  return finalizeGraph({
    ...graphBase(graph),
    events: [...graph.events, event],
    updatedAt: at,
  });
}

export function createResearchGraph(input: {
  researchId: string;
  title: string;
  objective: string;
  modes?: ResearchMode[];
  now?: number;
  actor?: string;
  rootClaim?: Partial<Pick<ResearchClaimNode, "label" | "statement" | "scope" | "status" | "contract" | "metadata">>;
}): ResearchGraph {
  assertNonEmpty(input.researchId, "researchId");
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.objective, "objective");
  const now = input.now ?? Date.now();
  const actor = input.actor ?? "system:research-kernel";
  const branchId = "branch:main";
  const rootClaimId = `claim:${input.researchId}:root`;
  const rootClaim: ResearchClaimNode = {
    id: rootClaimId,
    kind: "claim",
    label: input.rootClaim?.label ?? "Research objective",
    branchId,
    createdAt: now,
    statement: input.rootClaim?.statement ?? input.objective,
    scope: input.rootClaim?.scope ?? "research scope is defined by the objective",
    status: input.rootClaim?.status ?? "candidate",
    contract: input.rootClaim?.contract ?? {
      requiredEvidence: [{
        id: "traceable-evidence",
        description: "At least one traceable, independently attributable evidence record",
        minimumStrength: 0.5,
        required: true,
      }],
      falsifiers: ["A reproducible observation contradicts the research objective"],
      requireChallenge: true,
      minimumCoverage: 1,
      minimumIndependentGroups: 1,
    },
    ...(input.rootClaim?.metadata ? { metadata: input.rootClaim.metadata } : {}),
  };
  const base: Omit<ResearchGraph, "hash" | "eventId"> = {
    schemaVersion: RESEARCH_GRAPH_SCHEMA_VERSION,
    researchId: input.researchId,
    title: input.title,
    objective: input.objective,
    modes: input.modes?.length ? [...new Set(input.modes)] : ["hybrid"],
    rootClaimId,
    nodes: [rootClaim],
    edges: [],
    branches: [{ id: branchId, label: "Main research line", status: "active", hypothesisIds: [], createdAt: now }],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  const graph = finalizeGraph(base);
  return appendEvent(graph, "research.created", branchId, actor, {
    title: input.title,
    objective: input.objective,
    modes: graph.modes,
    rootClaimId,
  }, now);
}

export function addResearchNode(graph: ResearchGraph, node: ResearchNode, options: { actor?: string; at?: number } = {}): ResearchGraph {
  if (nodeExists(graph, node.id)) throw new Error(`Research node already exists: ${node.id}`);
  if (!branchExists(graph, node.branchId)) throw new Error(`Unknown research branch: ${node.branchId}`);
  assertNonEmpty(node.id, "node id");
  assertNonEmpty(node.label, "node label");
  const normalizedNode: ResearchNode = node.kind === "evidence"
    ? { ...node, epistemicLevel: node.epistemicLevel ?? epistemicLevelForEvidenceKind(node.evidenceKind) }
    : node;
  if (normalizedNode.kind === "claim") {
    assertUnitInterval(normalizedNode.contract.minimumCoverage, "claim minimumCoverage");
    normalizedNode.contract.requiredEvidence.forEach((requirement) => assertNonEmpty(requirement.id, "evidence requirement id"));
    if (normalizedNode.contract.minimumIndependentGroups !== undefined) {
      if (!Number.isInteger(normalizedNode.contract.minimumIndependentGroups) || normalizedNode.contract.minimumIndependentGroups < 1) {
        throw new Error("claim minimumIndependentGroups must be a positive integer");
      }
    }
    if (normalizedNode.contract.minimumEpistemicLevel) epistemicLevelRank(normalizedNode.contract.minimumEpistemicLevel);
  }
  if (normalizedNode.kind === "action") validateActionNode(normalizedNode);
  if (normalizedNode.kind === "evidence") validateEvidenceNode(normalizedNode);
  if (normalizedNode.kind === "artifact") assertNonEmpty(normalizedNode.contentHash, "artifact contentHash");
  const at = options.at ?? normalizedNode.createdAt;
  const next = finalizeGraph({
    ...graphBase(graph),
    nodes: [...graph.nodes, normalizedNode],
    updatedAt: at,
  });
  return appendEvent(next, "node.added", normalizedNode.branchId, options.actor ?? "system:research-kernel", {
    nodeId: normalizedNode.id,
    nodeKind: normalizedNode.kind,
  }, at);
}

export function addResearchEdge(
  graph: ResearchGraph,
  input: { source: string; target: string; kind: ResearchEdgeKind; branchId?: string; note?: string; at?: number },
  options: { actor?: string } = {},
): ResearchGraph {
  if (!nodeExists(graph, input.source) || !nodeExists(graph, input.target)) {
    throw new Error("Research edges must connect existing nodes");
  }
  const source = graph.nodes.find((node) => node.id === input.source)!;
  const target = graph.nodes.find((node) => node.id === input.target)!;
  const branchId = input.branchId ?? source.branchId;
  if (!branchExists(graph, branchId)) throw new Error(`Unknown research branch: ${branchId}`);
  if (source.branchId !== branchId || target.branchId !== branchId) {
    throw new Error("Research edges cannot cross branches without an explicit merge");
  }
  if (graph.edges.some((edge) => edge.source === input.source && edge.target === input.target && edge.kind === input.kind)) {
    return graph;
  }
  const at = input.at ?? Date.now();
  const edgeBase = {
    source: input.source,
    target: input.target,
    kind: input.kind,
    branchId,
    ...(input.note ? { note: input.note } : {}),
    createdAt: at,
  };
  const edge: ResearchEdge = {
    ...edgeBase,
    id: stableEventId("research-edge", edgeBase),
    hash: stableHash(edgeBase),
  };
  const next = finalizeGraph({
    ...graphBase(graph),
    edges: [...graph.edges, edge],
    updatedAt: at,
  });
  return appendEvent(next, "edge.added", branchId, options.actor ?? "system:research-kernel", {
    edgeId: edge.id,
    source: input.source,
    target: input.target,
    kind: input.kind,
  }, at);
}

export function createResearchBranch(
  graph: ResearchGraph,
  input: { branchId: string; label: string; role?: ResearchRole; parentBranchId?: string; hypothesisIds?: string[]; now?: number },
  options: { actor?: string } = {},
): ResearchGraph {
  assertNonEmpty(input.branchId, "branchId");
  assertNonEmpty(input.label, "branch label");
  if (graph.branches.some((branch) => branch.id === input.branchId)) throw new Error(`Research branch already exists: ${input.branchId}`);
  const parentBranchId = input.parentBranchId ?? "branch:main";
  if (!branchExists(graph, parentBranchId)) throw new Error(`Unknown parent research branch: ${parentBranchId}`);
  const hypothesisIds = input.hypothesisIds ?? [];
  if (hypothesisIds.some((id) => !graph.nodes.some((node) => node.id === id && node.kind === "hypothesis"))) {
    throw new Error("Research branches may only reference existing hypothesis nodes");
  }
  const now = input.now ?? Date.now();
  const branch: ResearchBranch = {
    id: input.branchId,
    parentBranchId,
    label: input.label,
    ...(input.role ? { role: input.role } : {}),
    status: "active",
    hypothesisIds: [...hypothesisIds],
    createdAt: now,
  };
  const next = finalizeGraph({ ...graphBase(graph), branches: [...graph.branches, branch], updatedAt: now });
  return appendEvent(next, "branch.created", input.branchId, options.actor ?? "system:research-kernel", {
    parentBranchId,
    label: input.label,
    ...(input.role ? { role: input.role } : {}),
    hypothesisIds,
  }, now);
}

/** Explicitly close a role/research branch into another branch. The operation
 * is represented as a durable event; no cross-branch edge is created
 * implicitly, so callers must still choose which evidence to import or cite. */
export function mergeResearchBranch(
  graph: ResearchGraph,
  input: { branchId: string; targetBranchId: string; note?: string; now?: number },
  options: { actor?: string } = {},
): ResearchGraph {
  if (input.branchId === input.targetBranchId) throw new Error("A research branch cannot merge into itself");
  const source = graph.branches.find((branch) => branch.id === input.branchId);
  const target = graph.branches.find((branch) => branch.id === input.targetBranchId);
  if (!source || !target) throw new Error("Unknown research branch merge target");
  if (source.status === "merged") throw new Error(`Research branch is already merged: ${source.id}`);
  const at = input.now ?? Date.now();
  const updated = updateResearchBranch(graph, source.id, {
    status: "merged",
    mergedInto: target.id,
  }, { actor: options.actor, at });
  return appendEvent(updated, "branch.merged", source.id, options.actor ?? "system:research-kernel", {
    targetBranchId: target.id,
    ...(input.note ? { note: input.note } : {}),
  }, at);
}

export function updateResearchBranch(
  graph: ResearchGraph,
  branchId: string,
  patch: { status?: ResearchBranchStatus; mergedInto?: string },
  options: { actor?: string; at?: number } = {},
): ResearchGraph {
  const branch = graph.branches.find((candidate) => candidate.id === branchId);
  if (!branch) throw new Error(`Unknown research branch: ${branchId}`);
  if (patch.mergedInto !== undefined && !branchExists(graph, patch.mergedInto)) {
    throw new Error(`Unknown merge target branch: ${patch.mergedInto}`);
  }
  const at = options.at ?? Date.now();
  const branches = graph.branches.map((candidate) => candidate.id === branchId ? { ...candidate, ...patch } : candidate);
  const next = finalizeGraph({ ...graphBase(graph), branches, updatedAt: at });
  return appendEvent(next, "branch.updated", branchId, options.actor ?? "system:research-kernel", patch, at);
}

export function updateResearchAction(
  graph: ResearchGraph,
  actionId: string,
  patch: Partial<Pick<ResearchActionNode, "status" | "producedNodeIds" | "objective" | "adapter" | "intervention" | "replay" | "metadata">>,
  options: { actor?: string; at?: number } = {},
): ResearchGraph {
  const action = graph.nodes.find((node): node is ResearchActionNode => node.id === actionId && node.kind === "action");
  if (!action) throw new Error(`Unknown action node: ${actionId}`);
  if (patch.producedNodeIds) {
    const unique = new Set(patch.producedNodeIds);
    if (unique.size !== patch.producedNodeIds.length) throw new Error("Action producedNodeIds must be unique");
  }
  const at = options.at ?? Date.now();
  const nodes: ResearchNode[] = graph.nodes.map((node) => (
    node.id === actionId && node.kind === "action" ? { ...node, ...patch } : node
  ));
  const next = finalizeGraph({ ...graphBase(graph), nodes, updatedAt: at });
  return appendEvent(next, "action.updated", action.branchId, options.actor ?? "system:research-kernel", {
    actionId,
    ...patch,
  }, at);
}

export function updateResearchClaim(
  graph: ResearchGraph,
  claimId: string,
  patch: Partial<Pick<ResearchClaimNode, "status" | "scope" | "statement" | "contract">>,
  options: { actor?: string; at?: number } = {},
): ResearchGraph {
  const claim = graph.nodes.find((node): node is ResearchClaimNode => node.id === claimId && node.kind === "claim");
  if (!claim) throw new Error(`Unknown claim node: ${claimId}`);
  if (patch.contract) assertUnitInterval(patch.contract.minimumCoverage, "claim minimumCoverage");
  const at = options.at ?? Date.now();
  const nodes: ResearchNode[] = graph.nodes.map((node) => (
    node.id === claimId && node.kind === "claim" ? { ...node, ...patch } : node
  ));
  const next = finalizeGraph({ ...graphBase(graph), nodes, updatedAt: at });
  return appendEvent(next, "claim.updated", claim.branchId, options.actor ?? "system:research-kernel", {
    claimId,
    ...patch,
  }, at);
}

export function scoreResearchAction(
  candidate: ResearchActionCandidate,
  weights: Partial<ResearchSchedulerWeights> = {},
): ResearchActionScore {
  assertUnitInterval(candidate.expectedInformationGain, "expectedInformationGain");
  assertUnitInterval(candidate.expectedConfidenceGain, "expectedConfidenceGain");
  assertUnitInterval(candidate.risk ?? 0, "risk");
  assertUnitInterval(candidate.reversibility ?? 1, "reversibility");
  assertNonNegative(candidate.cost.normalized, "action cost");
  if (candidate.intervention) validateIntervention(candidate.intervention);
  const resolved = { ...DEFAULT_SCHEDULER_WEIGHTS, ...weights };
  const benefit = resolved.informationGain * candidate.expectedInformationGain
    + resolved.confidenceGain * candidate.expectedConfidenceGain;
  const denominator = Math.max(0.001, candidate.cost.normalized)
    * (1 + resolved.risk * (candidate.risk ?? 0) + resolved.irreversibility * (1 - (candidate.reversibility ?? 1)));
  return { candidateId: candidate.id, score: benefit / denominator, benefit, denominator };
}

export function selectNextResearchAction(
  candidates: ResearchActionCandidate[],
  options: { weights?: Partial<ResearchSchedulerWeights>; branchId?: string; maxCost?: number } = {},
): ResearchActionCandidate | undefined {
  const eligible = candidates
    .filter((candidate) => options.branchId === undefined || candidate.branchId === options.branchId)
    .filter((candidate) => options.maxCost === undefined || candidate.cost.normalized <= options.maxCost)
    .map((candidate, index) => ({ candidate, score: scoreResearchAction(candidate, options.weights), index }))
    .sort((a, b) => b.score.score - a.score.score || a.score.denominator - b.score.denominator || a.index - b.index);
  return eligible[0]?.candidate;
}

function validateActionNode(node: ResearchActionNode): void {
  assertUnitInterval(node.expectedInformationGain, "action expectedInformationGain");
  assertUnitInterval(node.expectedConfidenceGain, "action expectedConfidenceGain");
  assertUnitInterval(node.risk, "action risk");
  assertUnitInterval(node.reversibility, "action reversibility");
  assertNonNegative(node.cost.normalized, "action cost");
  if (node.intervention) validateIntervention(node.intervention);
}

function validateEvidenceNode(node: ResearchEvidenceNode): void {
  assertUnitInterval(node.strength, "evidence strength");
  assertNonEmpty(node.summary, "evidence summary");
  if (node.sourceRefs.length === 0 && node.artifactIds.length === 0) {
    throw new Error("Evidence must have at least one source reference or artifact");
  }
  if (node.epistemicLevel) epistemicLevelRank(node.epistemicLevel);
  if (node.prediction) {
    assertUnitInterval(node.prediction.predicted, "prediction predicted");
    assertUnitInterval(node.prediction.observed, "prediction observed");
    const loss = node.prediction.loss ?? (node.prediction.predicted - node.prediction.observed) ** 2;
    assertNonNegative(loss, "prediction loss");
  }
}

export function predictionLoss(predicted: number, observed: number): number {
  assertUnitInterval(predicted, "prediction predicted");
  assertUnitInterval(observed, "prediction observed");
  return (predicted - observed) ** 2;
}

export function assessEvidenceIndependence(graph: ResearchGraph, claimId: string): ResearchEvidenceIndependence {
  const evidence = graph.edges
    .filter((edge) => edge.target === claimId && edge.kind === "supports")
    .map((edge) => graph.nodes.find((node): node is ResearchEvidenceNode => node.id === edge.source && node.kind === "evidence"))
    .filter((node): node is ResearchEvidenceNode => !!node);
  const factorsFor = (item: ResearchEvidenceNode): string[] => [
    item.sourceFamily ? `source:${item.sourceFamily}` : item.sourceRefs.length ? `refs:${[...item.sourceRefs].sort().join(",")}` : undefined,
    item.modelFamily ? `model:${item.modelFamily}` : undefined,
    item.codeFamily ? `code:${item.codeFamily}` : undefined,
    item.sharedAssumptions?.length ? `assumptions:${[...item.sharedAssumptions].sort().join(",")}` : undefined,
    item.independent === false ? "independence:explicitly-dependent" : undefined,
  ].filter((factor): factor is string => !!factor);
  const factors = evidence.map(factorsFor);
  const parent = evidence.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < factors.length; left += 1) {
    for (let right = left + 1; right < factors.length; right += 1) {
      if (factors[left].some((factor) => factors[right].includes(factor))) union(left, right);
    }
  }
  const grouped = new Map<number, number[]>();
  evidence.forEach((_, index) => {
    const root = find(index);
    const members = grouped.get(root) ?? [];
    members.push(index);
    grouped.set(root, members);
  });
  const groupList = [...grouped.values()].map((members) => {
    const evidenceIds = members.map((index) => evidence[index].id);
    const factorCounts = new Map<string, number>();
    members.forEach((index) => factors[index].forEach((factor) => factorCounts.set(factor, (factorCounts.get(factor) ?? 0) + 1)));
    const sharedFactors = [...factorCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([factor]) => factor)
      .sort();
    const key = sharedFactors.length ? sharedFactors.join("|") : `independent:${evidenceIds.slice().sort().join(",")}`;
    return { key, evidenceIds, sharedFactors };
  });
  const warnings = groupList
    .filter((group) => group.evidenceIds.length > 1)
    .map((group) => `evidence group ${group.key} contains ${group.evidenceIds.length} dependent records`);
  if (evidence.some((item) => item.independent === false)) warnings.push("one or more evidence records are explicitly marked non-independent");
  const independentGroups = [...grouped.values()]
    .filter((members) => members.some((index) => evidence[index].independent !== false))
    .length;
  return {
    evidenceCount: evidence.length,
    independentGroups,
    effectiveEvidenceCount: independentGroups,
    groups: groupList,
    warnings,
  };
}

export function updateResearchBelief(
  graph: ResearchGraph,
  hypothesisId: string,
  input: ResearchBeliefUpdateInput,
  options: { actor?: string; at?: number; prior?: number } = {},
): ResearchGraph {
  const hypothesis = graph.nodes.find((node): node is ResearchHypothesisNode => node.id === hypothesisId && node.kind === "hypothesis");
  if (!hypothesis) throw new Error(`Unknown hypothesis node: ${hypothesisId}`);
  const evidence = graph.nodes.find((node): node is ResearchEvidenceNode => node.id === input.evidenceId && node.kind === "evidence");
  if (!evidence) throw new Error(`Unknown evidence node: ${input.evidenceId}`);
  if (hypothesis.branchId !== evidence.branchId) throw new Error("belief updates cannot cross research branches");
  assertUnitInterval(input.likelihoodUnderHypothesis, "likelihoodUnderHypothesis");
  assertUnitInterval(input.likelihoodUnderAlternative, "likelihoodUnderAlternative");
  if (input.likelihoodUnderHypothesis === 0 && input.likelihoodUnderAlternative === 0) {
    throw new Error("at least one likelihood must be positive");
  }
  const previous = hypothesis.belief;
  const prior = previous?.posterior ?? options.prior ?? 0.5;
  assertUnitInterval(prior, "belief prior");
  const numerator = prior * input.likelihoodUnderHypothesis;
  const denominator = numerator + (1 - prior) * input.likelihoodUnderAlternative;
  const posterior = denominator === 0 ? prior : numerator / denominator;
  const at = options.at ?? Date.now();
  const calibrationLoss = input.observedProbability === undefined
    ? evidence.prediction?.loss
    : predictionLoss(previous?.posterior ?? prior, input.observedProbability);
  const belief: ResearchBeliefState = {
    prior,
    posterior,
    updateCount: (previous?.updateCount ?? 0) + 1,
    lastEvidenceId: input.evidenceId,
    lastUpdatedAt: at,
    ...(calibrationLoss === undefined ? {} : { calibrationLoss }),
  };
  const nodes: ResearchNode[] = graph.nodes.map((node) => (
    node.id === hypothesisId && node.kind === "hypothesis" ? { ...node, belief } : node
  ));
  const next = finalizeGraph({ ...graphBase(graph), nodes, updatedAt: at });
  return appendEvent(next, "belief.updated", hypothesis.branchId, options.actor ?? "system:research-kernel", {
    hypothesisId,
    evidenceId: input.evidenceId,
    prior,
    posterior,
    likelihoodUnderHypothesis: input.likelihoodUnderHypothesis,
    likelihoodUnderAlternative: input.likelihoodUnderAlternative,
  }, at);
}

export function evaluateClaimReadiness(graph: ResearchGraph, claimId: string): ResearchClaimReadiness {
  const claim = graph.nodes.find((node): node is ResearchClaimNode => node.id === claimId && node.kind === "claim");
  if (!claim) throw new Error(`Unknown claim node: ${claimId}`);
  const supportEvidence = graph.edges
    .filter((edge) => edge.target === claimId && edge.kind === "supports")
    .map((edge) => graph.nodes.find((node): node is ResearchEvidenceNode => node.id === edge.source && node.kind === "evidence"))
    .filter((node): node is ResearchEvidenceNode => !!node);
  const minimumClaimLevel = claim.contract.minimumEpistemicLevel;
  const epistemicBlockers: string[] = [];
  const requiredEvidence = claim.contract.requiredEvidence.map((requirement) => {
    const candidates = supportEvidence.filter((evidence) => evidence.relation === "supports"
      && (requirement.kind === undefined || evidence.evidenceKind === requirement.kind)
      && evidence.strength >= (requirement.minimumStrength ?? 0));
    const matchingEvidenceIds = candidates
      .filter((evidence) => {
        const level = evidence.epistemicLevel ?? epistemicLevelForEvidenceKind(evidence.evidenceKind);
        const minimumLevel = requirement.minimumEpistemicLevel ?? minimumClaimLevel;
        return minimumLevel === undefined || epistemicLevelRank(level) >= epistemicLevelRank(minimumLevel);
      })
      .map((evidence) => evidence.id);
    const minimumLevel = requirement.minimumEpistemicLevel ?? minimumClaimLevel;
    if (minimumLevel && candidates.length > 0 && matchingEvidenceIds.length === 0) {
      epistemicBlockers.push(`evidence requirement ${requirement.id} is below epistemic level ${minimumLevel}`);
    }
    return { id: requirement.id, satisfied: matchingEvidenceIds.length > 0, matchingEvidenceIds };
  });
  const requiredCount = requiredEvidence.filter((requirement) => {
    const definition = claim.contract.requiredEvidence.find((candidate) => candidate.id === requirement.id);
    return definition?.required !== false;
  }).length;
  const satisfiedCount = requiredEvidence.filter((requirement) => requirement.satisfied).filter((requirement) => {
    const definition = claim.contract.requiredEvidence.find((candidate) => candidate.id === requirement.id);
    return definition?.required !== false;
  }).length;
  const coverage = requiredCount === 0 ? 1 : satisfiedCount / requiredCount;
  const independence = assessEvidenceIndependence(graph, claimId);
  const challengeChecked = graph.edges.some((edge) => edge.target === claimId && edge.kind === "challenges")
    || graph.edges.some((edge) => edge.source === claimId && edge.kind === "challenges");
  const blockers: string[] = [];
  if (coverage < claim.contract.minimumCoverage) blockers.push(`evidence coverage ${coverage.toFixed(3)} is below ${claim.contract.minimumCoverage.toFixed(3)}`);
  const minimumIndependentGroups = claim.contract.minimumIndependentGroups ?? (requiredCount > 0 ? 1 : 0);
  if (independence.independentGroups < minimumIndependentGroups) {
    blockers.push(`independent evidence groups ${independence.independentGroups} is below ${minimumIndependentGroups}`);
  }
  blockers.push(...epistemicBlockers);
  if (claim.contract.requireChallenge && !challengeChecked) blockers.push("no challenge or falsification check is linked");
  if (claim.status === "rejected" || claim.status === "retired") blockers.push(`claim status is ${claim.status}`);
  return {
    claimId,
    coverage,
    requiredEvidence,
    challengeChecked,
    independence,
    epistemicBlockers,
    ready: blockers.length === 0,
    blockers,
  };
}

export function compileResearchReport(graph: ResearchGraph, now = Date.now()): ResearchReport {
  const claims = graph.nodes
    .filter((node): node is ResearchClaimNode => node.kind === "claim")
    .map((claim) => {
      const readiness = evaluateClaimReadiness(graph, claim.id);
      const evidenceIds = graph.edges
        .filter((edge) => edge.target === claim.id && ["supports", "refutes", "qualifies", "inconclusive"].includes(edge.kind))
        .map((edge) => edge.source);
      return {
        claimId: claim.id,
        statement: claim.statement,
        scope: claim.scope,
        status: claim.status,
        readiness,
        independence: readiness.independence,
        evidenceIds,
      };
    });
  const diagnostics = claims.flatMap((claim) => [
    ...claim.readiness.blockers.map((blocker) => `${claim.claimId}: ${blocker}`),
    ...claim.independence.warnings.map((warning) => `${claim.claimId}: ${warning}`),
  ]);
  return {
    researchId: graph.researchId,
    title: graph.title,
    objective: graph.objective,
    generatedAt: now,
    claims,
    unresolvedHypotheses: graph.nodes
      .filter((node): node is ResearchHypothesisNode => node.kind === "hypothesis" && (node.status === "open" || node.status === "favoured"))
      .map((node) => node.id),
    failedActions: graph.nodes
      .filter((node): node is ResearchActionNode => node.kind === "action" && (node.status === "failed" || node.status === "inconclusive"))
      .map((node) => node.id),
    artifactIds: graph.nodes.filter((node): node is ResearchArtifactNode => node.kind === "artifact").map((node) => node.id),
    beliefStates: graph.nodes
      .filter((node): node is ResearchHypothesisNode => node.kind === "hypothesis" && !!node.belief)
      .map((node) => ({ hypothesisId: node.id, belief: node.belief! })),
    diagnostics,
    branchSummary: graph.branches.map(({ id, label, status, parentBranchId }) => ({ id, label, status, parentBranchId })),
    graphHash: graph.hash,
  };
}

export function addResearchEvidence(
  graph: ResearchGraph,
  input: {
    evidence: ResearchEvidenceNode;
    claimId: string;
    relation?: ResearchEvidenceRelation;
    actionId?: string;
    actor?: string;
    at?: number;
  },
): ResearchGraph {
  const relation = input.relation ?? input.evidence.relation;
  const evidence = { ...input.evidence, relation };
  let next = addResearchNode(graph, evidence, { actor: input.actor, at: input.at });
  next = addResearchEdge(next, {
    source: evidence.id,
    target: input.claimId,
    kind: relation,
    branchId: evidence.branchId,
    at: input.at,
  }, { actor: input.actor });
  if (input.actionId) {
    next = addResearchEdge(next, {
      source: input.actionId,
      target: evidence.id,
      kind: "produces",
      branchId: evidence.branchId,
      at: input.at,
    }, { actor: input.actor });
  }
  return next;
}

/** Validate a deserialized graph before any runtime or adapter can use it. */
export function validateResearchGraph(value: unknown): ResearchValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["research graph must be an object"] };
  const graph = value as Partial<ResearchGraph>;
  if (graph.schemaVersion !== RESEARCH_GRAPH_SCHEMA_VERSION && graph.schemaVersion !== LEGACY_RESEARCH_GRAPH_SCHEMA_VERSION) {
    errors.push(`unsupported research graph schema: ${String(graph.schemaVersion)}`);
  }
  if (typeof graph.researchId !== "string" || !graph.researchId.trim()) errors.push("researchId is required");
  if (!Array.isArray(graph.nodes)) errors.push("nodes must be an array");
  if (!Array.isArray(graph.edges)) errors.push("edges must be an array");
  if (!Array.isArray(graph.branches)) errors.push("branches must be an array");
  if (!Array.isArray(graph.events)) errors.push("events must be an array");
  if (errors.length > 0) return { valid: false, errors };

  const nodes = graph.nodes as ResearchNode[];
  const edges = graph.edges as ResearchEdge[];
  const branches = graph.branches as ResearchBranch[];
  const events = graph.events as ResearchEvent[];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const branchIds = new Set(branches.map((branch) => branch.id));
  if (nodeIds.size !== nodes.length) errors.push("node ids must be unique");
  if (branchIds.size !== branches.length) errors.push("branch ids must be unique");
  if (!branchIds.has("branch:main")) errors.push("main branch is missing");
  if (!nodes.some((node) => node.id === graph.rootClaimId && node.kind === "claim")) errors.push("rootClaimId must reference a claim node");
  for (const node of nodes) {
    if (!branchIds.has(node.branchId)) errors.push(`node ${node.id} references unknown branch ${node.branchId}`);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) errors.push(`edge ${edge.id} references an unknown node`);
    if (!branchIds.has(edge.branchId)) errors.push(`edge ${edge.id} references unknown branch ${edge.branchId}`);
    const sourceBranch = nodes.find((node) => node.id === edge.source)?.branchId;
    const targetBranch = nodes.find((node) => node.id === edge.target)?.branchId;
    if (sourceBranch && targetBranch && (sourceBranch !== edge.branchId || targetBranch !== edge.branchId)) {
      errors.push(`edge ${edge.id} crosses research branches without a merge`);
    }
  }
  for (const branch of branches) {
    if (branch.parentBranchId && !branchIds.has(branch.parentBranchId)) errors.push(`branch ${branch.id} has an unknown parent`);
    if (branch.mergedInto && !branchIds.has(branch.mergedInto)) errors.push(`branch ${branch.id} has an unknown merge target`);
  }
  for (const event of events) {
    if (!branchIds.has(event.branchId)) errors.push(`event ${event.id} references unknown branch ${event.branchId}`);
  }
  if (events.length !== new Set(events.map((event) => event.id)).size) errors.push("event ids must be unique");
  if (typeof graph.hash !== "string" || typeof graph.eventId !== "string") {
    errors.push("graph hash and eventId are required");
  } else {
    const expectedHash = stableHash(graphBase(graph as ResearchGraph));
    if (graph.hash !== expectedHash) errors.push("research graph hash does not match its content");
    const expectedEventId = stableEventId("research-graph", { researchId: graph.researchId, hash: expectedHash });
    if (graph.eventId !== expectedEventId) errors.push("research graph eventId does not match its content");
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidResearchGraph(value: unknown): asserts value is ResearchGraph {
  const result = validateResearchGraph(value);
  if (!result.valid) throw new Error(`Invalid research graph: ${result.errors.join("; ")}`);
}

/** Upgrade a validated v1 graph without losing its original event history. */
export function migrateResearchGraph(value: unknown): ResearchGraph {
  assertValidResearchGraph(value);
  const graph = value as ResearchGraph;
  const nodes = graph.nodes.map((node): ResearchNode => {
    if (node.kind === "evidence") {
      return { ...node, epistemicLevel: node.epistemicLevel ?? epistemicLevelForEvidenceKind(node.evidenceKind) };
    }
    if (node.kind === "claim") {
      const isUnconstrainedDefault = node.contract.requiredEvidence.length === 0
        && node.contract.minimumCoverage === 0
        && node.contract.minimumIndependentGroups === undefined
        && !node.contract.requireChallenge
        && node.contract.falsifiers.length === 0;
      return {
        ...node,
        contract: {
          ...node.contract,
          ...(isUnconstrainedDefault ? {
            requiredEvidence: [{
              id: "traceable-evidence",
              description: "At least one traceable, independently attributable evidence record",
              minimumStrength: 0.5,
              required: true,
            }],
            falsifiers: ["A reproducible observation contradicts the research objective"],
            requireChallenge: true,
            minimumCoverage: 1,
            minimumIndependentGroups: 1,
          } : {}),
          minimumIndependentGroups: node.contract.minimumIndependentGroups
            ?? (isUnconstrainedDefault || graph.schemaVersion !== RESEARCH_GRAPH_SCHEMA_VERSION
              ? 1
              : undefined),
        },
      };
    }
    return node;
  });
  const changed = graph.schemaVersion !== RESEARCH_GRAPH_SCHEMA_VERSION
    || nodes.some((node, index) => JSON.stringify(node) !== JSON.stringify(graph.nodes[index]));
  return changed
    ? finalizeGraph({ ...graphBase(graph), schemaVersion: RESEARCH_GRAPH_SCHEMA_VERSION, nodes })
    : graph;
}

export function exportResearchBundle(graph: ResearchGraph, exportedAt = Date.now()): PortableResearchBundle {
  const portableGraph = migrateResearchGraph(graph);
  const requiredAdapters = portableGraph.nodes
    .filter((node): node is ResearchActionNode => node.kind === "action")
    .map((node) => ({ actionType: node.actionType, ...(node.adapter ? { adapter: node.adapter } : {}) }))
    .filter((requirement, index, all) => all.findIndex((candidate) => (
      candidate.actionType === requirement.actionType && candidate.adapter === requirement.adapter
    )) === index);
  const base: Omit<PortableResearchBundle, "hash"> = {
    schemaVersion: RESEARCH_BUNDLE_SCHEMA_VERSION,
    graph: portableGraph,
    requiredModes: [...portableGraph.modes],
    requiredAdapters,
    exportedAt,
  };
  return { ...base, hash: stableHash(base) };
}

export function importResearchBundle(value: unknown): ResearchGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid research bundle: bundle must be an object");
  const bundle = value as Partial<PortableResearchBundle>;
  if (bundle.schemaVersion !== RESEARCH_BUNDLE_SCHEMA_VERSION && bundle.schemaVersion !== LEGACY_RESEARCH_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Invalid research bundle: unsupported schema ${String(bundle.schemaVersion)}`);
  }
  if (!bundle.graph || !Array.isArray(bundle.requiredModes) || !Array.isArray(bundle.requiredAdapters)
    || typeof bundle.exportedAt !== "number" || typeof bundle.hash !== "string") {
    throw new Error("Invalid research bundle: required fields are missing");
  }
  const { hash, ...base } = bundle as PortableResearchBundle;
  if (stableHash(base) !== hash) throw new Error("Invalid research bundle: hash does not match its content");
  assertValidResearchGraph(bundle.graph);
  return migrateResearchGraph(bundle.graph);
}
