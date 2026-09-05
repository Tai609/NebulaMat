import type { ResearchGraph } from "@ai4s/shared";
import {
  searchKnowledgeBase,
  searchKnowledgeGraph,
  type KnowledgeGraphSearchResult,
  type KnowledgeSearchResult,
} from "./tauri";
import {
  appendResearchPromptContext,
  buildResearchPromptContext,
  getActiveResearchGraph,
} from "./researchConversation";
import {
  buildDeepResearchPrompt,
  buildSpecialistResearchPrompt,
  type ResearchAssistantMode,
} from "./deepResearch";
import type { SkillInfo } from "@ai4s/sdk";

const KNOWLEDGE_CONTEXT_START = "[NEBULAMAT_INTERNAL_KNOWLEDGE_CONTEXT]";
const KNOWLEDGE_CONTEXT_END = "[/NEBULAMAT_INTERNAL_KNOWLEDGE_CONTEXT]";
const KNOWLEDGE_QUERY_LIMIT = 6;
const GRAPH_QUERY_LIMIT = 12;
const KNOWLEDGE_CONTEXT_MAX = 18_000;

export interface KnowledgeUniverseBundle {
  query: string;
  retrievedAt: number;
  attempted: boolean;
  documentHits: KnowledgeSearchResult[];
  graph: KnowledgeGraphSearchResult;
  sourceIds: string[];
  errors: string[];
  contextTruncated: boolean;
}

export interface PreparedModelPrompt {
  prompt: string;
  knowledgeBundle: KnowledgeUniverseBundle | null;
  researchGraph: ResearchGraph | null;
}

export interface ModelPromptPreparationOptions {
  /** Query used for retrieval. Defaults to the original model prompt. */
  query?: string;
  /** Supply a graph already resolved by the caller, or null to suppress it. */
  researchGraph?: ResearchGraph | null;
  /** Research context is enabled for every model-facing turn by default. */
  includeResearch?: boolean;
  /** Knowledge retrieval is best-effort and enabled by default. */
  includeKnowledge?: boolean;
  /** Add the CEBRO-inspired multi-skill research protocol. */
  deepResearch?: boolean;
  /** Add a selective scientific or experiment-record assistant contract. */
  researchAssistantMode?: Exclude<ResearchAssistantMode, "deep-research">;
  /** Runtime-discovered skills, used to avoid promising unavailable commands. */
  availableSkills?: readonly SkillInfo[] | readonly string[];
}

function graphContext(result: KnowledgeGraphSearchResult): string {
  if (!result.matchedNodes.length && !result.adjacentNodes.length && !result.edges.length) {
    return "";
  }
  const labels = new Map(
    [...result.matchedNodes, ...result.adjacentNodes].map((node) => [node.id, node.label]),
  );
  const matched = result.matchedNodes
    .slice(0, GRAPH_QUERY_LIMIT)
    .map((node) => `- ${node.id} | ${node.label} [${node.nodeType}]${node.properties ? ` | ${node.properties}` : ""}`);
  const adjacent = result.adjacentNodes
    .slice(0, GRAPH_QUERY_LIMIT * 2)
    .map((node) => `- ${node.id} | ${node.label} [${node.nodeType}]`);
  const edges = result.edges
    .slice(0, GRAPH_QUERY_LIMIT * 3)
    .map((edge) => `- ${labels.get(edge.source) ?? edge.source} --${edge.relation}--> ${labels.get(edge.target) ?? edge.target} (source ${edge.sourceId})`);
  return [
    "Graph matches:",
    ...(matched.length ? matched : ["- none"]),
    "Adjacent graph nodes:",
    ...(adjacent.length ? adjacent : ["- none"]),
    "Graph relationships:",
    ...(edges.length ? edges : ["- none"]),
  ].join("\n");
}

function documentContext(hits: KnowledgeSearchResult[]): string {
  return hits.map((hit, index) => {
    const images = hit.relatedImages.length
      ? `\nVisual evidence: ${hit.relatedImages.slice(0, 8).join(", ")}`
      : "";
    return `[${index + 1}] ${hit.sourceId} | ${hit.title}\nSource: ${hit.sourcePath}\n${hit.snippet}${images}`;
  }).join("\n\n");
}

async function retrieveKnowledgeBundle(query: string): Promise<KnowledgeUniverseBundle> {
  const errors: string[] = [];
  const documentPromise = searchKnowledgeBase(query, KNOWLEDGE_QUERY_LIMIT).catch((error) => {
    errors.push(`document search: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });
  // Compatibility mocks and older browser adapters may not expose graph
  // retrieval yet. Keep that capability gap explicit in the receipt.
  let graphPromise: Promise<KnowledgeGraphSearchResult>;
  if (typeof searchKnowledgeGraph === "function") {
    graphPromise = searchKnowledgeGraph(query, GRAPH_QUERY_LIMIT).catch((error) => {
      errors.push(`graph search: ${error instanceof Error ? error.message : String(error)}`);
      return { matchedNodes: [], adjacentNodes: [], edges: [], totalMatches: 0, truncated: false };
    });
  } else {
    errors.push("graph search: capability unavailable");
    graphPromise = Promise.resolve({ matchedNodes: [], adjacentNodes: [], edges: [], totalMatches: 0, truncated: false });
  }
  const [documentHits, graph] = await Promise.all([documentPromise, graphPromise]);
  const sourceIds = [...new Set([
    ...documentHits.map((hit) => hit.sourceId),
    ...graph.matchedNodes.map((node) => node.sourceId),
    ...graph.adjacentNodes.map((node) => node.sourceId),
    ...graph.edges.map((edge) => edge.sourceId),
  ].filter(Boolean))].sort();
  return {
    query,
    retrievedAt: Date.now(),
    attempted: true,
    documentHits,
    graph,
    sourceIds,
    errors,
    contextTruncated: false,
  };
}

function knowledgeContext(bundle: KnowledgeUniverseBundle): string {
  const { documentHits: hits, graph } = bundle;
  if (!hits.length && !graph.matchedNodes.length && !graph.adjacentNodes.length && !graph.edges.length) return "";
  const sections = [
    hits.length ? `Document matches:\n${documentContext(hits)}` : "",
    graphContext(graph),
  ].filter(Boolean);
  if (!sections.length) return "";
  const errors = bundle.errors.length
    ? ` Retrieval gaps: ${bundle.errors.map((error) => error.replace(/\s+/g, " ").trim()).join(" | ").slice(0, 800)}.`
    : "";
  const preamble = `${KNOWLEDGE_CONTEXT_START}\nKnowledge-universe evidence. Use it when relevant, cite source IDs for knowledge-base claims, preserve listed graph relationships, never invent missing nodes or relations, and distinguish evidence from inference. If evidence is insufficient or conflicting, say so explicitly.${errors}\n`;
  const suffix = `\n${KNOWLEDGE_CONTEXT_END}`;
  const body = sections.join("\n\n");
  const bodyLimit = Math.max(0, KNOWLEDGE_CONTEXT_MAX - preamble.length - suffix.length);
  bundle.contextTruncated = body.length > bodyLimit;
  const truncationNote = bundle.contextTruncated
    ? "\n[Knowledge Universe context truncated by the host; use only the identifiers and relationships present above.]"
    : "";
  return `${preamble}${body.slice(0, Math.max(0, bodyLimit - truncationNote.length))}${truncationNote}${suffix}`;
}

/**
 * Single model-facing prompt preparation boundary for ordinary answers, plan
 * mode, isolated research roles, and automatic review. The visible user text
 * is deliberately left untouched; callers pass the returned text only to the
 * runtime transport.
 */
export async function prepareModelPromptDetailed(
  prompt: string,
  options: ModelPromptPreparationOptions = {},
): Promise<PreparedModelPrompt> {
  let prepared = prompt;
  let researchGraph: ResearchGraph | null | undefined;
  let knowledgeBundle: KnowledgeUniverseBundle | null = null;
  if (options.includeResearch !== false) {
    researchGraph = options.researchGraph === undefined
      ? await getActiveResearchGraph()
      : options.researchGraph;
    prepared = appendResearchPromptContext(prepared, researchGraph);
  }
  if (options.includeKnowledge !== false) {
    const query = (options.query ?? prompt).trim();
    knowledgeBundle = query ? await retrieveKnowledgeBundle(query) : null;
    let context = knowledgeBundle ? knowledgeContext(knowledgeBundle) : "";
    if (!context && options.deepResearch && knowledgeBundle) {
      const gaps = knowledgeBundle.errors.length
        ? knowledgeBundle.errors.map((error) => error.replace(/\s+/g, " ").trim()).join(" | ").slice(0, 800)
        : "No matching local documents, nodes, or relationship edges were found.";
      context = `${KNOWLEDGE_CONTEXT_START}\nKnowledge Universe retrieval receipt: 0 document hits, 0 matched nodes, and 0 relationship edges. ${gaps}\n${KNOWLEDGE_CONTEXT_END}`;
    }
    if (context) prepared = `${prepared}\n\n${context}`;
  }
  if (options.deepResearch) {
    if (researchGraph === undefined) {
      researchGraph = options.researchGraph === undefined
        ? await getActiveResearchGraph()
        : options.researchGraph;
    }
    const graphContext = researchGraph ? buildResearchPromptContext(researchGraph) : undefined;
    prepared = `${prepared}\n\n${buildDeepResearchPrompt(options.query ?? prompt, {
      skills: options.availableSkills,
      graphContext,
    })}`;
  } else if (options.researchAssistantMode) {
    prepared = `${prepared}\n\n${buildSpecialistResearchPrompt(
      options.query ?? prompt,
      options.researchAssistantMode,
    )}`;
  }
  return { prompt: prepared, knowledgeBundle, researchGraph: researchGraph ?? null };
}

/** Compatibility wrapper for callers that only need the transport prompt. */
export async function prepareModelPrompt(
  prompt: string,
  options: ModelPromptPreparationOptions = {},
): Promise<string> {
  return (await prepareModelPromptDetailed(prompt, options)).prompt;
}

export const modelPromptPreparationLimits = {
  knowledgeQueryLimit: KNOWLEDGE_QUERY_LIMIT,
  graphQueryLimit: GRAPH_QUERY_LIMIT,
  contextMax: KNOWLEDGE_CONTEXT_MAX,
} as const;
