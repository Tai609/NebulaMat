export type MaterialsTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export interface MaterialsWorkflowTask {
  taskId: string;
  capability: string;
  role: string;
  objective: string;
  dependencies: string[];
  status: MaterialsTaskStatus;
  attempt?: number;
  outputHash?: string;
}

export interface MaterialsWorkflowOptionalStage {
  stage: string;
  status: MaterialsTaskStatus | string;
  reason?: string;
  nextStep?: string;
}

export interface MaterialsWorkflowDag {
  workflowId: string;
  goal: string;
  stage: string;
  status: string;
  template: string | null;
  tasks: MaterialsWorkflowTask[];
  optionalStages: MaterialsWorkflowOptionalStage[];
}

export interface MaterialsDagNode extends MaterialsWorkflowTask {
  layer: number;
  missingDependency?: boolean;
}

export interface MaterialsDagEdge {
  from: string;
  to: string;
  missing?: boolean;
}

export interface MaterialsDagLayout {
  nodes: MaterialsDagNode[];
  edges: MaterialsDagEdge[];
  layers: MaterialsDagNode[][];
  width: number;
  height: number;
}

const TERMINAL_STATUS: MaterialsTaskStatus[] = ["completed", "failed", "blocked", "skipped"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function taskStatus(value: unknown): MaterialsTaskStatus {
  const status = stringValue(value).toLowerCase();
  if (status === "success" || status === "done") return "completed";
  if (status === "queued" || status === "created") return "pending";
  if (status === "error") return "failed";
  if ((["pending", "running", "completed", "failed", "blocked", "skipped"] as string[]).includes(status)) {
    return status as MaterialsTaskStatus;
  }
  return "pending";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function parseMaterialsWorkflowDag(raw: unknown): MaterialsWorkflowDag | null {
  const data = record(raw);
  const workflowId = stringValue(data.workflow_id ?? data.workflowId);
  if (!workflowId) return null;
  const tasks = Array.isArray(data.tasks)
    ? data.tasks.map((entry) => {
        const item = record(entry);
        const input = record(item.input);
        const taskId = stringValue(item.task_id ?? item.taskId ?? input.task_id);
        return {
          taskId,
          capability: stringValue(item.capability ?? input.capability, "materials.task"),
          role: stringValue(item.role ?? input.role, "materials-supervisor"),
          objective: stringValue(item.objective ?? input.objective, taskId),
          dependencies: stringList(item.dependencies ?? item.depends_on ?? input.dependencies),
          status: taskStatus(item.status ?? record(item.output).status),
          ...(typeof item.attempt === "number" ? { attempt: item.attempt } : {}),
          ...(typeof item.output_hash === "string" ? { outputHash: item.output_hash } : {}),
        } satisfies MaterialsWorkflowTask;
      }).filter((task) => task.taskId)
    : [];
  const optionalStages = Array.isArray(data.optional_stages)
    ? data.optional_stages.map((entry) => {
        const item = record(entry);
        return {
          stage: stringValue(item.stage, "optional stage"),
          status: stringValue(item.status, "skipped"),
          ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
          ...(typeof item.next_step === "string" ? { nextStep: item.next_step } : {}),
        };
      })
    : [];
  return {
    workflowId,
    goal: stringValue(data.goal),
    stage: stringValue(data.stage, "planned"),
    status: stringValue(data.status, "active"),
    template: typeof data.workflow_template === "string" ? data.workflow_template : null,
    tasks,
    optionalStages,
  };
}

/**
 * Produce a deterministic left-to-right layered DAG. Dependencies that refer
 * to a missing task become explicit blocked placeholder nodes, so a malformed
 * snapshot remains inspectable instead of crashing the panel.
 */
export function layoutMaterialsWorkflowDag(workflow: MaterialsWorkflowDag): MaterialsDagLayout {
  const byId = new Map(workflow.tasks.map((task) => [task.taskId, task]));
  const missingIds = new Set<string>();
  for (const task of workflow.tasks) {
    for (const dependency of task.dependencies) if (!byId.has(dependency)) missingIds.add(dependency);
  }
  for (const dependency of missingIds) {
    byId.set(dependency, {
      taskId: dependency,
      capability: "missing.dependency",
      role: "workflow-validator",
      objective: "Dependency is missing from this workflow snapshot.",
      dependencies: [],
      status: "blocked",
    });
  }

  const indegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();
  for (const [id, task] of byId) {
    const knownDependencies = task.dependencies.filter((dependency) => byId.has(dependency));
    indegree.set(id, knownDependencies.length);
    for (const dependency of knownDependencies) {
      const next = downstream.get(dependency) ?? [];
      next.push(id);
      downstream.set(dependency, next);
    }
  }

  const layerById = new Map<string, number>();
  let frontier = [...byId.keys()].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  let layer = 0;
  const visited = new Set<string>();
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      layerById.set(id, layer);
      for (const child of downstream.get(id) ?? []) {
        const remaining = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, remaining);
        if (remaining === 0) next.push(child);
      }
    }
    frontier = next.sort();
    layer += 1;
  }
  // Cycles are invalid but should still be visible. Place the remaining nodes
  // after the valid layers and let the edge styling communicate the problem.
  const cycleLayer = layer;
  for (const id of byId.keys()) if (!layerById.has(id)) layerById.set(id, cycleLayer);

  const nodes = [...byId.values()]
    .map((task) => ({ ...task, layer: layerById.get(task.taskId) ?? 0, ...(missingIds.has(task.taskId) ? { missingDependency: true } : {}) }))
    .sort((a, b) => a.layer - b.layer || a.taskId.localeCompare(b.taskId));
  const edges: MaterialsDagEdge[] = [];
  for (const task of workflow.tasks) {
    for (const dependency of task.dependencies) edges.push({ from: dependency, to: task.taskId, missing: missingIds.has(dependency) });
  }
  const layers = Array.from({ length: Math.max(1, ...nodes.map((node) => node.layer + 1)) }, () => [] as MaterialsDagNode[]);
  for (const node of nodes) layers[node.layer].push(node);
  const maxLayerSize = Math.max(1, ...layers.map((items) => items.length));
  return {
    nodes,
    edges,
    layers,
    width: Math.max(1, layers.length) * 230,
    height: Math.max(1, maxLayerSize) * 126,
  };
}

export function isTerminalMaterialsTask(status: MaterialsTaskStatus): boolean {
  return TERMINAL_STATUS.includes(status);
}
