import type { ArtifactBlock, ThreadBlock } from "@ai4s/shared";
import { extOf, refToArtifactBlock } from "./artifacts";
import { listDir, type DirEntry } from "./artifactFile";

export type StructureStepPhase = "input" | "prepared" | "relaxed" | "trajectory" | "output";
export type StructureStepSource = "uploaded" | "generated" | "calculation";

export interface StructureWorkflowStep {
  id: string;
  path: string;
  filename: string;
  phase: StructureStepPhase;
  source: StructureStepSource;
  artifact: ArtifactBlock;
}

const STRUCTURE_EXTENSIONS = new Set([
  "cif",
  "mcif",
  "mmcif",
  "poscar",
  "vasp",
  "xdatcar",
  "lammpstrj",
  "dump",
  "extxyz",
]);
const FIXED_STRUCTURE_NAMES = new Set(["poscar", "contcar", "xdatcar"]);
const CALCULATION_RE = /\b(?:dft|vasp|cp2k|quantum\s*espresso|qe|lammps|gromacs|aimd|molecular\s+dynamics|geometry\s+optimi[sz]ation|relaxation)\b|密度泛函|第一性原理|分子动力学|结构优化|几何优化|弛豫/iu;
const PATH_TOKEN_RE = /(?:^|[\s`'"(（:：,，;；])([^\s`'"()（）,，;；]+(?:\.cif|\.mcif|\.mmcif|\.poscar|\.vasp|\.xdatcar|\.lammpstrj|\.dump|\.extxyz|\/POSCAR|\/CONTCAR|\/XDATCAR|\\POSCAR|\\CONTCAR|\\XDATCAR)|POSCAR|CONTCAR|XDATCAR)(?=$|[\s`'"()（）,，;；.。])/giu;

export function isStructurePath(path: string): boolean {
  const filename = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return FIXED_STRUCTURE_NAMES.has(filename) || STRUCTURE_EXTENSIONS.has(extOf(filename));
}

/** Absolute paths mentioned by the agent may refer to a result in another
 * workspace under the configured base. The native file API still enforces
 * that base boundary before reading the file. */
export function isAbsoluteStructurePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path.trim());
}

export function isComputationalMaterialsThread(blocks: readonly ThreadBlock[]): boolean {
  return blocks.some((block) => CALCULATION_RE.test(searchableText(block)));
}

export function structurePhase(path: string): StructureStepPhase {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const filename = normalized.split("/").pop() ?? normalized;
  if (filename === "xdatcar" || ["xdatcar", "lammpstrj", "dump"].includes(extOf(filename))
    || /^trajectory(?:-preview)?\.extxyz$/.test(filename)) return "trajectory";
  if (/\/seed-\d+\/final\.extxyz$/.test(normalized)) return "output";
  if (filename === "contcar" || /(?:relax|optim|final)/.test(filename)) return "relaxed";
  if (/(?:prep|prepared|generated|built|mattergen|structures?\/)/.test(normalized)) return "prepared";
  if (filename === "poscar" || ["cif", "mcif", "mmcif", "poscar", "vasp"].includes(extOf(filename))) return "input";
  if (/(?:result|output)/.test(normalized)) return "output";
  return "output";
}

export function collectStructureWorkflowSteps(
  blocks: readonly ThreadBlock[],
  discoveredPaths: readonly string[] = [],
): StructureWorkflowStep[] {
  const candidates = new Map<string, { artifact: ArtifactBlock; source: StructureStepSource }>();
  const add = (artifact: ArtifactBlock, source: StructureStepSource) => {
    const resolved = resolveDiscoveredAlias(artifact.path, discoveredPaths);
    const normalizedArtifact = resolved === artifact.path
      ? artifact
      : {
          ...artifact,
          path: resolved,
          filename: resolved.split(/[\\/]/).pop() ?? artifact.filename,
        };
    if (!isStructurePath(normalizedArtifact.path || normalizedArtifact.filename)) return;
    const key = normalizePath(normalizedArtifact.path);
    const previous = candidates.get(key);
    if (!previous || sourcePriority(source) > sourcePriority(previous.source)) {
      candidates.set(key, { artifact: normalizedArtifact, source });
    }
  };

  for (const block of blocks) {
    if (block.kind === "artifact") {
      add(block, block.tool === "output" ? "calculation" : "generated");
      continue;
    }
    if (block.kind === "tool-call") {
      if (block.filePath && isStructurePath(block.filePath)) {
        add(refToArtifactBlock(block.filePath), block.verb === "Created" || block.verb === "Edited" ? "generated" : "calculation");
      }
      for (const path of extractStructurePaths([block.title, block.command, block.output].filter(Boolean).join("\n"))) {
        add(refToArtifactBlock(path), "calculation");
      }
      continue;
    }
    if (block.kind === "user") {
      for (const path of extractStructurePaths(block.text)) add(refToArtifactBlock(path), "uploaded");
      continue;
    }
    if (block.kind === "agent") {
      for (const path of extractStructurePaths(block.markdown)) add(refToArtifactBlock(path), "calculation");
    }
  }

  for (const path of discoveredPaths) add(refToArtifactBlock(path), inferSource(path));

  const previewDirectories = new Set(
    [...candidates.values()]
      .filter(({ artifact }) => /(?:^|[\\/])trajectory-preview\.extxyz$/i.test(artifact.path))
      .map(({ artifact }) => normalizePath(artifact.path).replace(/\/trajectory-preview\.extxyz$/, "")),
  );

  return [...candidates.values()]
    .filter(({ artifact }) => {
      if (!/(?:^|[\\/])trajectory\.extxyz$/i.test(artifact.path)) return true;
      return !previewDirectories.has(normalizePath(artifact.path).replace(/\/trajectory\.extxyz$/, ""));
    })
    .map(({ artifact, source }) => ({
      id: normalizePath(artifact.path),
      path: artifact.path,
      filename: artifact.filename,
      phase: structurePhase(artifact.path),
      source,
      artifact,
    }))
    .sort(compareSteps);
}

/** Bounded workspace scan used after a computational turn fetches remote outputs. */
export async function discoverStructurePaths(
  readDir: (path: string) => Promise<DirEntry[]> = (path) => listDir(path),
  maxDepth = 7,
  maxEntries = 2_000,
  maxConcurrency = 8,
): Promise<string[]> {
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  const found = new Set<string>();
  let visited = 0;
  // Directory APIs are remote/IPC-bound in the desktop build. Read a bounded
  // batch of directories at once; a worker loop that exits when the initial
  // queue is empty is effectively serial because the root is the only initial
  // item and its children are discovered after the other workers have quit.
  const concurrency = Math.max(1, Math.min(maxConcurrency, maxEntries));
  while (queue.length > 0 && visited < maxEntries) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.all(
      batch.map(async (current) => ({
        current,
        entries: await readDir(current.path).catch(() => []),
      })),
    );
    for (const { current, entries } of results) {
      for (const entry of entries) {
        if (visited >= maxEntries) break;
        visited += 1;
        if (entry.isDir && current.depth < maxDepth) {
          queue.push({ path: entry.path, depth: current.depth + 1 });
        } else if (!entry.isDir && isStructurePath(entry.path)) {
          found.add(entry.path);
        }
      }
    }
  }
  return [...found];
}

export function extractStructurePaths(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(PATH_TOKEN_RE)) {
    const path = match[1]?.replace(/^[`'"(（]+|[`'"）).。]+$/g, "");
    if (!path || !isStructurePath(path)) continue;
    const key = normalizePath(path);
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(path);
    }
  }
  return paths;
}

function searchableText(block: ThreadBlock): string {
  if (block.kind === "user") return block.text;
  if (block.kind === "agent") return block.markdown;
  if (block.kind === "tool-call") return [block.title, block.command, block.filePath, block.output].filter(Boolean).join("\n");
  return "";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/**
 * A transcript often mentions a structure by basename (`POSCAR`) while the
 * directory scan already knows its real relative path (`runs/01/POSCAR`).
 * Reuse that exact path so the native reader does not perform a second bounded
 * recursive basename search when the preview opens.
 */
function resolveDiscoveredAlias(path: string, discoveredPaths: readonly string[]): string {
  const normalized = normalizePath(path);
  const exact = discoveredPaths.find((candidate) => normalizePath(candidate) === normalized);
  if (exact) return exact;
  if (normalized.includes("/")) return path;
  const matches = discoveredPaths.filter((candidate) => {
    const candidateNormalized = normalizePath(candidate);
    return candidateNormalized.split("/").pop() === normalized;
  });
  return matches.length === 1 ? matches[0] : path;
}

function sourcePriority(source: StructureStepSource): number {
  return source === "uploaded" ? 3 : source === "generated" ? 2 : 1;
}

function inferSource(path: string): StructureStepSource {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (!normalized.includes("/")) return "uploaded";
  if (/(?:generated|built|prep|mattergen|structures?\/)/.test(normalized)) return "generated";
  return "calculation";
}

function compareSteps(a: StructureWorkflowStep, b: StructureWorkflowStep): number {
  const phaseOrder: Record<StructureStepPhase, number> = {
    input: 0,
    prepared: 1,
    relaxed: 2,
    trajectory: 3,
    output: 4,
  };
  const phase = phaseOrder[a.phase] - phaseOrder[b.phase];
  if (phase !== 0) return phase;
  return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" });
}
