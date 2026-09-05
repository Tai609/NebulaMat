import {
  addResearchEvidence,
  stableHash,
  type ResearchEvidenceNode,
  type ResearchGraph,
} from "@ai4s/shared";
import type { DeepResearchRun, DeepResearchToolReceipt } from "./deepResearchRun";
import { getActiveResearchGraph, setActiveResearchId } from "./researchConversation";
import { initializeResearchWorkspace } from "./researchWorkspace";

function compact(value: string, max = 1_200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function evidenceId(run: DeepResearchRun, kind: string, identity: unknown): string {
  return `evidence:${run.runId}:${kind}:${stableHash(identity).slice(0, 18)}`;
}

function appendEvidence(graph: ResearchGraph, evidence: ResearchEvidenceNode): ResearchGraph {
  if (graph.nodes.some((node) => node.id === evidence.id)) return graph;
  return addResearchEvidence(graph, {
    evidence,
    claimId: graph.rootClaimId,
    relation: evidence.relation,
    actor: "desktop:deep-research-runtime",
  });
}

/** Bind Deep Research to the selected graph, or create a session-derived graph. */
export async function ensureDeepResearchGraph(sessionId: string, query: string): Promise<ResearchGraph> {
  const selected = await getActiveResearchGraph();
  if (selected) return selected;
  const runtime = await initializeResearchWorkspace();
  const researchId = `deep-research-${stableHash({ sessionId, query }).slice(0, 20)}`;
  const existing = runtime.listResearch().find((graph) => graph.researchId === researchId);
  const graph = existing ?? runtime.createResearch({
    researchId,
    title: compact(query, 120) || "Deep Research",
    objective: query.trim(),
    modes: ["hybrid"],
    rootClaim: {
      contract: {
        requiredEvidence: [{
          id: "governed-literature",
          description: "Traceable literature evidence produced by governed retrieval tools",
          kind: "literature",
          minimumStrength: 0.4,
          required: true,
        }],
        falsifiers: ["A reproducible primary source or analysis contradicts the research objective"],
        requireChallenge: true,
        minimumCoverage: 1,
        minimumIndependentGroups: 2,
      },
      metadata: { origin: "deep-research", sessionId },
    },
  });
  setActiveResearchId(graph.researchId);
  return graph;
}

function toolEvidenceGroups(receipts: DeepResearchToolReceipt[]): Array<{
  key: string;
  receipts: DeepResearchToolReceipt[];
}> {
  const groups = new Map<string, DeepResearchToolReceipt[]>();
  for (const receipt of receipts.filter((item) => item.status === "success" && item.governedRetrieval)) {
    const keys = receipt.recordKeys.length ? receipt.recordKeys : [`receipt:${receipt.outputDigest}`];
    for (const key of keys) {
      const group = groups.get(key) ?? [];
      group.push(receipt);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([key, grouped]) => ({ key, receipts: grouped }));
}

/**
 * Materialize only host-validated receipts. Model prose is never parsed into
 * evidence and every Knowledge Universe relation retains its exact identifiers.
 */
export async function writeDeepResearchEvidence(run: DeepResearchRun): Promise<ResearchGraph> {
  const runtime = await initializeResearchWorkspace();
  let graph = runtime.getResearch(run.researchId);
  if (graph.hash !== run.expectedGraphHash) {
    throw new Error(`CEBRO graph changed during Deep Research (expected ${run.expectedGraphHash}, received ${graph.hash}).`);
  }
  const createdAt = Date.now();

  for (const hit of run.knowledge.documentHits) {
    graph = appendEvidence(graph, {
      id: evidenceId(run, "knowledge-document", { sourceId: hit.sourceId, sourcePath: hit.sourcePath, snippet: hit.snippet }),
      kind: "evidence",
      label: `Knowledge document: ${hit.title}`,
      branchId: "branch:main",
      createdAt,
      evidenceKind: "literature",
      summary: compact(hit.snippet || hit.title),
      relation: "qualifies",
      strength: 0.45,
      uncertainty: "Local indexed evidence was retrieved by relevance; it is not an independent external-provider confirmation.",
      sourceRefs: [`knowledge-source:${hit.sourceId}`, `knowledge-path:${hit.sourcePath}`],
      artifactIds: [],
      contentHash: stableHash(hit),
      independent: false,
      sourceFamily: `knowledge-universe:${hit.sourceId}`,
      metadata: {
        origin: "knowledge-universe-document",
        sourceId: hit.sourceId,
        sourcePath: hit.sourcePath,
        score: hit.score,
        relatedImages: hit.relatedImages,
        query: run.knowledge.query,
      },
    });
  }

  const graphSources = new Set([
    ...run.knowledge.graph.matchedNodes.map((node) => node.sourceId),
    ...run.knowledge.graph.adjacentNodes.map((node) => node.sourceId),
    ...run.knowledge.graph.edges.map((edge) => edge.sourceId),
  ]);
  for (const sourceId of graphSources) {
    const matchedNodes = run.knowledge.graph.matchedNodes.filter((node) => node.sourceId === sourceId);
    const adjacentNodes = run.knowledge.graph.adjacentNodes.filter((node) => node.sourceId === sourceId);
    const edges = run.knowledge.graph.edges.filter((edge) => edge.sourceId === sourceId);
    const sourceRefs = [
      `knowledge-source:${sourceId}`,
      ...matchedNodes.map((node) => `knowledge-node:${node.id}`),
      ...adjacentNodes.map((node) => `knowledge-node:${node.id}`),
      ...edges.map((edge) => `knowledge-edge:${edge.source}--${edge.relation}-->${edge.target}`),
    ];
    graph = appendEvidence(graph, {
      id: evidenceId(run, "knowledge-graph", { sourceId, matchedNodes, adjacentNodes, edges }),
      kind: "evidence",
      label: `Knowledge graph relationships: ${sourceId}`,
      branchId: "branch:main",
      createdAt,
      evidenceKind: "artifact",
      summary: `Knowledge Universe returned ${matchedNodes.length} matched node(s), ${adjacentNodes.length} adjacent node(s), and ${edges.length} exact relationship edge(s) for source ${sourceId}.`,
      relation: "qualifies",
      strength: 0.5,
      uncertainty: "Graph relations preserve indexed source provenance but do not by themselves establish the root claim.",
      sourceRefs,
      artifactIds: [],
      contentHash: stableHash({ sourceId, matchedNodes, adjacentNodes, edges }),
      independent: false,
      sourceFamily: `knowledge-universe:${sourceId}`,
      metadata: {
        origin: "knowledge-universe-graph",
        sourceId,
        matchedNodeIds: matchedNodes.map((node) => node.id),
        adjacentNodeIds: adjacentNodes.map((node) => node.id),
        edges: edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          sourceId: edge.sourceId,
          weight: edge.weight,
        })),
        query: run.knowledge.query,
        truncated: run.knowledge.graph.truncated,
      },
    });
  }

  for (const group of toolEvidenceGroups(run.toolReceipts)) {
    const providers = [...new Set(group.receipts.flatMap((receipt) => receipt.providerFamilies))].sort();
    const callRefs = group.receipts.map((receipt) => `runtime-tool:${receipt.sessionId}:${receipt.callId}`);
    const excerpts = [...new Set(group.receipts.map((receipt) => receipt.evidenceExcerpt).filter(Boolean))];
    const sourceRefs = [...new Set([
      group.key,
      ...providers.map((provider) => `provider:${provider}`),
      ...callRefs,
    ])];
    graph = appendEvidence(graph, {
      id: evidenceId(run, "governed-retrieval", group.key),
      kind: "evidence",
      label: group.key.startsWith("receipt:") ? "Governed retrieval receipt" : `Literature record: ${group.key}`,
      branchId: "branch:main",
      createdAt,
      evidenceKind: "literature",
      summary: compact(excerpts.join(" ") || `Successful governed retrieval for ${group.key}.`),
      relation: "qualifies",
      strength: group.key.startsWith("receipt:") ? 0.4 : 0.55,
      uncertainty: "The runtime validates tool execution and source identity, but does not infer claim support from retrieval output alone.",
      sourceRefs,
      artifactIds: [],
      contentHash: stableHash({ key: group.key, outputDigests: group.receipts.map((receipt) => receipt.outputDigest).sort() }),
      independent: providers.length === 1,
      sourceFamily: providers.length ? `provider:${providers.join("+")}` : "provider:unverified",
      sharedAssumptions: group.key.startsWith("receipt:") ? [] : [`record:${group.key}`],
      metadata: {
        origin: "deep-research-tool-receipt",
        recordKey: group.key,
        providerFamilies: providers,
        callIds: group.receipts.map((receipt) => receipt.callId),
        tools: [...new Set(group.receipts.map((receipt) => receipt.tool))],
        outputDigests: group.receipts.map((receipt) => receipt.outputDigest),
        runId: run.runId,
      },
    });
  }

  return runtime.replaceResearch(graph);
}
