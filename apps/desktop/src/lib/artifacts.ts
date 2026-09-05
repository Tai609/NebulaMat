// Turn the agent's file-writing tool calls into traceable artifacts.
// Pure and transport-agnostic so it can be unit-tested without a live runtime.

import type { ToolUpdatedEvent } from "@ai4s/sdk";
import type {
  ArtifactBlock,
  ArtifactInspector,
  ArtifactKind,
  ArtifactVersion,
  FilePreviewInspector,
  NotebookFileInspector,
} from "@ai4s/shared";
import { stableEventId, stableHash } from "@ai4s/shared";
import { isMaterialsProjectId } from "@/lib/crystal";

const EXT_KIND: Record<string, ArtifactKind> = {
  png: "figure", jpg: "figure", jpeg: "figure", gif: "figure", webp: "figure", svg: "figure",
  fits: "figure", fit: "figure", fts: "figure",
  mp4: "figure", webm: "figure", mov: "figure", m4v: "figure", ogv: "figure",
  py: "script", r: "script", jl: "script", sh: "script",
  ipynb: "notebook",
  pdf: "report", tex: "report", md: "report", docx: "report", pptx: "report",
  csv: "table", tsv: "table", parquet: "table", xlsx: "table",
  mol: "data", sdf: "data", smi: "data", smiles: "data",
  bed: "data", bedgraph: "data", bdg: "data", gff: "data", gff3: "data", gtf: "data", vcf: "data",
  stl: "model", obj: "model", ply: "model", gltf: "model", glb: "model",
  dos: "data", qcode: "data", anom: "figure", eigenval: "data", phase: "figure",
};

const EXT_LANG: Record<string, string> = {
  py: "python", r: "r", jl: "julia", sh: "bash",
  tex: "latex", md: "markdown", csv: "plaintext", tsv: "plaintext",
};

/** Tools whose input names a file path we can surface as an artifact. */
const WRITE_TOOLS = new Set(["write", "edit", "create", "str_replace_editor", "apply_patch"]);

/** Input keys that carry the target file path, in priority order. */
const PATH_KEYS = ["filePath", "path", "file", "filename", "file_path"];
/** Input keys that carry the written text content. */
const CONTENT_KEYS = ["content", "new_str", "text"];

export type ArtifactPanelPlacement = "right" | "bottom";
export type ArtifactPanelTarget = "current-screen" | "new-screen" | "new-session";

export interface ArtifactPresentation {
  artifact: ArtifactBlock;
  display: "inline" | "panel";
  /** Undefined when the call named no placement — the host then keeps an already
   *  open panel where it is instead of yanking it back to the default side. */
  placement?: ArtifactPanelPlacement;
  target: ArtifactPanelTarget;
}

export function extToKind(ext: string): ArtifactKind {
  return EXT_KIND[ext.toLowerCase()] ?? "data";
}

/** Extensions we treat as workspace artifacts worth surfacing/previewing. */
const REF_EXTS = [
  "pdf", "html", "htm", "svg", "png", "jpg", "jpeg", "gif", "webp",
  "csv", "tsv", "md", "tex", "json", "py", "ipynb", "r",
  "docx", "xlsx", "pptx",
  "mp4", "webm", "mov", "m4v",
  "mol", "mol2", "sdf", "smi", "smiles", "cif", "mcif", "mmcif", "poscar", "vasp", "xdatcar", "lammpstrj", "dump", "extxyz", "pdb", "pqr", "xyz", "cube",
  "bed", "bedgraph", "bdg", "gff", "gff3", "gtf", "vcf",
  "stl", "obj", "ply", "gltf", "glb",
];
// \p{L}\p{N} instead of \w: research deliverables are routinely named in the
// user's language (青云录_剧情.docx), and ASCII-only \w silently drops every
// such mention — no chip, no way to open the file from the conversation.
const REF_RE = new RegExp(
  `[\\p{L}\\p{N}_./-]+\\.(?:${REF_EXTS.join("|")})(?![\\p{L}\\p{N}_])`,
  "giu",
);

/**
 * Extract workspace file paths mentioned in an agent message so a file produced by
 * running code (e.g. `canvas-project/canvas.pdf` from a python run) becomes clickable,
 * not just prose. Strips surrounding backticks/quotes; dedupes; ignores URLs.
 */
export function extractArtifactRefs(markdown: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(REF_RE)) {
    const raw = m[0].replace(/^[`'"(]+|[`'".,)]+$/g, "");
    if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith("//")) continue;
    // Require a path-like token or a known ext; skip bare "a.md" sentence fragments only if no slash.
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  // Materials Project ids are virtual records rather than workspace files, but
  // they still deserve the same clickable preview affordance in an agent answer.
  for (const match of markdown.matchAll(/(?<![A-Za-z0-9_-])(mp-\d+)(?![A-Za-z0-9_-])/gi)) {
    const id = match[1].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  html: "text/html", htm: "text/html",
  svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
  csv: "text/csv", tsv: "text/tab-separated-values",
  md: "text/markdown", tex: "text/x-tex", json: "application/json",
  py: "text/x-python", r: "text/x-r", txt: "text/plain",
  bed: "text/plain", bedgraph: "text/plain", bdg: "text/plain",
  gff: "text/plain", gff3: "text/plain", gtf: "text/plain", vcf: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function mimeForExt(ext: string): string {
  return MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Virtual Materials Project records are previewed without a workspace file. */
export type PreviewKind =
  | "html"
  | "pdf"
  | "image"
  | "video"
  | "table"
  | "markdown"
  | "text"
  | "docx"
  | "xlsx"
  | "pptx"
  | "molecule"
  | "mesh"
  | "genome"
  | "fits"
  | "dos"
  | "qcode"
  | "anomaly"
  | "bands"
  | "phase"
  | "crystal";

/** 3D mesh / CAD formats rendered by the three.js viewer. */
export const MESH_EXTS = ["stl", "obj", "ply", "gltf", "glb"];

/** FITS astronomy formats rendered by the native FITS viewer. */
export const FITS_EXTS = ["fits", "fit", "fts"];

/** How a file should be previewed, from its extension. This is the previewer
 *  registry: native webview viewers first (pdf/html/image via the local file
 *  server), lightweight JS renderers second (csv table, docx/xlsx/pptx via
 *  lazy-loaded local renderers), code/text fallback. */
export function previewKind(ext: string): PreviewKind {
  const e = ext.toLowerCase();
  if (e === "html" || e === "htm") return "html";
  if (e === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "image";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(e)) return "video";
  if (e === "csv" || e === "tsv") return "table";
  if (e === "md" || e === "markdown") return "markdown";
  if (e === "docx" || e === "xlsx" || e === "pptx") return e;
  if (MESH_EXTS.includes(e)) return "mesh";
  if (FITS_EXTS.includes(e)) return "fits";
  if (e === "dos") return "dos";
  if (e === "qcode") return "qcode";
  if (e === "anom") return "anomaly";
  if (e === "eigenval") return "bands";
  if (e === "phase") return "phase";
  if (["cif", "mcif", "mmcif", "poscar", "vasp", "xdatcar", "lammpstrj", "dump", "extxyz"].includes(e)) return "crystal";
  if (["mol", "mol2", "sdf", "smi", "smiles", "pdb", "pqr", "xyz", "cube"].includes(e))
    return "molecule";
  if (["bed", "bedgraph", "bdg", "gff", "gff3", "gtf", "vcf"].includes(e)) return "genome";
  return "text";
}

/** Some scientific tools use fixed, extensionless filenames (VASP DOSCAR, …).
 *  Prefer a name match, else fall back to the extension registry. */
export function previewKindForName(filename: string): PreviewKind {
  const base = (filename.split(/[\\/]/).pop() ?? filename).toLowerCase();
  if (isMaterialsProjectId(base)) return "crystal";
  if (base === "doscar" || base.startsWith("doscar.")) return "dos";
  if (base === "eigenval" || base.startsWith("eigenval.")) return "bands";
  if (["poscar", "contcar", "xdatcar"].includes(base)) return "crystal";
  if (["outcar", "vasprun.xml", "chgcar", "locpot"].includes(base)) return "text";
  return previewKind(extOf(filename));
}

/** Build a previewable file-inspector from an artifact surfaced in the thread. */
export function fileInspectorFromBlock(
  a: ArtifactBlock,
): FilePreviewInspector | NotebookFileInspector {
  // Notebooks open in the runnable editor, not the raw-JSON preview.
  if (extOf(a.filename) === "ipynb") return { variant: "notebook-file", path: a.path };
  return {
    variant: "file",
    path: a.path,
    filename: a.filename,
    artifact: a.artifact,
    language: a.language ?? EXT_LANG[extOf(a.filename)],
    content: a.content,
  };
}

/** A minimal artifact block for a file referenced in prose (path only, no inline content). */
export function refToArtifactBlock(path: string): ArtifactBlock {
  const filename = path.split(/[\\/]/).pop() || path;
  return {
    kind: "artifact",
    path,
    filename,
    artifact: extToKind(extOf(filename)),
    tool: "output",
    hash: stableHash({ path }),
    eventId: stableEventId("artifact", { path, tool: "output" }),
    language: EXT_LANG[extOf(filename)],
  };
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Derive an artifact from a completed file-writing tool call, or `null` when the
 * event is not a successful write we can trace to a path.
 */
export function deriveArtifact(event: ToolUpdatedEvent): ArtifactBlock | null {
  if (event.status !== "success") return null;
  const tool = (event.tool ?? "").toLowerCase();
  const input = event.input ?? {};

  // Jupyter MCP tools name the notebook they operate on — surface it live.
  if (tool.includes("jupyter")) {
    const nb = firstString(input, ["notebook_path", "path", "document_id"]);
    if (!nb || !nb.endsWith(".ipynb")) return null;
    const filename = nb.split(/[\\/]/).pop() || nb;
    return {
      kind: "artifact",
      path: nb,
      filename,
      artifact: "notebook",
      tool: event.tool,
      hash: stableHash({ path: nb, tool: event.tool, input }),
      eventId: event.eventId ?? stableEventId("artifact", { path: nb, callId: event.callId, tool: event.tool }),
    };
  }

  if (!WRITE_TOOLS.has(tool)) return null;

  const path = firstString(input, PATH_KEYS);
  if (!path) return null;

  const filename = path.split(/[\\/]/).pop() || path;
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1) : "";

  return {
    kind: "artifact",
    path,
    filename,
    artifact: extToKind(ext),
    tool: event.tool,
    hash: stableHash({ path, content: input[CONTENT_KEYS.find((key) => typeof input[key] === "string") ?? ""] ?? null, diff: event.diff ?? null, tool: event.tool }),
    eventId: event.eventId ?? stableEventId("artifact", { path, callId: event.callId, tool: event.tool }),
    content: firstString(input, CONTENT_KEYS),
    language: EXT_LANG[ext.toLowerCase()],
  };
}

/** Parse the app-owned `present_artifact` tool call into a host presentation
 *  request. The tool validates file existence and workspace containment before
 *  a success event can reach this function. */
export function deriveArtifactPresentation(event: ToolUpdatedEvent): ArtifactPresentation | null {
  if (event.tool !== "present_artifact" || event.status !== "success") return null;
  const path = firstString(event.input ?? {}, ["path"]);
  const display = firstString(event.input ?? {}, ["display"]);
  if (!path || (display !== "inline" && display !== "panel")) return null;
  const filename = path.split(/[\\/]/).pop() || path;
  const title = firstString(event.input ?? {}, ["title"]);
  const requestedPlacement = firstString(event.input ?? {}, ["placement"]);
  const placement: ArtifactPanelPlacement | undefined =
    requestedPlacement === "bottom" || requestedPlacement === "right"
      ? requestedPlacement
      : undefined;
  const requestedTarget = firstString(event.input ?? {}, ["target"]);
  const target: ArtifactPanelTarget =
    requestedTarget === "new-screen" || requestedTarget === "new-session"
      ? requestedTarget
      : "current-screen";
  return {
    artifact: {
      kind: "artifact",
      path,
      filename,
      artifact: extToKind(extOf(filename)),
      tool: event.tool,
      language: EXT_LANG[extOf(filename)],
      presentation: {
        mode: display,
        requestId: event.callId,
        ...(title ? { title } : {}),
      },
    },
    display,
    ...(placement ? { placement } : {}),
    target,
  };
}

/** One file section parsed out of an apply_patch `patchText`. */
export interface PatchFile {
  path: string;
  op: "add" | "update" | "delete";
  /** The section body verbatim: `+`-prefixed lines for an add, diff hunks for an update. */
  body: string;
}

const PATCH_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+?)\s*$/;
const PATCH_MOVE = /^\*\*\* Move to: (.+?)\s*$/;

/**
 * Split an apply_patch `patchText` into its per-file sections. apply_patch names
 * each target *inside* the patch body (`*** Update File: <path>`) rather than in a
 * path field, and a single call can touch many files — so a caller that records
 * one path per event silently drops every file. Parsing here lets provenance fan
 * out to one record per file.
 */
export function parsePatchFiles(patchText: string): PatchFile[] {
  const files: PatchFile[] = [];
  let path: string | null = null;
  let op: PatchFile["op"] = "update";
  let lines: string[] = [];
  const flush = () => {
    if (path !== null) files.push({ path, op, body: lines.join("\n") });
    path = null;
    lines = [];
  };
  for (const line of patchText.split("\n")) {
    const h = PATCH_HEADER.exec(line);
    if (h) {
      flush();
      op = h[1].toLowerCase() as PatchFile["op"];
      path = h[2];
      continue;
    }
    if (path === null) continue; // preamble before the first file (e.g. "*** Begin Patch")
    if (line.startsWith("*** End Patch")) break;
    const mv = PATCH_MOVE.exec(line);
    if (mv) {
      path = mv[1]; // a rename — attribute the change to its destination
      continue;
    }
    lines.push(line);
  }
  flush();
  return files;
}

/** Resolve the content shown for the active version, falling back to inspector-level fields. */
export function resolveArtifactContent(
  data: ArtifactInspector,
  activeLabel: string,
): {
  code: string;
  executionLog?: string;
  messages?: string[];
  environment?: string;
  reviewPassed?: boolean;
} {
  const v: ArtifactVersion | undefined = data.versions.find((x) => x.label === activeLabel);
  return {
    code: v?.code ?? data.code,
    executionLog: v?.executionLog ?? data.executionLog,
    messages: v?.messages ?? data.messages,
    environment: v?.environment ?? data.environment,
    reviewPassed: v?.reviewPassed ?? data.reviewPassed,
  };
}

/** Build an inspector view for an artifact surfaced live in the thread. */
export function artifactBlockToInspector(a: ArtifactBlock): ArtifactInspector {
  const hasText = typeof a.content === "string";
  return {
    variant: "artifact",
    title: a.filename,
    filename: a.filename,
    versions: [{ label: "v1" }],
    activeVersion: "v1",
    inputs: [],
    language: a.language ?? "plaintext",
    code: hasText
      ? (a.content as string)
      : `# ${a.filename}\n# Binary artifact (${a.artifact}) written to ${a.path}.\n# Open it from the workspace to view.`,
    executionLog: `wrote ${a.path} · via ${a.tool}`,
  };
}
