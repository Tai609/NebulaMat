/**
 * Versioned, transport-neutral contracts for governed DFT work.
 *
 * The desktop, SDK and materials connector deliberately share this module. It
 * contains no filesystem or runtime code: a workflow can therefore be
 * validated before it is handed to DSH or to a remote scheduler.
 */

export const DFT_WORKFLOW_SCHEMA_VERSION = 1;
export const DFT_MODEL_AUDIT_SCHEMA_VERSION = 1;
export const SUBMISSION_MANIFEST_SCHEMA_VERSION = 1;

export type LegacyDFTWorkflowStage =
  | "draft"
  | "model-audit"
  | "cost-audit"
  | "prepared"
  | "preflight"
  | "human-review"
  | "approved"
  | "submitted"
  | "running"
  | "retrieving"
  | "validating"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

/** Namespaced stage spellings used by persisted Materials MCP checkpoints.
 * The unprefixed spellings above remain readable for existing desktop data. */
export type NamespacedDFTWorkflowStage =
  | "dft.prepare"
  | "dft.audit"
  | "dft.preflight"
  | "dft.human-review"
  | "dft.approved"
  | "dft.submit"
  | "dft.running"
  | "dft.retrieve"
  | "dft.validate"
  | "dft.completed"
  | "dft.failed"
  | "dft.blocked"
  | "dft.cancelled";

export type DFTWorkflowStage = LegacyDFTWorkflowStage | NamespacedDFTWorkflowStage;

export type DFTWorkflowStatus = "active" | "blocked" | "succeeded" | "failed" | "cancelled";
export type DFTAuditDecision = "pending" | "approved" | "changes-requested" | "rejected";
export type DFTActivePhase = "bulk-reference" | "candidate-surface" | "operative-phase";

export interface DFTSupercell {
  a: number;
  b: number;
  c?: number;
}

export interface DFTKPointPlan {
  mesh: [number, number, number];
  gammaCentered?: boolean;
  method?: "automatic" | "monkhorst-pack" | "gamma";
}

export interface DFTCostEstimate {
  /** Estimated node-hours, when the scheduler exposes this unit. */
  nodeHours?: number;
  /** Estimated wall time in minutes. */
  wallMinutes?: number;
  memoryGb?: number;
  plannedRuns: number;
  lowerCostAlternative: string;
}

/** The model-and-cost audit that must be frozen before remote submission. */
export interface DFTModelAudit {
  schemaVersion: number;
  auditId: string;
  decision: DFTAuditDecision;
  activePhase: DFTActivePhase;
  composition?: string;
  atomCount: number;
  freeAtoms: number;
  fixedAtoms: number;
  slabLayers?: number;
  supercell?: DFTSupercell;
  coverage?: string;
  kpoints: DFTKPointPlan;
  memoryEstimateGb: number;
  plannedRunCount: number;
  lowerCostAlternative: string;
  frozenLayerPolicy: string;
  scientificJustification: string;
  convergenceEvidence: string[];
  warnings: string[];
  /** Hash of the exact structure/model input this audit reviewed. */
  modelHash: string;
  /** Hash of the cost inputs/estimate; changes invalidate approval. */
  costHash: string;
  hash: string;
  eventId: string;
  reviewedBy?: string;
  reviewedAt?: number;
}

export interface SubmissionArtifact {
  path: string;
  role: "structure" | "parameter" | "pseudopotential" | "script" | "output" | "other";
  hash: string;
  size?: number;
}

export interface HumanSubmissionApproval {
  decision: "approved" | "rejected";
  actor: string;
  approvedAt: number;
  modelHash: string;
  parametersHash: string;
  auditHash: string;
  costHash: string;
  eventId: string;
}

/** Immutable input manifest handed to an actual remote submitter. */
export interface SubmissionManifest {
  schemaVersion: number;
  manifestId: string;
  workflowId: string;
  modelHash: string;
  parametersHash: string;
  auditHash: string;
  costHash: string;
  artifacts: SubmissionArtifact[];
  command: string;
  surface: "hpc" | "ssh" | "modal" | "local";
  remote?: { host?: string; scheduler?: string; queue?: string; project?: string };
  humanApproval?: HumanSubmissionApproval;
  hash: string;
  eventId: string;
}

export interface DFTValidationCheck {
  id: string;
  outcome: "passed" | "failed" | "inconclusive";
  evidencePaths: string[];
  observed?: string;
  expected?: string;
}

/** Scientific acceptance is a separate typed object, not a prompt phrase. */
export interface DFTValidationReport {
  schemaVersion: number;
  workflowId: string;
  runId: string;
  outcome: "passed" | "failed";
  checks: DFTValidationCheck[];
  artifactHashes: string[];
  reviewedBy: string;
  reviewedAt: number;
  hash: string;
  eventId: string;
}

export interface DFTWorkflowEvent {
  eventId: string;
  workflowId: string;
  from: DFTWorkflowStage;
  to: DFTWorkflowStage;
  at: number;
  actor?: string;
  reason?: string;
  hash: string;
}

/** Durable resume marker for a scheduler/agent task. It is separate from the
 * workflow event log so a crash can resume without inventing a transition. */
export interface DFTWorkflowCheckpoint {
  workflowId: string;
  stage: DFTWorkflowStage;
  previousStage?: DFTWorkflowStage;
  taskId: string;
  inputHash: string;
  updatedAt: number;
  resumable: boolean;
  reason?: string;
  schemaVersion?: number;
  hash?: string;
  eventId?: string;
}

/** Materials design is an evidence-to-experiment loop, not a DFT scheduler.
 * Keep its persisted stages separate so an experiment record can never look
 * like a submitted or completed calculation. */
export type MaterialsDesignStage =
  | "materials.goal"
  | "materials.evidence"
  | "materials.hypothesis"
  | "materials.synthesis"
  | "materials.experiment"
  | "materials.interpretation";

export interface MaterialsDesignCheckpoint {
  schemaVersion: number;
  workflowId: string;
  stage: MaterialsDesignStage;
  previousStage?: MaterialsDesignStage;
  taskId: string;
  inputHash: string;
  updatedAt: number;
  resumable: boolean;
  reason?: string;
  hash: string;
  eventId: string;
}

export const MATERIALS_DESIGN_SCHEMA_VERSION = 1;
export const MATERIALS_DESIGN_STAGE_TRANSITIONS: Readonly<
  Record<MaterialsDesignStage, readonly MaterialsDesignStage[]>
> = {
  "materials.goal": ["materials.evidence", "materials.hypothesis"],
  "materials.evidence": ["materials.hypothesis", "materials.goal"],
  "materials.hypothesis": ["materials.synthesis", "materials.experiment", "materials.goal"],
  "materials.synthesis": ["materials.experiment", "materials.hypothesis"],
  "materials.experiment": ["materials.interpretation", "materials.hypothesis"],
  "materials.interpretation": ["materials.hypothesis", "materials.goal"],
};

export function canTransitionMaterialsDesign(
  from: MaterialsDesignStage,
  to: MaterialsDesignStage,
): boolean {
  return from === to || MATERIALS_DESIGN_STAGE_TRANSITIONS[from].includes(to);
}

/** A materials workflow is the durable envelope around every DFT stage. */
export interface MaterialsWorkflow {
  schemaVersion: number;
  workflowId: string;
  goal: string;
  stage: DFTWorkflowStage;
  status: DFTWorkflowStatus;
  modelAudit?: DFTModelAudit;
  submissionManifest?: SubmissionManifest;
  validation?: DFTValidationReport;
  blockers: string[];
  events: DFTWorkflowEvent[];
  hash: string;
  eventId: string;
  createdAt: number;
  updatedAt: number;
}

export const DFT_STAGE_TRANSITIONS: Readonly<Partial<Record<DFTWorkflowStage, readonly DFTWorkflowStage[]>>> = {
  draft: ["model-audit", "blocked", "cancelled"],
  "model-audit": ["cost-audit", "prepared", "blocked", "cancelled"],
  "cost-audit": ["prepared", "model-audit", "blocked", "cancelled"],
  prepared: ["preflight", "model-audit", "cost-audit", "blocked", "cancelled"],
  preflight: ["human-review", "prepared", "blocked", "cancelled"],
  "human-review": ["approved", "prepared", "blocked", "cancelled"],
  approved: ["submitted", "prepared", "blocked", "cancelled"],
  submitted: ["running", "failed", "blocked", "cancelled"],
  running: ["retrieving", "failed", "blocked", "cancelled"],
  retrieving: ["validating", "failed", "blocked", "cancelled"],
  validating: ["completed", "failed", "blocked"],
  completed: [],
  failed: ["prepared", "cancelled"],
  blocked: ["prepared", "cancelled"],
  cancelled: [],
  "dft.prepare": ["dft.audit", "dft.blocked", "dft.cancelled"],
  "dft.audit": ["dft.preflight", "dft.prepare", "dft.blocked", "dft.cancelled"],
  "dft.preflight": ["dft.human-review", "dft.prepare", "dft.blocked", "dft.cancelled"],
  "dft.human-review": ["dft.approved", "dft.prepare", "dft.blocked", "dft.cancelled"],
  "dft.approved": ["dft.submit", "dft.prepare", "dft.blocked", "dft.cancelled"],
  "dft.submit": ["dft.running", "dft.failed", "dft.blocked", "dft.cancelled"],
  "dft.running": ["dft.retrieve", "dft.failed", "dft.blocked", "dft.cancelled"],
  "dft.retrieve": ["dft.validate", "dft.failed", "dft.blocked", "dft.cancelled"],
  "dft.validate": ["dft.completed", "dft.failed", "dft.blocked"],
  "dft.completed": [],
  "dft.failed": ["dft.prepare", "dft.cancelled"],
  "dft.blocked": ["dft.prepare", "dft.cancelled"],
  "dft.cancelled": [],
};

const HEX_HASH = /^[a-f0-9]{64}$/i;

/** JSON canonicalization used for all IDs. Object insertion order never leaks
 * into a workflow hash; arrays retain their semantic order. */
export function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
  );
}

/** Deterministic 256-bit identifier without a runtime-specific crypto import.
 * This is an identity/content address, not a password or signature. */
export function stableHash(value: unknown): string {
  const input = typeof value === "string" ? value : JSON.stringify(canonicalize(value));
  const bytes = new TextEncoder().encode(input ?? "null");
  const lanes = [
    0xcbf29ce484222325n,
    0x84222325cbf29ce4n,
    0x9e3779b185ebca87n,
    0xd6e8feb86659fd93n,
  ];
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = BigInt(bytes[index]);
    for (let lane = 0; lane < lanes.length; lane += 1) {
      lanes[lane] = ((lanes[lane] ^ (byte + BigInt(lane * 17))) * prime) & mask;
      lanes[lane] ^= lanes[lane] >> BigInt(7 + lane);
    }
  }
  return lanes.map((lane) => lane.toString(16).padStart(16, "0")).join("");
}

export function stableEventId(namespace: string, value: unknown): string {
  return `${namespace}_${stableHash(value)}`;
}

/** Cache identity for a scientific job. Approval hashes remain separate and
 * must use the exact frozen artifacts in SubmissionManifest. */
export function dftCacheKey(input: {
  code: unknown;
  model: unknown;
  parameters: unknown;
  software?: unknown;
  hardware?: unknown;
}): string {
  return stableEventId("dft-cache", input);
}

export function canTransition(from: DFTWorkflowStage, to: DFTWorkflowStage): boolean {
  return DFT_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

function statusForStage(stage: DFTWorkflowStage): DFTWorkflowStatus {
  if (stage === "blocked" || stage === "dft.blocked") return "blocked";
  if (stage === "failed" || stage === "dft.failed") return "failed";
  if (stage === "cancelled" || stage === "dft.cancelled") return "cancelled";
  if (stage === "completed" || stage === "dft.completed") return "succeeded";
  return "active";
}

function workflowHash(workflow: Omit<MaterialsWorkflow, "hash" | "eventId">): string {
  return stableHash(workflow);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStableIdentity(value: unknown): value is string {
  return typeof value === "string" && HEX_HASH.test(value);
}

function isValidApprovedAudit(audit: DFTModelAudit): boolean {
  const mesh = audit.kpoints?.mesh;
  return audit.schemaVersion === DFT_MODEL_AUDIT_SCHEMA_VERSION
    && audit.decision === "approved"
    && isNonEmptyString(audit.auditId)
    && isPositiveInteger(audit.atomCount)
    && isNonNegativeInteger(audit.freeAtoms)
    && isNonNegativeInteger(audit.fixedAtoms)
    && audit.freeAtoms + audit.fixedAtoms === audit.atomCount
    && (audit.slabLayers === undefined || isPositiveInteger(audit.slabLayers))
    && Array.isArray(mesh)
    && mesh.length === 3
    && mesh.every(isPositiveInteger)
    && typeof audit.memoryEstimateGb === "number"
    && Number.isFinite(audit.memoryEstimateGb)
    && audit.memoryEstimateGb > 0
    && isPositiveInteger(audit.plannedRunCount)
    && isNonEmptyString(audit.lowerCostAlternative)
    && isNonEmptyString(audit.frozenLayerPolicy)
    && isNonEmptyString(audit.scientificJustification)
    && Array.isArray(audit.convergenceEvidence)
    && Array.isArray(audit.warnings)
    && hasStableIdentity(audit.modelHash)
    && hasStableIdentity(audit.costHash)
    && hasStableIdentity(audit.hash)
    && isNonEmptyString(audit.eventId);
}

export function createMaterialsWorkflow(input: {
  workflowId: string;
  goal: string;
  now?: number;
  modelAudit?: DFTModelAudit;
}): MaterialsWorkflow {
  const now = input.now ?? Date.now();
  const base: Omit<MaterialsWorkflow, "hash" | "eventId"> = {
    schemaVersion: DFT_WORKFLOW_SCHEMA_VERSION,
    workflowId: input.workflowId,
    goal: input.goal,
    stage: "draft",
    status: "active",
    ...(input.modelAudit ? { modelAudit: input.modelAudit } : {}),
    blockers: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  const hash = workflowHash(base);
  return { ...base, hash, eventId: stableEventId("workflow", { workflowId: input.workflowId, hash }) };
}

export function isSubmissionReady(
  manifest: SubmissionManifest | undefined,
  audit: DFTModelAudit | undefined,
  workflowId?: string,
): boolean {
  if (!manifest || !audit || !isValidApprovedAudit(audit)) return false;
  if (manifest.schemaVersion !== SUBMISSION_MANIFEST_SCHEMA_VERSION
    || !isNonEmptyString(manifest.manifestId)
    || !isNonEmptyString(manifest.workflowId)
    || (workflowId !== undefined && manifest.workflowId !== workflowId)
    || !isNonEmptyString(manifest.command)
    || !Array.isArray(manifest.artifacts)
    || ![manifest.modelHash, manifest.parametersHash, manifest.auditHash, manifest.costHash, manifest.hash].every(hasStableIdentity)
    || !isNonEmptyString(manifest.eventId)) return false;
  const approval = manifest.humanApproval;
  if (!approval
    || approval.decision !== "approved"
    || typeof approval.actor !== "string"
    || !approval.actor.startsWith("human:")
    || !Number.isFinite(approval.approvedAt)
    || !isNonEmptyString(approval.eventId)) return false;
  return approval.modelHash === manifest.modelHash
    && approval.auditHash === manifest.auditHash
    && approval.costHash === manifest.costHash
    && approval.parametersHash === manifest.parametersHash
    && manifest.modelHash === audit.modelHash
    && manifest.auditHash === audit.hash
    && manifest.costHash === audit.costHash;
}

export function assertSubmissionReady(
  manifest: SubmissionManifest | undefined,
  audit: DFTModelAudit | undefined,
  workflowId?: string,
): void {
  if (!isSubmissionReady(manifest, audit, workflowId)) {
    throw new Error("DFT submission is blocked: model/cost audit and hash-bound human approval are required");
  }
}

export function isDFTValidationReady(
  report: DFTValidationReport | undefined,
  workflowId?: string,
): boolean {
  return !!report
    && report.schemaVersion === DFT_WORKFLOW_SCHEMA_VERSION
    && isNonEmptyString(report.workflowId)
    && (workflowId === undefined || report.workflowId === workflowId)
    && isNonEmptyString(report.runId)
    && report.outcome === "passed"
    && Array.isArray(report.checks)
    && report.checks.length > 0
    && report.checks.every((check) => isNonEmptyString(check.id)
      && check.outcome === "passed"
      && Array.isArray(check.evidencePaths)
      && check.evidencePaths.length > 0
      && check.evidencePaths.every(isNonEmptyString))
    && Array.isArray(report.artifactHashes)
    && report.artifactHashes.length > 0
    && report.artifactHashes.every(hasStableIdentity)
    && report.reviewedBy.startsWith("human:")
    && Number.isFinite(report.reviewedAt)
    && hasStableIdentity(report.hash)
    && isNonEmptyString(report.eventId);
}

export function assertDFTValidationReady(
  report: DFTValidationReport | undefined,
  workflowId?: string,
): void {
  if (!isDFTValidationReady(report, workflowId)) {
    throw new Error("DFT completion is blocked: passed scientific checks and independent human review are required");
  }
}

export function attachDFTValidation(
  workflow: MaterialsWorkflow,
  report: DFTValidationReport,
): MaterialsWorkflow {
  assertDFTValidationReady(report, workflow.workflowId);
  const nextBase: Omit<MaterialsWorkflow, "hash" | "eventId"> = {
    ...workflow,
    validation: report,
    updatedAt: report.reviewedAt,
  };
  const hash = workflowHash(nextBase);
  return { ...nextBase, hash, eventId: stableEventId("workflow", { workflowId: workflow.workflowId, hash }) };
}

export function transitionMaterialsWorkflow(
  workflow: MaterialsWorkflow,
  to: DFTWorkflowStage,
  options: { at?: number; actor?: string; reason?: string } = {},
): MaterialsWorkflow {
  if (!canTransition(workflow.stage, to)) throw new Error(`Invalid DFT transition: ${workflow.stage} -> ${to}`);
  if (to === "submitted" || to === "dft.submit") {
    assertSubmissionReady(workflow.submissionManifest, workflow.modelAudit, workflow.workflowId);
  }
  if (to === "completed" || to === "dft.completed") {
    assertDFTValidationReady(workflow.validation, workflow.workflowId);
  }
  const at = options.at ?? Date.now();
  const eventBase = {
    workflowId: workflow.workflowId,
    from: workflow.stage,
    to,
    at,
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  };
  const event: DFTWorkflowEvent = {
    ...eventBase,
    eventId: stableEventId("workflow-event", eventBase),
    hash: stableHash(eventBase),
  };
  const nextBase: Omit<MaterialsWorkflow, "hash" | "eventId"> = {
    ...workflow,
    stage: to,
    status: statusForStage(to),
    events: [...workflow.events, event],
    updatedAt: at,
  };
  const hash = workflowHash(nextBase);
  return { ...nextBase, hash, eventId: stableEventId("workflow", { workflowId: workflow.workflowId, hash }) };
}
