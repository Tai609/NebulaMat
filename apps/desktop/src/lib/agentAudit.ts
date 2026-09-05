import type { AgentInfo } from "@ai4s/sdk";
import type { ReviewerBlock } from "@ai4s/shared";
import { isTauri } from "./tauri";
import { splitReview } from "./review";

export type AgentAuditEventType =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "review.decision"
  | "artifact.revised"
  | "governance.blocked"
  | "governance.approval-required";

export interface AgentAuditInput {
  eventType: AgentAuditEventType;
  agentId: string;
  role: string;
  sessionId: string;
  parentSessionId?: string;
  parentTaskId?: string;
  model?: string;
  startedAt?: number;
  endedAt?: number;
  status?: string;
  taskInput?: Record<string, unknown>;
  outputSummary?: string;
  deliverables?: string[];
  reviewDecision?: ReviewerBlock;
  revisionDiff?: string;
}

export interface AgentAuditRecord extends AgentAuditInput {
  schemaVersion: number;
  eventId: string;
  ts: number;
}

/** Persist one lifecycle or handoff event in the desktop workspace ledger.
 *  Gateway web clients cannot write the host filesystem, so their runtime must
 *  provide the equivalent server-side hook before this becomes non-local. */
export async function recordAgentAudit(input: AgentAuditInput): Promise<AgentAuditRecord | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentAuditRecord>("record_agent_audit", { input });
}

export async function listAgentAudit(sessionId?: string): Promise<AgentAuditRecord[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentAuditRecord[]>("list_agent_audit", { sessionId: sessionId ?? null });
}

const TASK_ROLE_KEYS = ["subagent_type", "subagentType", "agent", "role"] as const;

/** Compatibility task inputs name the delegated agent; tolerate both legacy key
 *  spellings so an upgrade cannot collapse a child back to an anonymous agent. */
export function agentRoleFromTask(input?: Record<string, unknown>, title?: string): string {
  for (const key of TASK_ROLE_KEYS) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const normalized = title?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "specialist";
}

function configuredModel(agent?: AgentInfo): string | undefined {
  const model = agent?.model;
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const provider = typeof model.providerID === "string" ? model.providerID : "";
    const id = typeof model.modelID === "string" ? model.modelID : "";
    if (provider && id) return `${provider}/${id}`;
  }
  return undefined;
}

export function agentModelForRole(
  agents: AgentInfo[],
  role: string,
  fallback?: string | null,
  input?: Record<string, unknown>,
): string | undefined {
  const explicit = input?.model;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  return configuredModel(agents.find((agent) => agent.name === role)) ?? fallback ?? undefined;
}

export function reviewDecisionFromOutput(output?: string): ReviewerBlock | undefined {
  if (!output) return undefined;
  return splitReview(output).review ?? undefined;
}
