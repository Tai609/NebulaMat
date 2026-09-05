import {
  canTransition,
  canTransitionMaterialsDesign,
  dftCacheKey,
  stableEventId,
  stableHash,
  type DFTWorkflowCheckpoint,
  type DFTWorkflowStage,
  type MaterialsDesignCheckpoint,
  type MaterialsDesignStage,
} from "@ai4s/shared";

const CACHE_PREFIX = "openscience.dft.cache.";
const CHECKPOINT_PREFIX = "openscience.dft.checkpoint.";
const MATERIALS_CHECKPOINT_PREFIX = "openscience.materials.checkpoint.";

export interface DftCacheRecord<T = unknown> {
  key: string;
  createdAt: number;
  output: T;
  sourceRunId?: string;
  verified: boolean;
}

export function buildDftCacheKey(input: Parameters<typeof dftCacheKey>[0]): string {
  return dftCacheKey(input);
}

export function readDftCache<T>(key: string): DftCacheRecord<T> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) as DftCacheRecord<T> : null;
  } catch {
    return null;
  }
}

export function writeDftCache<T>(record: DftCacheRecord<T>): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${record.key}`, JSON.stringify(record));
  } catch {
    // Cache pressure or private browsing must never block a scientific run.
  }
}

export function checkpointKey(workflowId: string): string {
  return `${CHECKPOINT_PREFIX}${workflowId}`;
}

export function readDftCheckpoint(workflowId: string): DFTWorkflowCheckpoint | null {
  try {
    const raw = localStorage.getItem(checkpointKey(workflowId));
    return raw ? JSON.parse(raw) as DFTWorkflowCheckpoint : null;
  } catch {
    return null;
  }
}

export function writeDftCheckpoint(
  workflowId: string,
  stage: DFTWorkflowStage,
  taskId: string,
  inputKey: string,
  resumable = true,
  reason?: string,
): DFTWorkflowCheckpoint {
  const previous = readDftCheckpoint(workflowId);
  if (previous?.stage === stage && previous.inputHash === inputKey && previous.taskId === taskId) return previous;
  if (previous && !canTransition(previous.stage, stage)) {
    throw new Error(`Invalid DFT checkpoint transition: ${previous.stage} -> ${stage}`);
  }
  const updatedAt = Date.now();
  const base = { workflowId, stage, ...(previous ? { previousStage: previous.stage } : {}), taskId, inputHash: inputKey, updatedAt, resumable, ...(reason ? { reason } : {}) };
  const checkpoint: DFTWorkflowCheckpoint = {
    ...base,
    schemaVersion: 1,
    hash: stableHash(base),
    eventId: stableEventId("dft-checkpoint", base),
  };
  try {
    localStorage.setItem(checkpointKey(workflowId), JSON.stringify(checkpoint));
  } catch {
    // See writeDftCache: checkpoint persistence is opportunistic in web mode.
  }
  return checkpoint;
}

function materialsCheckpointKey(workflowId: string): string {
  return `${MATERIALS_CHECKPOINT_PREFIX}${workflowId}`;
}

function isMaterialsDesignStage(value: unknown): value is MaterialsDesignStage {
  return typeof value === "string" && value.startsWith("materials.") && [
    "materials.goal",
    "materials.evidence",
    "materials.hypothesis",
    "materials.synthesis",
    "materials.experiment",
    "materials.interpretation",
  ].includes(value);
}

export function readMaterialsCheckpoint(workflowId: string): MaterialsDesignCheckpoint | null {
  try {
    const raw = localStorage.getItem(materialsCheckpointKey(workflowId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MaterialsDesignCheckpoint>;
    return value.workflowId === workflowId && isMaterialsDesignStage(value.stage) && typeof value.hash === "string" && typeof value.eventId === "string"
      ? value as MaterialsDesignCheckpoint
      : null;
  } catch {
    return null;
  }
}

export function writeMaterialsCheckpoint(
  workflowId: string,
  stage: MaterialsDesignStage,
  taskId: string,
  inputKey: string,
  resumable = true,
  reason?: string,
): MaterialsDesignCheckpoint {
  const previous = readMaterialsCheckpoint(workflowId);
  if (previous?.stage === stage && previous.inputHash === inputKey && previous.taskId === taskId) return previous;
  if (previous && !canTransitionMaterialsDesign(previous.stage, stage)) {
    throw new Error(`Invalid materials checkpoint transition: ${previous.stage} -> ${stage}`);
  }
  const updatedAt = Date.now();
  const base = {
    schemaVersion: 1,
    workflowId,
    stage,
    ...(previous ? { previousStage: previous.stage } : {}),
    taskId,
    inputHash: inputKey,
    updatedAt,
    resumable,
    ...(reason ? { reason } : {}),
  };
  const checkpoint: MaterialsDesignCheckpoint = {
    ...base,
    hash: stableHash(base),
    eventId: stableEventId("materials-checkpoint", base),
  };
  try {
    localStorage.setItem(materialsCheckpointKey(workflowId), JSON.stringify(checkpoint));
  } catch {
    // Browser storage is a resume hint; the authoritative record is the
    // workspace artifact written by the desktop/Rust provenance path.
  }
  return checkpoint;
}
