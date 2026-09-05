/** InnoClaw-compatible research workbench contracts.
 *
 * These helpers deliberately convert workbench outputs into CEBRO nodes. The
 * workbench may collect and format evidence, but it never becomes a second
 * source of claim truth.
 */
import { stableHash } from "./dft";
import type {
  ResearchArtifactNode,
  ResearchEvidenceNode,
  ResearchEvidenceRelation,
  ResearchGraph,
  ResearchReport,
} from "./research";

export type InnoClawRetrievalStatus =
  | "success"
  | "partial"
  | "failed_retrieval"
  | "insufficient_evidence"
  | "empty";

export interface InnoClawSourceEntry {
  title: string;
  url?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
}

export interface InnoClawRawExcerpt {
  text: string;
  sourceIndex: number;
  section?: string;
}

export interface InnoClawEvidenceCard {
  id: string;
  query: string;
  sources: InnoClawSourceEntry[];
  rawExcerpts: InnoClawRawExcerpt[];
  retrievalStatus: InnoClawRetrievalStatus;
  sourcesFound: number;
  sourcesAttempted: number;
  retrievalNotes?: string;
  createdAt?: string;
  /** Optional provider/model identity used for independence diagnostics. */
  sourceFamily?: string;
  modelFamily?: string;
  codeFamily?: string;
}

export interface InnoClawEvidenceConversionOptions {
  actionId: string;
  branchId: string;
  now?: number;
  relation?: ResearchEvidenceRelation;
  source?: string;
}

export interface InnoClawEvidenceNodes {
  artifact: ResearchArtifactNode;
  evidence: ResearchEvidenceNode;
}

export interface InnoClawContextArchive {
  schemaVersion: 1;
  researchId: string;
  graphHash: string;
  generatedAt: number;
  sourceArtifactIds: string[];
  entries: Array<{
    nodeId: string;
    branchId: string;
    kind: string;
    text: string;
    sourceRefs?: string[];
    contentHash?: string;
  }>;
  hash: string;
}

const RETRIEVAL_STATUSES: readonly InnoClawRetrievalStatus[] = [
  "success",
  "partial",
  "failed_retrieval",
  "insufficient_evidence",
  "empty",
];

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function bounded(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  return value;
}

/** Validate the heterogeneous card produced by an InnoClaw-style provider. */
export function validateInnoClawEvidenceCard(card: InnoClawEvidenceCard): InnoClawEvidenceCard {
  nonEmpty(card.id, "evidence card id");
  nonEmpty(card.query, "evidence card query");
  if (!Array.isArray(card.sources) || !Array.isArray(card.rawExcerpts)) throw new Error("evidence card sources and excerpts are required");
  if (!RETRIEVAL_STATUSES.includes(card.retrievalStatus)) throw new Error("evidence card retrievalStatus is invalid");
  if (!Number.isInteger(card.sourcesFound) || card.sourcesFound < 0) throw new Error("evidence card sourcesFound is invalid");
  if (!Number.isInteger(card.sourcesAttempted) || card.sourcesAttempted < 0) throw new Error("evidence card sourcesAttempted is invalid");
  card.sources.forEach((source, index) => nonEmpty(source.title, `evidence card source ${index} title`));
  card.rawExcerpts.forEach((excerpt, index) => {
    nonEmpty(excerpt.text, `evidence card excerpt ${index} text`);
    if (!Number.isInteger(excerpt.sourceIndex) || excerpt.sourceIndex < 0 || excerpt.sourceIndex >= card.sources.length) {
      throw new Error(`evidence card excerpt ${index} sourceIndex is invalid`);
    }
  });
  if (card.sourcesFound < card.sources.length) throw new Error("evidence card sourcesFound cannot be below the returned source list");
  if (card.sourcesAttempted < card.sourcesFound) throw new Error("evidence card sourcesAttempted cannot be below sourcesFound");
  return card;
}

function cardSummary(card: InnoClawEvidenceCard): string {
  const excerpt = card.rawExcerpts.find((item) => item.text.trim())?.text.trim();
  const coverage = `${card.sourcesFound}/${card.sourcesAttempted} sources retrieved`;
  return [
    `InnoClaw evidence card for query: ${card.query}`,
    coverage,
    card.retrievalNotes?.trim(),
    excerpt ? `Representative excerpt: ${excerpt.slice(0, 1200)}` : undefined,
  ].filter(Boolean).join("\n");
}

/** Convert one evidence card into an auditable artifact plus one CEBRO record. */
export function innoClawEvidenceCardToResearchNodes(
  input: InnoClawEvidenceCard,
  options: InnoClawEvidenceConversionOptions,
): InnoClawEvidenceNodes {
  const card = validateInnoClawEvidenceCard(input);
  const now = options.now ?? Date.now();
  const artifactId = `${options.actionId}:artifact:evidence-card`;
  const evidenceId = `${options.actionId}:evidence:literature`;
  const cardHash = stableHash(card);
  const sourceRefs = card.sources.flatMap((source) => [
    source.url,
    source.doi ? `doi:${source.doi}` : undefined,
    source.pmid ? `pmid:${source.pmid}` : undefined,
    source.arxivId ? `arxiv:${source.arxivId}` : undefined,
  ].filter((value): value is string => Boolean(value && value.trim())));
  if (sourceRefs.length === 0) sourceRefs.push(`innoclaw-card:${card.id}`);

  const artifact: ResearchArtifactNode = {
    id: artifactId,
    kind: "artifact",
    label: `Evidence Card: ${card.query}`,
    branchId: options.branchId,
    createdAt: now,
    artifactType: "data",
    locator: `cebro://evidence-card/${encodeURIComponent(card.id)}`,
    contentHash: cardHash,
    reproducibility: { inputs: [options.actionId], environment: "innoclaw:evidence-card:v1" },
    metadata: {
      format: "innoclaw-evidence-card",
      card,
      ...(options.source ? { source: options.source } : {}),
    },
  };

  const relation = options.relation ?? (card.retrievalStatus === "success" ? "qualifies" : "inconclusive");
  const qualityPenalty = card.retrievalStatus === "success" ? 1 : card.retrievalStatus === "partial" ? 0.75 : 0.35;
  const strength = bounded(Math.min(1, qualityPenalty * Math.min(1, card.sourcesFound / Math.max(card.sourcesAttempted, 1))), "evidence strength");
  const evidence: ResearchEvidenceNode = {
    id: evidenceId,
    kind: "evidence",
    label: `Literature: ${card.query}`,
    branchId: options.branchId,
    createdAt: now,
    evidenceKind: "literature",
    summary: cardSummary(card),
    relation,
    strength,
    uncertainty: card.retrievalNotes ?? `Retrieval status: ${card.retrievalStatus}`,
    sourceRefs,
    artifactIds: [artifact.id],
    contentHash: cardHash,
    independent: false,
    sourceFamily: card.sourceFamily ?? `innoclaw-card:${card.id}`,
    ...(card.modelFamily ? { modelFamily: card.modelFamily } : {}),
    ...(card.codeFamily ? { codeFamily: card.codeFamily } : {}),
    epistemicLevel: "literature",
  };
  return { artifact, evidence };
}

/** Persisted context archives are derived indexes, never evidence by default. */
export function createInnoClawContextArchiveArtifact(input: {
  id: string;
  branchId: string;
  locator: string;
  contentHash: string;
  sourceArtifactIds: string[];
  now?: number;
  summary?: string;
}): ResearchArtifactNode {
  return {
    id: input.id,
    kind: "artifact",
    label: "InnoClaw context archive",
    branchId: input.branchId,
    createdAt: input.now ?? Date.now(),
    artifactType: "data",
    locator: nonEmpty(input.locator, "context archive locator"),
    contentHash: nonEmpty(input.contentHash, "context archive contentHash"),
    reproducibility: { inputs: [...input.sourceArtifactIds], environment: "innoclaw:context-archive:v1" },
    metadata: {
      format: "innoclaw-context-archive",
      derived: true,
      sourceArtifactIds: [...input.sourceArtifactIds],
      ...(input.summary ? { summary: input.summary } : {}),
    },
  };
}

/** Build a disposable retrieval index from the graph. The archive records the
 * source graph hash and node identities, and has no evidence conversion path. */
export function buildInnoClawContextArchive(graph: ResearchGraph, now = Date.now()): InnoClawContextArchive {
  const entries = graph.nodes.map((node) => {
    const text = node.kind === "claim" || node.kind === "hypothesis"
      ? node.statement
      : node.kind === "action"
        ? node.objective
        : node.kind === "evidence"
          ? node.summary
          : node.kind === "artifact"
            ? `${node.label}\n${node.locator}`
            : `${node.premise}\n${node.predictedObservation}`;
    return {
      nodeId: node.id,
      branchId: node.branchId,
      kind: node.kind,
      text,
      ...(node.kind === "evidence" ? { sourceRefs: [...node.sourceRefs] } : {}),
      ...((node.kind === "evidence" || node.kind === "artifact") && node.contentHash ? { contentHash: node.contentHash } : {}),
    };
  });
  const sourceArtifactIds = graph.nodes.filter((node) => node.kind === "artifact").map((node) => node.id);
  const base = {
    schemaVersion: 1 as const,
    researchId: graph.researchId,
    graphHash: graph.hash,
    generatedAt: now,
    sourceArtifactIds,
    entries,
  };
  return { ...base, hash: stableHash(base) };
}

/** Render only the facts allowed by CEBRO readiness; this is a template, not a
 * second claim evaluator. A later model pass may polish this text but must keep
 * the readiness and blocker fields intact. */
export function renderInnoClawResearchReport(report: ResearchReport, options: { generatedBy?: string } = {}): string {
  const lines = [
    `# ${report.title}`,
    "",
    `Objective: ${report.objective}`,
    `Research ID: ${report.researchId}`,
    `Graph hash: ${report.graphHash}`,
    options.generatedBy ? `Generated by: ${options.generatedBy}` : undefined,
    "",
    "## Claim Readiness",
  ].filter((line): line is string => Boolean(line));

  for (const claim of report.claims) {
    lines.push(
      "",
      `### ${claim.statement}`,
      `- Status: ${claim.status}`,
      `- Ready: ${claim.readiness.ready ? "yes" : "no"}`,
      `- Evidence coverage: ${claim.readiness.coverage.toFixed(3)}`,
      `- Independent evidence groups: ${claim.readiness.independence.independentGroups}`,
      `- Evidence IDs: ${claim.evidenceIds.length ? claim.evidenceIds.join(", ") : "none"}`,
    );
    if (claim.readiness.blockers.length) {
      lines.push("- Blockers:", ...claim.readiness.blockers.map((blocker) => `  - ${blocker}`));
    }
  }
  if (report.unresolvedHypotheses.length) lines.push("", "## Unresolved Hypotheses", ...report.unresolvedHypotheses.map((item) => `- ${item}`));
  if (report.failedActions.length) lines.push("", "## Failed or Inconclusive Actions", ...report.failedActions.map((item) => `- ${item}`));
  if (report.diagnostics.length) lines.push("", "## Diagnostics", ...report.diagnostics.map((item) => `- ${item}`));
  return lines.join("\n");
}
