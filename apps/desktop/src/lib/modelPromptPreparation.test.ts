import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KnowledgeGraphSearchResult,
  KnowledgeSearchResult,
} from "./tauri";

const mocks = vi.hoisted(() => ({
  searchKnowledgeBase: vi.fn(async (): Promise<KnowledgeSearchResult[]> => []),
  searchKnowledgeGraph: vi.fn(async (): Promise<KnowledgeGraphSearchResult> => ({
    matchedNodes: [],
    adjacentNodes: [],
    edges: [],
    totalMatches: 0,
    truncated: false,
  })),
  getActiveResearchGraph: vi.fn(async () => null),
  appendResearchPromptContext: vi.fn((prompt: string) => prompt),
  buildResearchPromptContext: vi.fn(() => "CEBRO graph context"),
}));

vi.mock("./tauri", () => ({
  searchKnowledgeBase: mocks.searchKnowledgeBase,
  searchKnowledgeGraph: mocks.searchKnowledgeGraph,
}));

vi.mock("./researchConversation", () => ({
  getActiveResearchGraph: mocks.getActiveResearchGraph,
  appendResearchPromptContext: mocks.appendResearchPromptContext,
  buildResearchPromptContext: mocks.buildResearchPromptContext,
}));

import { prepareModelPrompt, prepareModelPromptDetailed } from "./modelPromptPreparation";

describe("model prompt preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchKnowledgeBase.mockResolvedValue([]);
    mocks.searchKnowledgeGraph.mockResolvedValue({
      matchedNodes: [],
      adjacentNodes: [],
      edges: [],
      totalMatches: 0,
      truncated: false,
    });
    mocks.getActiveResearchGraph.mockResolvedValue(null);
  });

  it("keeps retrieval on the first prompt of a newly created conversation", async () => {
    mocks.searchKnowledgeBase.mockResolvedValue([{
      sourceId: "output_7",
      title: "CATDA article",
      sourcePath: "C:/CATDA/output_7/graph/full_output.json",
      snippet: "hydrothermal synthesis",
      score: 0.2,
      relatedImages: [],
    }]);

    const prepared = await prepareModelPrompt("How was the catalyst made?");

    expect(mocks.searchKnowledgeBase).toHaveBeenCalledWith("How was the catalyst made?", 6);
    expect(prepared).toContain("output_7 | CATDA article");
    expect(prepared).toContain("hydrothermal synthesis");
  });

  it("does not let an isolated research-role prompt bypass graph retrieval", async () => {
    mocks.searchKnowledgeGraph.mockResolvedValue({
      matchedNodes: [{
        id: "output_7::synthesis::n1",
        label: "hydrothermal synthesis",
        nodeType: "method",
        cluster: "synthesis",
        sourceId: "output_7",
        degree: 1,
        properties: "temperature=180 C",
        relatedImages: [],
      }],
      adjacentNodes: [{
        id: "output_7::testing::n2",
        label: "electrochemical test",
        nodeType: "measurement",
        cluster: "testing",
        sourceId: "output_7",
        degree: 1,
        properties: "",
        relatedImages: [],
      }],
      edges: [{
        source: "output_7::synthesis::n1",
        target: "output_7::testing::n2",
        relation: "validated-by",
        weight: 1,
        sourceId: "output_7",
      }],
      totalMatches: 1,
      truncated: false,
    });

    const prepared = await prepareModelPrompt("You are the librarian research specialist.");

    expect(mocks.searchKnowledgeGraph).toHaveBeenCalledWith(
      "You are the librarian research specialist.",
      12,
    );
    expect(prepared).toContain("Graph matches:");
    expect(prepared).toContain("electrochemical test");
    expect(prepared).toContain("validated-by");
  });

  it("returns an exact structured Knowledge Universe receipt alongside hidden context", async () => {
    mocks.searchKnowledgeBase.mockResolvedValue([{
      sourceId: "paper-1",
      title: "Paper one",
      sourcePath: "C:/kb/paper-1.json",
      snippet: "measured result",
      score: 0.8,
      relatedImages: ["figure-1.png"],
    }]);
    mocks.searchKnowledgeGraph.mockResolvedValue({
      matchedNodes: [{ id: "node:a", label: "A", nodeType: "claim", cluster: "c", sourceId: "paper-1", degree: 1, properties: "{}", relatedImages: [] }],
      adjacentNodes: [{ id: "node:b", label: "B", nodeType: "method", cluster: "c", sourceId: "paper-1", degree: 1, properties: "{}", relatedImages: [] }],
      edges: [{ source: "node:a", target: "node:b", relation: "tested-by", weight: 0.9, sourceId: "paper-1" }],
      totalMatches: 1,
      truncated: false,
    });

    const prepared = await prepareModelPromptDetailed("What supports A?");

    expect(prepared.knowledgeBundle).toMatchObject({
      attempted: true,
      sourceIds: ["paper-1"],
      documentHits: [expect.objectContaining({ sourceId: "paper-1" })],
      graph: {
        matchedNodes: [expect.objectContaining({ id: "node:a" })],
        adjacentNodes: [expect.objectContaining({ id: "node:b" })],
        edges: [expect.objectContaining({ source: "node:a", target: "node:b", relation: "tested-by" })],
      },
    });
    expect(prepared.prompt).toContain("node:a");
    expect(prepared.prompt).toContain("A --tested-by--> B (source paper-1)");
  });

  it("adds the CEBRO scientific-skill protocol only in Deep Research mode", async () => {
    const ordinary = await prepareModelPrompt("Compare catalyst stability", {
      includeKnowledge: false,
    });
    const deep = await prepareModelPrompt("Compare catalyst stability", {
      includeKnowledge: false,
      deepResearch: true,
      availableSkills: [
        { name: "aris-research-lit", description: "literature retrieval" },
        { name: "aris-citation-audit", description: "citation audit" },
      ],
    });

    expect(ordinary).not.toContain("NEBULAMAT_INTERNAL_DEEP_RESEARCH");
    expect(deep).toContain("NEBULAMAT_INTERNAL_DEEP_RESEARCH");
    expect(deep).toContain("/aris-research-lit");
    expect(deep).toContain("PubMed/NCBI");
    expect(deep).toContain("at least two independent providers");
    expect(deep).toContain("Do not answer literature claims from model memory alone");
    expect(deep).toContain("supporting, refuting, qualifying and missing evidence");
  });

  it("reports a capability gap instead of advertising unavailable curated skills", async () => {
    const deep = await prepareModelPrompt("Find recent catalyst evidence", {
      includeKnowledge: false,
      deepResearch: true,
      availableSkills: [],
    });

    expect(deep).toContain("No curated skill was reported by the host");
    expect(deep).not.toContain("/aris-research-lit");
    expect(deep).toContain("list each attempted capability/provider");
  });

  it("adds the complete task-routed tool contract in scientific-assistant mode", async () => {
    const prepared = await prepareModelPrompt("Inspect this VASP relaxation", {
      includeKnowledge: false,
      researchAssistantMode: "scientific-assistant",
    });

    expect(prepared).toContain("Selected NebulaMat research lane: scientific-assistant");
    expect(prepared).toContain("vasp_structure_scene");
    expect(prepared).toContain("Periodic DFT -> VASP or CP2K");
    expect(prepared).toContain("Molecular quantum chemistry -> Gaussian");
    expect(prepared).toContain("Molecular and classical dynamics -> LAMMPS or GROMACS");
    expect(prepared).toContain("Machine-learning potentials -> MatterSim, UMA, DeePMD");
    expect(prepared).toContain("Structure construction -> pymatgen, ASE, RDKit, or CatKit");
    expect(prepared).toContain("Phonons and thermochemistry -> Phonopy or VASPKIT");
    expect(prepared).toContain("Catalytic kinetics -> CatMAP, Cantera, OpenMKM, or kmos");
    expect(prepared).toContain("Electronic-structure post-processing -> LOBSTER, Bader, or VASPKIT");
    expect(prepared).toContain("Visualization -> VASPFlow scene, OVITO, PyVista, or VMD");
    expect(prepared).toContain("configured, discovered, ready, and missing separately");
    expect(prepared).toContain("MatterGen remains a candidate-generation route");
    expect(prepared).toContain("obtain explicit user approval");
    expect(prepared).not.toContain("six-stage CEBRO-inspired state machine");
  });

  it("keeps uploaded evidence immutable in experiment-log mode", async () => {
    const prepared = await prepareModelPrompt("Normalize the uploaded furnace notes", {
      includeKnowledge: false,
      researchAssistantMode: "experiment-log",
    });

    expect(prepared).toContain("Selected NebulaMat research lane: experiment-log");
    expect(prepared).toContain("Never guess a missing temperature");
    expect(prepared).toContain(".openscience/experiment-inbox/<exp_id>.json");
    expect(prepared).toContain("Keep raw attachments immutable");
    expect(prepared).not.toContain("search at least two independent providers");
  });
});
