import { describe, expect, it } from "vitest";
import type { ResearchActionAdapter } from "@ai4s/sdk";
import { createInnoClawMetadataEvidenceCardAdapter, ResearchRuntime } from "@ai4s/sdk";
import { createResearchGraph, renderInnoClawResearchReport, type InnoClawEvidenceCard, type ResearchEvidenceNode } from "@ai4s/shared";

const NOW = 1_700_000_000_000;

function evidence(id: string): ResearchEvidenceNode {
  return {
    id,
    kind: "evidence",
    label: "Derived evidence",
    branchId: "branch:main",
    createdAt: NOW + 3,
    evidenceKind: "derivation",
    summary: "A reproducible derivation completed by the adapter",
    relation: "supports",
    strength: 0.9,
    sourceRefs: ["derivation:1"],
    artifactIds: [],
    independent: true,
  };
}

describe("ResearchRuntime adapter boundary", () => {
  it("converts an InnoClaw Evidence Card into a literature artifact and evidence record", async () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    runtime.registerAdapter(createInnoClawMetadataEvidenceCardAdapter());
    const card: InnoClawEvidenceCard = {
      id: "card:paper-1",
      query: "surface reconstruction",
      sources: [{ title: "A reproducible paper", doi: "10.1000/example" }],
      rawExcerpts: [{ text: "The surface reconstructs under the stated condition.", sourceIndex: 0 }],
      retrievalStatus: "success",
      sourcesFound: 1,
      sourcesAttempted: 1,
    };
    const graph = runtime.createResearch({
      researchId: "research-innoclaw-card",
      title: "Evidence card bridge",
      objective: "Test literature evidence",
      modes: ["theory"],
      now: NOW,
      rootClaim: {
        contract: {
          requiredEvidence: [{ id: "literature", description: "literature evidence", kind: "literature", minimumStrength: 0.8 }],
          falsifiers: [],
          requireChallenge: false,
          minimumCoverage: 1,
        },
      },
    });
    const result = await runtime.ingestInnoClawEvidenceCard(graph.researchId, card, {
      actionId: "action:paper-study",
      relation: "supports",
    });
    expect(result.execution.status).toBe("completed");
    expect(result.research.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "artifact", artifactType: "data", metadata: expect.objectContaining({ format: "innoclaw-evidence-card" }) }),
      expect.objectContaining({ kind: "evidence", evidenceKind: "literature", relation: "supports", artifactIds: ["action:paper-study:artifact:evidence-card"] }),
    ]));
    const report = runtime.compileReport(graph.researchId);
    expect(report.claims[0].readiness.ready).toBe(false);
    expect(report.claims[0].readiness.blockers).toContain("independent evidence groups 0 is below 1");
  });

  it("keeps external actions proposed until a named human approves them", async () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({
      researchId: "research-checkpoint",
      title: "Checkpoint bridge",
      objective: "Require approval",
      modes: ["experiment"],
      now: NOW,
    });
    runtime.proposeAction(graph.researchId, {
      id: "action:external",
      actionType: "measure",
      objective: "Measure the sample",
      expectedInformationGain: 0.7,
      expectedConfidenceGain: 0.4,
      cost: { normalized: 0.8 },
      risk: 0.4,
      reversibility: 0.5,
      intervention: {
        preconditions: ["sample mounted"],
        controls: ["negative control"],
        predictions: [],
        falsifiers: ["instrument drift"],
        rollbackPlan: "stop acquisition",
        safetyClass: "external-effect",
        replayability: "manual",
      },
    });
    const blocked = await runtime.executeAction(graph.researchId, "action:external");
    expect(blocked.execution.status).toBe("inconclusive");
    expect(blocked.research.nodes.find((node) => node.id === "action:external")).toMatchObject({ status: "proposed" });
    expect(() => runtime.approveAction(graph.researchId, "action:external", "agent:planner")).toThrow("named human");
    expect(runtime.approveAction(graph.researchId, "action:external", "human:alice")).toMatchObject({ status: "approved" });
  });

  it("records specialist role branches and an explicit merge event", () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({
      researchId: "research-roles",
      title: "Role branches",
      objective: "Compare literature and reproduction",
      now: NOW,
    });
    const branch = runtime.createRoleBranch(graph.researchId, "skeptic", { branchId: "branch:skeptic" });
    expect(branch).toMatchObject({ id: "branch:skeptic", role: "skeptic", status: "active" });
    const merged = runtime.mergeRoleBranch(graph.researchId, branch.id, "branch:main", "Skeptic review is now part of the main line");
    expect(merged.branches.find((item) => item.id === branch.id)).toMatchObject({ status: "merged", mergedInto: "branch:main" });
    expect(merged.events[merged.events.length - 1]).toMatchObject({ type: "branch.merged", branchId: "branch:skeptic" });
  });

  it("promotes only reviewed role evidence into main while preserving source provenance", async () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({
      researchId: "research-role-output-merge",
      title: "Reviewed merge",
      objective: "Keep role output isolated until review",
      modes: ["theory"],
      now: NOW,
    });
    runtime.createRoleBranch(graph.researchId, "skeptic", { branchId: "branch:skeptic:review" });
    runtime.registerAdapter({
      id: "skeptic-review",
      modes: ["theory"],
      actionTypes: ["challenge"],
      async execute({ action }) {
        return {
          status: "completed",
          summary: "Found a limiting assumption",
          evidence: [{
            ...evidence("evidence:skeptic:limit"),
            branchId: action.branchId,
            relation: "qualifies",
            independent: false,
          }],
        };
      },
    });
    runtime.proposeAction(graph.researchId, {
      id: "action:skeptic:review",
      actionType: "challenge",
      objective: "Find a limiting assumption",
      expectedInformationGain: 0.7,
      expectedConfidenceGain: 0.2,
      cost: { normalized: 0.2 },
      branchId: "branch:skeptic:review",
      testsClaimIds: [],
      adapter: "skeptic-review",
    });
    const isolated = await runtime.executeAction(graph.researchId, "action:skeptic:review");
    expect(isolated.execution.status).toBe("completed");
    expect(isolated.research.edges.some((edge) => edge.source === "evidence:skeptic:limit")).toBe(false);

    const merged = runtime.mergeRoleBranchOutputs(graph.researchId, "branch:skeptic:review");
    const promoted = merged.nodes.find((node) => node.kind === "evidence" && node.metadata?.mergedFromNodeId === "evidence:skeptic:limit");
    expect(promoted).toMatchObject({ branchId: "branch:main", relation: "qualifies" });
    expect(merged.edges).toContainEqual(expect.objectContaining({ source: promoted?.id, target: graph.rootClaimId, kind: "qualifies" }));
    expect(merged.nodes.find((node) => node.id === "evidence:skeptic:limit")).toMatchObject({ branchId: "branch:skeptic:review" });
  });

  it("seeds isolated InnoClaw role actions without cross-branch claim links", () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({ researchId: "research-role-team", title: "Role team", objective: "Test roles", now: NOW });
    const result = runtime.createInnoClawRoleTeam(graph.researchId, { query: "test query" });
    expect(result.plans.map((plan) => plan.role)).toEqual(["researcher", "skeptic", "librarian", "reproducer", "scribe"]);
    for (const plan of result.plans) {
      expect(result.research.branches.find((branch) => branch.id === plan.branchId)).toMatchObject({ role: plan.role, status: "active" });
      expect(result.research.nodes.find((node) => node.id === plan.actionId)).toMatchObject({ branchId: plan.branchId, testsClaimIds: [] });
    }
  });

  it("dispatches an approved role action without accepting graph mutations from the worker", async () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({ researchId: "research-role-dispatch", title: "Dispatch", objective: "Challenge the claim", now: NOW });
    const plan = runtime.createInnoClawRoleTeam(graph.researchId, { roles: ["skeptic"] }).plans[0];
    runtime.approveAction(graph.researchId, plan.actionId, "human:tester");
    let prompt = "";
    const dispatched = await runtime.dispatchRoleAction(graph.researchId, plan.actionId, "session:skeptic", async (value) => {
      prompt = value;
    });
    expect(dispatched).toMatchObject({
      status: "running",
      metadata: expect.objectContaining({ innoclawRole: "skeptic", roleSessionId: "session:skeptic" }),
    });
    expect(prompt).toContain("Do not modify the CEBRO graph or claim status");
    expect(runtime.getResearch(graph.researchId).nodes.filter((node) => node.kind === "evidence")).toEqual([]);
  });

  it("renders a report from CEBRO readiness without upgrading blocked claims", () => {
    const graph = createResearchGraph({
      researchId: "research-report-template",
      title: "Report template",
      objective: "Keep uncertainty visible",
      now: NOW,
      rootClaim: {
        contract: {
          requiredEvidence: [{ id: "measurement", description: "a measurement", kind: "measurement", minimumStrength: 0.8 }],
          falsifiers: [],
          requireChallenge: false,
          minimumCoverage: 1,
        },
      },
    });
    const report = renderInnoClawResearchReport({
      researchId: graph.researchId,
      title: graph.title,
      objective: graph.objective,
      generatedAt: NOW,
      claims: [{
        claimId: graph.rootClaimId,
        statement: "A claim without measurement",
        scope: "test",
        status: "candidate",
        readiness: {
          claimId: graph.rootClaimId,
          coverage: 0,
          requiredEvidence: [],
          challengeChecked: false,
          independence: { evidenceCount: 0, independentGroups: 0, effectiveEvidenceCount: 0, groups: [], warnings: [] },
          epistemicBlockers: [],
          ready: false,
          blockers: ["measurement evidence is missing"],
        },
        independence: { evidenceCount: 0, independentGroups: 0, effectiveEvidenceCount: 0, groups: [], warnings: [] },
        evidenceIds: [],
      }],
      unresolvedHypotheses: [],
      failedActions: [],
      artifactIds: [],
      beliefStates: [],
      diagnostics: [],
      branchSummary: [],
      graphHash: graph.hash,
    });
    expect(report).toContain("Ready: no");
    expect(report).toContain("measurement evidence is missing");
  });

  it("applies one validated autonomous proposal as typed graph nodes", () => {
    const runtime = new ResearchRuntime({ actor: "test:autopilot", now: () => NOW });
    const graph = runtime.createResearch({
      researchId: "research-autopilot",
      title: "Autonomous loop",
      objective: "Discriminate two explanations",
      now: NOW,
    });
    const next = runtime.applyAgentProposal(graph.researchId, {
      schemaVersion: 1,
      stage: "plan",
      graphHash: graph.hash,
      summary: "Plan a falsification step",
      hypotheses: [{ id: "hypothesis:auto", statement: "An alternative mechanism explains the result" }],
      actions: [{ id: "action:auto", actionType: "challenge", objective: "Find a falsifying observation", expectedInformationGain: 0.8, expectedConfidenceGain: 0.4, cost: 0.2, risk: 0, reversibility: 1 }],
      evidence: [{ id: "evidence:auto", summary: "A traceable negative observation was found", relation: "refutes", evidenceKind: "observation", strength: 0.7 }],
      nextStage: "execute",
      nextPrompt: "Evaluate the alternative",
      done: false,
    }, "session:auto");

    expect(next.nodes).toContainEqual(expect.objectContaining({ id: "hypothesis:auto", kind: "hypothesis", status: "open" }));
    expect(next.nodes).toContainEqual(expect.objectContaining({ id: "action:auto", kind: "action", status: "proposed" }));
    expect(next.nodes).toContainEqual(expect.objectContaining({ id: "evidence:auto", kind: "evidence", relation: "refutes", independent: false }));
    expect(next.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "hypothesis:auto", target: graph.rootClaimId, kind: "challenges" }),
      expect.objectContaining({ source: "action:auto", target: graph.rootClaimId, kind: "tests" }),
      expect.objectContaining({ source: "evidence:auto", target: graph.rootClaimId, kind: "refutes" }),
    ]));
  });

  it("runs a discipline-neutral adapter and compiles evidence into the claim graph", async () => {
    const runtime = new ResearchRuntime({ actor: "test:runtime", now: () => NOW });
    const adapter: ResearchActionAdapter = {
      id: "symbolic-deriver",
      modes: ["theory"],
      actionTypes: ["derive"],
      async execute() {
        return { status: "completed", summary: "derivation complete", evidence: [evidence("evidence:derivation")] };
      },
    };
    runtime.registerAdapter(adapter);
    const graph = runtime.createResearch({
      researchId: "research-runtime-1",
      title: "Adapter test",
      objective: "Check one claim",
      modes: ["theory"],
      now: NOW,
      rootClaim: {
        contract: {
          requiredEvidence: [{ id: "derivation", description: "a derivation", kind: "derivation", minimumStrength: 0.8 }],
          falsifiers: [],
          requireChallenge: false,
          minimumCoverage: 1,
        },
      },
    });
    runtime.proposeAction(graph.researchId, {
      id: "action:derive",
      actionType: "derive",
      objective: "derive the claimed relation",
      expectedInformationGain: 0.8,
      expectedConfidenceGain: 0.7,
      cost: { normalized: 1 },
      testsClaimIds: [graph.rootClaimId],
    });

    const result = await runtime.executeAction(graph.researchId, "action:derive");
    expect(result.execution.status).toBe("completed");
    expect(result.research.nodes.find((node) => node.id === "action:derive")).toMatchObject({
      status: "completed",
      producedNodeIds: ["evidence:derivation"],
    });
    expect(runtime.compileReport(graph.researchId).claims[0].readiness.ready).toBe(true);
  });

  it("fails explicitly when a proposed action has no matching backend", async () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({
      researchId: "research-runtime-2",
      title: "Missing adapter",
      objective: "Check adapter failure",
      modes: ["experiment"],
      now: NOW,
    });
    runtime.proposeAction(graph.researchId, {
      id: "action:observe",
      actionType: "observe",
      objective: "observe the system",
      expectedInformationGain: 0.5,
      expectedConfidenceGain: 0.2,
      cost: { normalized: 1 },
    });
    const result = await runtime.executeAction(graph.researchId, "action:observe");
    expect(result.execution.status).toBe("failed");
    expect(result.execution.summary).toContain("No adapter supports action observe");
    expect(result.research.nodes.find((node) => node.id === "action:observe")).toMatchObject({ status: "failed" });
  });

  it("matches declared capabilities, hashes replay recipes, and emits immutable versions", async () => {
    const snapshots: string[] = [];
    const runtime = new ResearchRuntime({
      now: () => NOW,
      onGraphChanged: (graph) => snapshots.push(graph.hash),
    });
    const adapter: ResearchActionAdapter = {
      id: "replayable-observer",
      modes: ["experiment"],
      actionTypes: ["observe"],
      capabilities: {
        version: "1.0.0",
        modes: ["experiment"],
        actionTypes: ["observe"],
        safetyClasses: ["reversible"],
        replayability: ["seeded"],
        externalEffects: false,
      },
      canHandle: ({ action }) => action.intervention?.replayability === "seeded",
      async execute() {
        return {
          status: "completed",
          summary: "observation replay recorded",
          replay: {
            adapterId: "replayable-observer",
            inputNodeIds: ["claim:research-runtime-3:root"],
            command: "observe --seed 7",
            environment: "fixture-v1",
            replayability: "seeded",
          },
        };
      },
    };
    runtime.registerAdapter(adapter);
    expect(runtime.listAdapters().map((item) => item.id)).toEqual(["replayable-observer"]);

    const graph = runtime.createResearch({
      researchId: "research-runtime-3",
      title: "Capability matching",
      objective: "Check a replayable intervention",
      modes: ["experiment"],
      now: NOW,
    });
    runtime.proposeAction(graph.researchId, {
      id: "action:observe-replay",
      actionType: "observe",
      objective: "observe with a seeded fixture",
      expectedInformationGain: 0.5,
      expectedConfidenceGain: 0.4,
      cost: { normalized: 1 },
      intervention: {
        preconditions: ["fixture is available"],
        controls: ["negative control"],
        predictions: [],
        falsifiers: ["fixture is inconsistent"],
        safetyClass: "reversible",
        replayability: "seeded",
      },
    });

    const result = await runtime.executeAction(graph.researchId, "action:observe-replay");
    const action = result.research.nodes.find((node) => node.id === "action:observe-replay");
    expect(action).toMatchObject({ status: "completed", adapter: "replayable-observer" });
    expect(action && action.kind === "action" ? action.replay?.hash : undefined).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(snapshots).size).toBe(snapshots.length);
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects contradictory external-effect adapter capability declarations", () => {
    const runtime = new ResearchRuntime();
    expect(() => runtime.registerAdapter({
      id: "unsafe-capability",
      modes: ["experiment"],
      actionTypes: ["measure"],
      capabilities: {
        version: "1.0.0",
        modes: ["experiment"],
        actionTypes: ["measure"],
        safetyClasses: ["read-only"],
        replayability: ["manual"],
        externalEffects: true,
      },
      async execute() {
        return { status: "failed", summary: "unreachable" };
      },
    })).toThrow("external effects");
  });

  it("turns an adapter branch violation into a durable failed action", async () => {
    const runtime = new ResearchRuntime({ now: () => NOW });
    const graph = runtime.createResearch({
      researchId: "research-runtime-4",
      title: "Output boundary",
      objective: "Reject a cross-branch adapter result",
      modes: ["theory"],
      now: NOW,
    });
    runtime.registerAdapter({
      id: "invalid-deriver",
      modes: ["theory"],
      actionTypes: ["derive"],
      async execute() {
        return {
          status: "completed",
          summary: "should be rejected",
          evidence: [{ ...evidence("evidence:wrong-branch"), branchId: "branch:missing" }],
        };
      },
    });
    runtime.proposeAction(graph.researchId, {
      id: "action:invalid-output",
      actionType: "derive",
      objective: "derive with an invalid branch",
      expectedInformationGain: 0.5,
      expectedConfidenceGain: 0.2,
      cost: { normalized: 1 },
    });

    const result = await runtime.executeAction(graph.researchId, "action:invalid-output");
    expect(result.execution.status).toBe("failed");
    expect(result.execution.summary).toContain("crosses the action branch boundary");
    expect(result.research.nodes.find((node) => node.id === "action:invalid-output")).toMatchObject({
      status: "failed",
      producedNodeIds: [],
    });
  });

  it("hydrates validated workspace graphs without emitting a duplicate change", () => {
    const snapshots: string[] = [];
    const graph = createResearchGraph({
      researchId: "research-runtime-hydrated",
      title: "Hydrated graph",
      objective: "Restore a graph from disk",
      now: NOW,
    });
    const runtime = new ResearchRuntime({ onGraphChanged: (next) => snapshots.push(next.hash) });
    expect(runtime.hydrateResearch(graph)).toEqual(graph);
    expect(runtime.listResearch()).toEqual([graph]);
    expect(snapshots).toEqual([]);
    const conflict = createResearchGraph({
      researchId: graph.researchId,
      title: "conflict",
      objective: graph.objective,
      now: NOW + 1,
    });
    expect(() => runtime.hydrateResearch(conflict)).toThrow("different graph");
  });
});
