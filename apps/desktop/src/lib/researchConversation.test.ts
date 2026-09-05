import { beforeEach, describe, expect, it, vi } from "vitest";
import { addResearchNode, createResearchGraph } from "@ai4s/shared";
import { ResearchRuntime, type ResearchActionAdapter } from "@ai4s/sdk";

const mocks = vi.hoisted(() => ({
  runtime: null as ResearchRuntime | null,
  workspace: "C:\\workspace-a",
}));

vi.mock("./researchWorkspace", () => ({
  initializeResearchWorkspace: async () => mocks.runtime,
  researchWorkspaceKey: () => mocks.workspace,
}));

import {
  RESEARCH_CONTEXT_END,
  RESEARCH_CONTEXT_START,
  appendResearchPromptContext,
  applyResearchAgentProposal,
  autopilotProposalNeedsApproval,
  buildResearchAutopilotPrompt,
  buildResearchPromptContext,
  consumeResearchAutopilotRequest,
  getActiveResearchId,
  getResearchAutopilotState,
  latestAgentResponse,
  parseAutopilotProposal,
  recordConversationOutput,
  requestResearchAutopilot,
  setActiveResearchId,
  validateResearchAutopilotProposal,
} from "./researchConversation";

function makeRuntime() {
  const runtime = new ResearchRuntime();
  let graph = createResearchGraph({
    researchId: "research-1",
    title: "Transferable mechanism",
    objective: "Distinguish two explanations with the least expensive decisive observation",
    now: 1_700_000_000_000,
  });
  graph = addResearchNode(graph, {
    id: "hypothesis:one",
    kind: "hypothesis",
    label: "Mechanism A",
    branchId: "branch:main",
    createdAt: 1_700_000_000_001,
    statement: "Mechanism A explains the observation",
    status: "open",
  });
  runtime.hydrateResearch(graph);
  return runtime;
}

describe("research conversation bridge", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.workspace = "C:\\workspace-a";
    mocks.runtime = makeRuntime();
  });

  it("builds a compact, delimited prompt context without replacing the user prompt", () => {
    const graph = mocks.runtime!.getResearch("research-1");
    const context = buildResearchPromptContext(graph);
    expect(context).toContain(RESEARCH_CONTEXT_START);
    expect(context).toContain(RESEARCH_CONTEXT_END);
    expect(context).toContain(`graphHash: ${graph.hash}`);
    expect(context).toContain("Mechanism A explains the observation");
    expect(context).toContain("Do not mark a claim supported");
    expect(appendResearchPromptContext("What should I test next?", graph)).toMatch(/^What should I test next\?/);
    expect(appendResearchPromptContext("plain", null)).toBe("plain");
  });

  it("keeps the active graph selection isolated by workspace", () => {
    setActiveResearchId("research-a", "C:\\workspace-a");
    setActiveResearchId("research-b", "C:\\workspace-b");
    expect(getActiveResearchId("C:\\workspace-a")).toBe("research-a");
    expect(getActiveResearchId("C:\\workspace-b")).toBe("research-b");
  });

  it("keeps selection and autopilot state across equivalent Windows path forms", () => {
    const rustPath = String.raw`C:\Workspace\Study`;
    const sidecarPath = "c:/workspace/study/";

    requestResearchAutopilot("research-1", rustPath);

    expect(getActiveResearchId(sidecarPath)).toBe("research-1");
    expect(getResearchAutopilotState("research-1", sidecarPath)).toMatchObject({
      researchId: "research-1",
      status: "running",
      stage: "inspect",
    });
    expect(consumeResearchAutopilotRequest("research-1", sidecarPath)).toBe(true);
  });

  it("records approved assistant output as typed graph state", async () => {
    const withEvidence = await recordConversationOutput({
      researchId: "research-1",
      kind: "evidence",
      text: "The observed response is compatible with A, but has not been independently reproduced.",
      sessionId: "session-7",
    });
    const evidence = withEvidence.nodes.find((node) => node.kind === "evidence");
    expect(evidence).toMatchObject({
      kind: "evidence",
      relation: "inconclusive",
      sourceRefs: ["session:session-7"],
      independent: false,
    });
    expect(withEvidence.edges).toContainEqual(expect.objectContaining({
      source: evidence?.id,
      target: withEvidence.rootClaimId,
      kind: "inconclusive",
    }));

    const withAction = await recordConversationOutput({
      researchId: "research-1",
      kind: "action",
      text: "Run the lowest-cost observation that separates A from its alternative.",
      sessionId: "session-7",
    });
    expect(withAction.nodes).toContainEqual(expect.objectContaining({
      kind: "action",
      status: "proposed",
      objective: "Run the lowest-cost observation that separates A from its alternative.",
    }));
  });

  it("selects only the latest assistant answer for explicit write-back", () => {
    expect(latestAgentResponse([
      { kind: "agent", markdown: "first" },
      { kind: "status-line", text: "done", tone: "done" },
      { kind: "agent", markdown: "latest" },
    ])).toBe("latest");
  });

  it("accepts only a validated fenced autopilot proposal", () => {
    const graph = mocks.runtime!.getResearch("research-1");
    expect(buildResearchAutopilotPrompt(graph)).toContain('"schemaVersion":1');
    expect(parseAutopilotProposal("I think we should add an action.")).toBeNull();
    const proposal = parseAutopilotProposal(`\n\`\`\`json\n{
      "schemaVersion": 1,
      "stage": "plan",
      "graphHash": "${graph.hash}",
      "summary": "A discriminating observation is available",
      "hypotheses": [],
      "actions": [{ "actionType": "observe", "objective": "Inspect the existing record", "risk": 0, "reversibility": 1 }],
      "evidence": [],
      "nextStage": "execute",
      "nextPrompt": "Inspect the record and report traceable evidence",
      "done": false
    }\n\`\`\``);
    expect(proposal).toMatchObject({ schemaVersion: 1, actions: [{ actionType: "observe" }], done: false });
    expect(autopilotProposalNeedsApproval(proposal!)).toBe(false);
    expect(autopilotProposalNeedsApproval({
      ...proposal!,
      actions: [{ ...proposal!.actions[0], actionType: "measure" }],
    })).toBe(true);
    expect(buildResearchAutopilotPrompt(graph, "plan")).toContain("required stage for this turn is plan");
  });

  it("rejects stale graphs, stage jumps, unsupported evidence, and premature completion", () => {
    const graph = mocks.runtime!.getResearch("research-1");
    const base = {
      schemaVersion: 1 as const,
      stage: "inspect" as const,
      graphHash: graph.hash,
      summary: "Inspected the graph",
      hypotheses: [],
      actions: [],
      evidence: [],
      nextStage: "hypothesize" as const,
      nextPrompt: "Formulate alternatives",
      done: false,
    };
    expect(() => validateResearchAutopilotProposal(graph, { ...base, graphHash: "stale" }, "inspect"))
      .toThrow("older graph revision");
    expect(() => validateResearchAutopilotProposal(graph, { ...base, nextStage: "execute" }, "inspect"))
      .toThrow("stage transition");
    expect(() => validateResearchAutopilotProposal(graph, {
      ...base,
      stage: "evaluate",
      nextStage: "synthesize",
      evidence: [{ summary: "Unverified assertion", relation: "supports" }],
    }, "evaluate")).toThrow("adapter-produced output");
    expect(() => validateResearchAutopilotProposal(graph, {
      ...base,
      stage: "synthesize",
      nextStage: "synthesize",
      done: true,
    }, "synthesize")).toThrow("cannot finish");
  });

  it("executes a declared safe adapter before the next autonomous turn", async () => {
    const adapter: ResearchActionAdapter = {
      id: "safe-deriver",
      modes: ["hybrid"],
      actionTypes: ["derive"],
      capabilities: {
        version: "1.0.0",
        modes: ["hybrid"],
        actionTypes: ["derive"],
        safetyClasses: ["read-only"],
        replayability: ["deterministic"],
        externalEffects: false,
      },
      async execute({ action }) {
        return {
          status: "completed",
          summary: "The symbolic derivation completed.",
          evidence: [{
            id: "evidence:safe-derivation",
            kind: "evidence",
            label: "Safe derivation",
            branchId: action.branchId,
            createdAt: 1_700_000_000_010,
            evidenceKind: "derivation",
            summary: "The symbolic derivation completed.",
            relation: "supports",
            strength: 0.8,
            sourceRefs: ["adapter:safe-deriver"],
            artifactIds: [],
            independent: false,
          }],
        };
      },
    };
    mocks.runtime!.registerAdapter(adapter);
    const graph = await applyResearchAgentProposal("research-1", {
      schemaVersion: 1,
      stage: "plan",
      graphHash: mocks.runtime!.getResearch("research-1").hash,
      summary: "Plan a safe derivation",
      hypotheses: [],
      actions: [{ id: "action:safe-derivation", actionType: "derive", objective: "Derive the relation", risk: 0, reversibility: 1, cost: 0.1 }],
      evidence: [],
      nextStage: "execute",
      nextPrompt: "Execute the derivation",
      done: false,
    });
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "action:safe-derivation", status: "completed" }));
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "evidence:safe-derivation", kind: "evidence" }));
  });

  it("keeps an action proposed when no safe adapter is registered", async () => {
    const graph = mocks.runtime!.getResearch("research-1");
    const next = await applyResearchAgentProposal("research-1", {
      schemaVersion: 1,
      stage: "plan",
      graphHash: graph.hash,
      summary: "Plan an unsupported observation",
      hypotheses: [],
      actions: [{ id: "action:no-adapter", actionType: "observe", objective: "Inspect an unavailable source", risk: 0, reversibility: 1, cost: 0.1 }],
      evidence: [],
      nextStage: "execute",
      nextPrompt: "Execute only through a registered adapter",
      done: false,
    });
    expect(next.nodes).toContainEqual(expect.objectContaining({ id: "action:no-adapter", status: "proposed" }));
  });
});
