import { beforeEach, describe, expect, it } from "vitest";
import type { RuntimeMessageEvent } from "@ai4s/sdk";
import type { KnowledgeUniverseBundle } from "./modelPromptPreparation";
import {
  DEEP_RESEARCH_RUNS_KEY,
  buildDeepResearchCorrectionPrompt,
  classifyDeepResearchToolReceipt,
  deepResearchBlockers,
  getDeepResearchRun,
  projectDeepResearchHistory,
  qualifyDeepResearchRun,
  recordDeepResearchToolEvent,
  retryDeepResearchRun,
  startDeepResearchRun,
} from "./deepResearchRun";

const knowledge: KnowledgeUniverseBundle = {
  query: "test query",
  retrievedAt: 10,
  attempted: true,
  documentHits: [],
  graph: { matchedNodes: [], adjacentNodes: [], edges: [], totalMatches: 0, truncated: false },
  sourceIds: [],
  errors: [],
  contextTruncated: false,
};

function tool(input: Partial<Extract<RuntimeMessageEvent, { type: "tool.updated" }>> & {
  callId: string;
  tool: string;
}): Extract<RuntimeMessageEvent, { type: "tool.updated" }> {
  return {
    type: "tool.updated",
    sessionId: "session-1",
    status: "success",
    ...input,
  };
}

describe("Deep Research runtime state machine", () => {
  beforeEach(() => window.localStorage.removeItem(DEEP_RESEARCH_RUNS_KEY));

  it("persists the legal inspect-to-plan prefix before model execution", () => {
    const run = startDeepResearchRun({
      sessionId: "session-1",
      query: "test query",
      researchId: "research-1",
      graphHash: "hash-1",
      knowledge,
      at: 100,
    });

    expect(run.stage).toBe("plan");
    expect(run.stageHistory.map((entry) => entry.stage)).toEqual(["inspect", "hypothesize", "plan"]);
    expect(getDeepResearchRun("session-1")).toMatchObject({ runId: run.runId, stage: "plan" });
    expect(buildDeepResearchCorrectionPrompt(run)).toMatch(/^\n\n\[NEBULAMAT_INTERNAL_DEEP_RESEARCH\]/);
  });

  it("counts only structured successful provider receipts and extracts stable record IDs", () => {
    const proseOnly = classifyDeepResearchToolReceipt(tool({
      callId: "prose",
      tool: "webfetch",
      output: "I searched OpenAlex and found DOI 10.1000/ABC.1",
    }));
    expect(proseOnly).toMatchObject({ governedRetrieval: false, providerFamilies: [] });

    const receipt = classifyDeepResearchToolReceipt(tool({
      callId: "structured",
      tool: "mcp__literature__search",
      input: { provider: "OpenAlex" },
      output: "{\"doi\":\"10.1000/ABC.1\",\"title\":\"Result\"}",
    }));
    expect(receipt).toMatchObject({
      governedRetrieval: true,
      providerFamilies: ["openalex"],
      recordKeys: ["doi:10.1000/abc.1"],
    });

    expect(classifyDeepResearchToolReceipt(tool({
      callId: "curated-skill",
      tool: "aris-research-lit",
      output: "retrieval completed",
    }))).toMatchObject({ governedRetrieval: true, providerFamilies: [] });
  });

  it("blocks synthesis until a governed skill/tool and two provider families succeed", () => {
    let run = startDeepResearchRun({
      sessionId: "session-1",
      query: "test query",
      researchId: "research-1",
      graphHash: "hash-1",
      knowledge,
    });
    recordDeepResearchToolEvent("session-1", tool({
      callId: "openalex",
      tool: "mcp__literature__search",
      input: { provider: "OpenAlex" },
      output: "DOI 10.1000/test",
    }));
    run = getDeepResearchRun("session-1")!;
    expect(deepResearchBlockers(run)).toContainEqual(expect.stringContaining("at least 2"));

    run = retryDeepResearchRun(run, deepResearchBlockers(run));
    recordDeepResearchToolEvent("session-1", tool({
      callId: "pubmed",
      tool: "skill",
      input: { name: "aris-research-lit", database: "PubMed" },
      output: "PMID: 12345678; DOI 10.1000/test",
    }));
    run = getDeepResearchRun("session-1")!;
    expect(run.providerFamilies).toEqual(["openalex", "pubmed"]);
    expect(deepResearchBlockers(run)).toEqual([]);

    const qualified = qualifyDeepResearchRun(run);
    expect(qualified.status).toBe("qualified");
    expect(qualified.stage).toBe("synthesize");
    expect(qualified.stageHistory.map((entry) => entry.stage)).toEqual([
      "inspect", "hypothesize", "plan", "execute", "evaluate", "plan", "execute", "evaluate", "synthesize",
    ]);
  });

  it("removes an unqualified server synthesis during history restoration", () => {
    const run = startDeepResearchRun({
      sessionId: "session-1",
      query: "test query",
      researchId: "research-1",
      graphHash: "hash-1",
      knowledge,
    });
    const projected = projectDeepResearchHistory([
      { role: "user", parts: [{ type: "text", text: "test query" }] },
      { role: "assistant", completed: 20, parts: [{ type: "text", text: "unsupported synthesis" }] },
    ], run);

    const text = projected[1].parts.map((part) => part.text ?? "").join(" ");
    expect(text).not.toContain("unsupported synthesis");
    expect(text).toContain("Deep Research incomplete");
  });
});
