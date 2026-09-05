import type { AgentTaskPacket, AgentTaskResult } from "@ai4s/shared";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown, field: string, minimum = 0): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.some((item) => !nonEmpty(item))) {
    throw new Error(`${field} must be a list of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

export function validateAgentTaskPacket(value: unknown): AgentTaskPacket {
  if (!value || typeof value !== "object") throw new Error("task packet must be an object");
  const packet = value as Partial<AgentTaskPacket>;
  for (const [field, candidate] of [
    ["task_id", packet.task_id],
    ["role", packet.role],
    ["objective", packet.objective],
    ["evidence_standard", packet.evidence_standard],
  ] as const) {
    if (!nonEmpty(candidate)) throw new Error(`${field} is required`);
  }
  if (!ID_RE.test(packet.task_id!) || (packet.parent_task_id && !ID_RE.test(packet.parent_task_id))) {
    throw new Error("task ids must be bounded identifiers");
  }
  const permissions = packet.permissions as Partial<AgentTaskPacket["permissions"]> | undefined;
  if (!permissions || typeof permissions !== "object") throw new Error("permissions are required");
  if (typeof permissions.may_delegate !== "boolean") throw new Error("permissions.may_delegate is required");
  return {
    task_id: packet.task_id!,
    ...(packet.parent_task_id ? { parent_task_id: packet.parent_task_id } : {}),
    ...(packet.parent_session_id ? { parent_session_id: packet.parent_session_id } : {}),
    role: packet.role!,
    objective: packet.objective!,
    input_paths: stringList(packet.input_paths, "input_paths", 1),
    ...(packet.source_ids ? { source_ids: stringList(packet.source_ids, "source_ids") } : {}),
    output_paths: stringList(packet.output_paths, "output_paths", 1),
    acceptance_criteria: stringList(packet.acceptance_criteria, "acceptance_criteria", 1),
    exclusions: stringList(packet.exclusions, "exclusions"),
    evidence_standard: packet.evidence_standard!,
    stop_conditions: stringList(packet.stop_conditions, "stop_conditions", 1),
    permissions: {
      allowed_tools: stringList(permissions.allowed_tools, "permissions.allowed_tools", 1),
      allowed_paths: stringList(permissions.allowed_paths, "permissions.allowed_paths", 1),
      may_delegate: permissions.may_delegate,
      ...(permissions.requires_human_approval !== undefined
        ? { requires_human_approval: Boolean(permissions.requires_human_approval) }
        : {}),
    },
  };
}

export function validateAgentTaskResult(value: unknown): AgentTaskResult {
  if (!value || typeof value !== "object") throw new Error("task result must be an object");
  const result = value as Partial<AgentTaskResult>;
  if (!nonEmpty(result.task_id) || !ID_RE.test(result.task_id!)) throw new Error("invalid task_id");
  if (!nonEmpty(result.agent_id) || !ID_RE.test(result.agent_id!)) throw new Error("invalid agent_id");
  if (!Number.isFinite(result.started_at) || !Number.isFinite(result.ended_at)) {
    throw new Error("started_at and ended_at are required");
  }
  if (result.ended_at! < result.started_at!) throw new Error("ended_at precedes started_at");
  const allowed = new Set(["queued", "running", "completed", "failed", "cancelled", "blocked"]);
  if (!allowed.has(result.status ?? "")) throw new Error("invalid task status");
  return {
    task_id: result.task_id!,
    agent_id: result.agent_id!,
    status: result.status as AgentTaskResult["status"],
    started_at: result.started_at!,
    ended_at: result.ended_at!,
    ...(result.output ? { output: result.output } : {}),
    deliverables: stringList(result.deliverables, "deliverables"),
    evidence: Array.isArray(result.evidence)
      ? result.evidence.map((item) => {
          if (!item || typeof item !== "object" || !nonEmpty((item as { reference?: unknown }).reference)) {
            throw new Error("evidence entries require a reference");
          }
          return item as AgentTaskResult["evidence"][number];
        })
      : (() => {
          throw new Error("evidence is required");
        })(),
    limitations: stringList(result.limitations, "limitations"),
  };
}
