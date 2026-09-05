import type {
  ResearchActionType,
  ResearchEvidenceKind,
  ResearchEvidenceRelation,
} from "./research";

export const RESEARCH_AGENT_PROPOSAL_SCHEMA_VERSION = 1 as const;

/** The only stages an autonomous research turn may occupy. The order is
 * deliberate: the agent must inspect the current graph before it can add a
 * hypothesis, plan an action, execute it, evaluate its output, and synthesize
 * a conclusion. */
export type ResearchAutopilotStage =
  | "inspect"
  | "hypothesize"
  | "plan"
  | "execute"
  | "evaluate"
  | "synthesize";

export const RESEARCH_AUTOPILOT_STAGES: readonly ResearchAutopilotStage[] = [
  "inspect", "hypothesize", "plan", "execute", "evaluate", "synthesize",
];

const AUTOPILOT_STAGE_TRANSITIONS: Record<ResearchAutopilotStage, readonly ResearchAutopilotStage[]> = {
  inspect: ["inspect", "hypothesize"],
  hypothesize: ["hypothesize", "plan"],
  plan: ["plan", "execute"],
  execute: ["execute", "evaluate"],
  evaluate: ["evaluate", "plan", "synthesize"],
  synthesize: ["synthesize"],
};

export function canAdvanceResearchAutopilotStage(
  current: ResearchAutopilotStage,
  next: ResearchAutopilotStage,
): boolean {
  return AUTOPILOT_STAGE_TRANSITIONS[current].includes(next);
}

export interface ResearchAgentHypothesisProposal {
  id?: string;
  label?: string;
  statement: string;
  alternatives?: string[];
}

export interface ResearchAgentActionProposal {
  id?: string;
  actionType: ResearchActionType;
  objective: string;
  expectedInformationGain?: number;
  expectedConfidenceGain?: number;
  cost?: number;
  risk?: number;
  reversibility?: number;
  testsClaimIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResearchAgentEvidenceProposal {
  id?: string;
  label?: string;
  evidenceKind?: ResearchEvidenceKind;
  summary: string;
  relation: ResearchEvidenceRelation;
  strength?: number;
  uncertainty?: string;
  sourceFamily?: string;
}

/** The only model output shape the autonomous loop is allowed to apply. */
export interface ResearchAgentProposal {
  schemaVersion: typeof RESEARCH_AGENT_PROPOSAL_SCHEMA_VERSION;
  /** Stage represented by this response, not the stage the agent wants next. */
  stage: ResearchAutopilotStage;
  /** Hash of the graph included in the prompt for this turn. */
  graphHash: string;
  summary: string;
  hypotheses: ResearchAgentHypothesisProposal[];
  actions: ResearchAgentActionProposal[];
  evidence: ResearchAgentEvidenceProposal[];
  nextStage: ResearchAutopilotStage;
  nextPrompt: string;
  done: boolean;
}

const ACTION_TYPES: ResearchActionType[] = [
  "retrieve", "observe", "measure", "compute", "derive", "simulate", "challenge", "synthesize", "speculate",
];
const EVIDENCE_KINDS: ResearchEvidenceKind[] = [
  "literature", "observation", "measurement", "simulation", "derivation", "argument", "reproduction", "negative", "artifact",
];
const EVIDENCE_RELATIONS: ResearchEvidenceRelation[] = ["supports", "refutes", "qualifies", "inconclusive"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, field: string, required = true): string | undefined {
  if (typeof value !== "string" || (required && !value.trim())) {
    if (required) throw new Error(`Research proposal field ${field} must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}

function numberValue(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Research proposal field ${field} must be a number between 0 and 1`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`Research proposal field ${field} is invalid`);
  return value as T;
}

function requiredEnumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`Research proposal field ${field} is invalid`);
  }
  return value as T;
}

function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Research proposal field ${field} must be an array of strings`);
  }
  return value.map((item) => String(item).trim());
}

function parseObject(value: unknown): ResearchAgentProposal {
  const root = record(value);
  if (!root || root.schemaVersion !== RESEARCH_AGENT_PROPOSAL_SCHEMA_VERSION) {
    throw new Error(`Research proposal schemaVersion must be ${RESEARCH_AGENT_PROPOSAL_SCHEMA_VERSION}`);
  }
  const parseList = (field: "hypotheses" | "actions" | "evidence") => {
    const list = root[field];
    if (!Array.isArray(list)) throw new Error(`Research proposal field ${field} must be an array`);
    return list;
  };
  const hypotheses = parseList("hypotheses").map((item) => {
    const value = record(item);
    if (!value) throw new Error("Research hypothesis proposal must be an object");
    return {
      ...(stringValue(value.id, "hypotheses[].id", false) ? { id: stringValue(value.id, "hypotheses[].id", false) } : {}),
      ...(stringValue(value.label, "hypotheses[].label", false) ? { label: stringValue(value.label, "hypotheses[].label", false) } : {}),
      statement: stringValue(value.statement, "hypotheses[].statement")!,
      ...(stringArray(value.alternatives, "hypotheses[].alternatives") ? { alternatives: stringArray(value.alternatives, "hypotheses[].alternatives") } : {}),
    };
  });
  const actions = parseList("actions").map((item) => {
    const value = record(item);
    if (!value) throw new Error("Research action proposal must be an object");
    return {
      ...(stringValue(value.id, "actions[].id", false) ? { id: stringValue(value.id, "actions[].id", false) } : {}),
      actionType: enumValue(value.actionType, ACTION_TYPES, "actions[].actionType", "challenge"),
      objective: stringValue(value.objective, "actions[].objective")!,
      expectedInformationGain: numberValue(value.expectedInformationGain, "actions[].expectedInformationGain", 0.5),
      expectedConfidenceGain: numberValue(value.expectedConfidenceGain, "actions[].expectedConfidenceGain", 0.25),
      cost: numberValue(value.cost, "actions[].cost", 0.3),
      risk: numberValue(value.risk, "actions[].risk", 0),
      reversibility: numberValue(value.reversibility, "actions[].reversibility", 1),
      ...(stringArray(value.testsClaimIds, "actions[].testsClaimIds") ? { testsClaimIds: stringArray(value.testsClaimIds, "actions[].testsClaimIds") } : {}),
      ...(record(value.metadata) ? { metadata: record(value.metadata)! } : {}),
    };
  });
  const evidence = parseList("evidence").map((item) => {
    const value = record(item);
    if (!value) throw new Error("Research evidence proposal must be an object");
    return {
      ...(stringValue(value.id, "evidence[].id", false) ? { id: stringValue(value.id, "evidence[].id", false) } : {}),
      ...(stringValue(value.label, "evidence[].label", false) ? { label: stringValue(value.label, "evidence[].label", false) } : {}),
      evidenceKind: enumValue(value.evidenceKind, EVIDENCE_KINDS, "evidence[].evidenceKind", "argument"),
      summary: stringValue(value.summary, "evidence[].summary")!,
      relation: enumValue(value.relation, EVIDENCE_RELATIONS, "evidence[].relation", "inconclusive"),
      strength: numberValue(value.strength, "evidence[].strength", 0.25),
      ...(stringValue(value.uncertainty, "evidence[].uncertainty", false) ? { uncertainty: stringValue(value.uncertainty, "evidence[].uncertainty", false) } : {}),
      ...(stringValue(value.sourceFamily, "evidence[].sourceFamily", false) ? { sourceFamily: stringValue(value.sourceFamily, "evidence[].sourceFamily", false) } : {}),
    };
  });
  const stage = requiredEnumValue(root.stage, RESEARCH_AUTOPILOT_STAGES, "stage");
  const graphHash = stringValue(root.graphHash, "graphHash")!;
  const summary = stringValue(root.summary, "summary")!;
  const nextStage = requiredEnumValue(root.nextStage, RESEARCH_AUTOPILOT_STAGES, "nextStage");
  const nextPrompt = stringValue(root.nextPrompt, "nextPrompt")!;
  if (typeof root.done !== "boolean") throw new Error("Research proposal field done must be a boolean");
  return {
    schemaVersion: RESEARCH_AGENT_PROPOSAL_SCHEMA_VERSION,
    stage,
    graphHash,
    summary,
    hypotheses,
    actions,
    evidence,
    nextStage,
    nextPrompt,
    done: root.done,
  };
}

/** Extract and validate one fenced JSON proposal; invalid output is rejected. */
export function parseResearchAgentProposal(text: string): ResearchAgentProposal | null {
  const fenced = text.match(/```(?:json|cebro)\s*([\s\S]*?)```/iu)?.[1]?.trim();
  if (!fenced) return null;
  try {
    return parseObject(JSON.parse(fenced));
  } catch {
    return null;
  }
}

/** Conservative gate for proposals that may spend material resources or cause
 * effects outside the local, reversible research workspace. */
export function researchAgentProposalNeedsApproval(proposal: ResearchAgentProposal): boolean {
  return proposal.actions.some((action) => (
    action.risk !== undefined && action.risk > 0
  ) || (
    action.reversibility !== undefined && action.reversibility < 1
  ) || (
    action.cost !== undefined && action.cost > 0.7
  ) || action.actionType === "measure" || action.actionType === "synthesize");
}
