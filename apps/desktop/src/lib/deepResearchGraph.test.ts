import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResearchGraph, type ResearchGraph } from "@ai4s/shared";
import type { DeepResearchRun } from "./deepResearchRun";

const mocks = vi.hoisted(() => ({
  graph: null as ResearchGraph | null,
  replaceResearch: vi.fn(),
  setActiveResearchId: vi.fn(),
}));

vi.mock("./researchWorkspace", () => ({
  initializeResearchWorkspace: async () => ({
    getResearch: () => mocks.graph,
    replaceResearch: (graph: ResearchGraph) => {
      mocks.graph = graph;
      mocks.replaceResearch(graph);
      return graph;
    },
    listResearch: () => mocks.graph ? [mocks.graph] : [],
    createResearch: () => {
      throw new Error("not used in this test");
    },
  }),
}));

vi.mock("./researchConversation", () => ({
  getActiveResearchGraph: async () => mocks.graph,
  setActiveResearchId: mocks.setActiveResearchId,
}));

import { writeDeepResearchEvidence } from "./deepResearchGraph";

describe("Deep Research CEBRO evidence write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.graph = createResearchGraph({
      researchId: "research-1",
      title: "Deep research",
      objective: "Test a claim",
      now: 1,
    });
  });

  it("preserves exact Knowledge Universe relationships and deduplicates one DOI across providers", async () => {
    const run: DeepResearchRun = {
      schemaVersion: 1,
      runId: "run-1",
      sessionId: "session-1",
      query: "Test a claim",
      stage: "evaluate",
      stageHistory: [],
      status: "running",
      attempt: 1,
      maxAttempts: 2,
      researchId: "research-1",
      expectedGraphHash: mocks.graph!.hash,
      knowledge: {
        query: "Test a claim",
        retrievedAt: 2,
        attempted: true,
        documentHits: [{ sourceId: "paper-1", title: "Paper", sourcePath: "C:/kb/paper.json", snippet: "observed result", score: 0.8, relatedImages: [] }],
        graph: {
          matchedNodes: [{ id: "node:a", label: "A", nodeType: "claim", cluster: "c", sourceId: "paper-1", degree: 1, properties: "{}", relatedImages: [] }],
          adjacentNodes: [{ id: "node:b", label: "B", nodeType: "method", cluster: "c", sourceId: "paper-1", degree: 1, properties: "{}", relatedImages: [] }],
          edges: [{ source: "node:a", target: "node:b", relation: "tested-by", weight: 1, sourceId: "paper-1" }],
          totalMatches: 1,
          truncated: false,
        },
        sourceIds: ["paper-1"],
        errors: [],
        contextTruncated: false,
      },
      toolReceipts: [
        { sessionId: "session-1", callId: "call-openalex", tool: "openalex-search", status: "success", governedRetrieval: true, providerFamilies: ["openalex"], recordKeys: ["doi:10.1000/test"], outputDigest: "out-a", evidenceExcerpt: "OpenAlex result", at: 3 },
        { sessionId: "session-child", callId: "call-pubmed", tool: "pubmed-search", status: "success", governedRetrieval: true, providerFamilies: ["pubmed"], recordKeys: ["doi:10.1000/test"], outputDigest: "out-b", evidenceExcerpt: "PubMed result", at: 4 },
      ],
      providerFamilies: ["openalex", "pubmed"],
      blockers: [],
      createdAt: 1,
      updatedAt: 4,
    };

    const graph = await writeDeepResearchEvidence(run);
    const graphEvidence = graph.nodes.find((node) => node.kind === "evidence" && node.metadata?.origin === "knowledge-universe-graph");
    expect(graphEvidence?.metadata).toMatchObject({
      matchedNodeIds: ["node:a"],
      adjacentNodeIds: ["node:b"],
      edges: [{ source: "node:a", target: "node:b", relation: "tested-by", sourceId: "paper-1", weight: 1 }],
    });

    const external = graph.nodes.filter((node) => node.kind === "evidence" && node.metadata?.origin === "deep-research-tool-receipt");
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({
      sourceRefs: expect.arrayContaining(["doi:10.1000/test", "provider:openalex", "provider:pubmed"]),
      sourceFamily: "provider:openalex+pubmed",
      independent: false,
      metadata: { callIds: ["call-openalex", "call-pubmed"] },
    });
  });

  it("rejects a stale graph hash instead of attaching evidence to another revision", async () => {
    const run = {
      schemaVersion: 1,
      runId: "run-stale",
      sessionId: "session-1",
      query: "query",
      stage: "evaluate",
      stageHistory: [],
      status: "running",
      attempt: 1,
      maxAttempts: 2,
      researchId: "research-1",
      expectedGraphHash: "stale-hash",
      knowledge: { query: "query", retrievedAt: 1, attempted: true, documentHits: [], graph: { matchedNodes: [], adjacentNodes: [], edges: [], totalMatches: 0, truncated: false }, sourceIds: [], errors: [], contextTruncated: false },
      toolReceipts: [],
      providerFamilies: [],
      blockers: [],
      createdAt: 1,
      updatedAt: 1,
    } satisfies DeepResearchRun;

    await expect(writeDeepResearchEvidence(run)).rejects.toThrow("graph changed");
    expect(mocks.replaceResearch).not.toHaveBeenCalled();
  });
});
