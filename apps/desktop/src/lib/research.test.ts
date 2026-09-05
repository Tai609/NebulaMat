import { describe, expect, it } from "vitest";
import {
  addResearchEvidence,
  addResearchEdge,
  addResearchNode,
  assessEvidenceIndependence,
  compileResearchReport,
  createResearchBranch,
  createResearchGraph,
  evaluateClaimReadiness,
  exportResearchBundle,
  importResearchBundle,
  migrateResearchGraph,
  predictionLoss,
  scoreResearchAction,
  selectNextResearchAction,
  stableEventId,
  stableHash,
  updateResearchBelief,
  validateResearchGraph,
  type ResearchActionNode,
  type ResearchCounterfactualNode,
  type ResearchEvidenceNode,
  type ResearchHypothesisNode,
} from "@ai4s/shared";

const NOW = 1_700_000_000_000;

function graphWithContract() {
  return createResearchGraph({
    researchId: "research-1",
    title: "Portable research contract",
    objective: "Test a transferable scientific claim",
    modes: ["theory", "computation", "experiment", "speculation"],
    now: NOW,
    rootClaim: {
      statement: "The mechanism is supported across the tested regimes",
      scope: "the declared benchmark regimes only",
      contract: {
        requiredEvidence: [
          { id: "measured", description: "an observation or measurement", kind: "measurement", minimumStrength: 0.7 },
          { id: "derived", description: "an independent derivation or simulation", kind: "derivation", minimumStrength: 0.6 },
          { id: "optional", description: "a literature anchor", kind: "literature", required: false },
        ],
        falsifiers: ["the effect disappears under the declared control"],
        requireChallenge: true,
        minimumCoverage: 1,
      },
    },
  });
}

function evidence(
  id: string,
  evidenceKind: ResearchEvidenceNode["evidenceKind"],
  strength: number,
): ResearchEvidenceNode {
  return {
    id,
    kind: "evidence",
    label: id,
    branchId: "branch:main",
    createdAt: NOW + 1,
    evidenceKind,
    summary: `${evidenceKind} result`,
    relation: "supports",
    strength,
    sourceRefs: [`source:${id}`],
    artifactIds: [],
    independent: true,
  };
}

describe("CEBRO research graph", () => {
  it("creates a deterministic root claim and preserves the creation event", () => {
    const graph = graphWithContract();
    expect(graph.rootClaimId).toBe("claim:research-1:root");
    expect(graph.branches).toHaveLength(1);
    expect(graph.events[0]).toMatchObject({ type: "research.created", branchId: "branch:main" });
    expect(graph.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(graph.eventId).toMatch(/^research-graph_/);
  });

  it("upgrades unconstrained legacy claims so zero evidence is not reported ready", () => {
    const legacy = createResearchGraph({
      researchId: "research-legacy-default",
      title: "Legacy default",
      objective: "Retain a falsifiable evidence contract",
      now: NOW,
      rootClaim: {
        contract: {
          requiredEvidence: [],
          falsifiers: [],
          requireChallenge: false,
          minimumCoverage: 0,
        },
      },
    });
    const migrated = migrateResearchGraph(legacy);
    const claim = migrated.nodes.find((node) => node.id === migrated.rootClaimId && node.kind === "claim");
    expect(claim?.kind === "claim" ? claim.contract.minimumCoverage : undefined).toBe(1);
    expect(evaluateClaimReadiness(migrated, migrated.rootClaimId).ready).toBe(false);
  });

  it("accepts theory, computation, experiment and speculation through the same evidence contract", () => {
    let graph = graphWithContract();
    graph = addResearchEvidence(graph, {
      evidence: evidence("measurement-1", "measurement", 0.9),
      claimId: graph.rootClaimId,
      actor: "agent:operator",
      at: NOW + 2,
    });
    graph = addResearchEvidence(graph, {
      evidence: evidence("derivation-1", "derivation", 0.8),
      claimId: graph.rootClaimId,
      actor: "agent:operator",
      at: NOW + 3,
    });
    const challenge: ResearchCounterfactualNode = {
      id: "counterfactual-1",
      kind: "counterfactual",
      label: "Declared control",
      branchId: "branch:main",
      createdAt: NOW + 4,
      premise: "The mechanism is absent",
      predictedObservation: "The measured signal disappears",
      falsifier: "The signal remains under the control",
      status: "checked",
    };
    graph = addResearchNode(graph, challenge, { actor: "agent:falsifier", at: NOW + 4 });
    graph = addResearchEdge(graph, {
      source: challenge.id,
      target: graph.rootClaimId,
      kind: "challenges",
      at: NOW + 5,
    }, { actor: "agent:falsifier" });

    const readiness = evaluateClaimReadiness(graph, graph.rootClaimId);
    expect(readiness.coverage).toBe(1);
    expect(readiness.challengeChecked).toBe(true);
    expect(readiness.ready).toBe(true);
  });

  it("keeps unsupported claims blocked until required evidence and a challenge exist", () => {
    let graph = graphWithContract();
    graph = addResearchEvidence(graph, {
      evidence: evidence("measurement-weak", "measurement", 0.4),
      claimId: graph.rootClaimId,
      at: NOW + 2,
    });
    const readiness = evaluateClaimReadiness(graph, graph.rootClaimId);
    expect(readiness.coverage).toBe(0);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      "evidence coverage 0.000 is below 1.000",
      "no challenge or falsification check is linked",
    ]));
  });

  it("selects the most informative affordable action instead of the cheapest action", () => {
    const candidates = [
      {
        id: "cheap-reading",
        actionType: "retrieve" as const,
        objective: "read one more source",
        expectedInformationGain: 0.25,
        expectedConfidenceGain: 0.1,
        cost: { normalized: 1 },
      },
      {
        id: "discriminating-test",
        actionType: "simulate" as const,
        objective: "run a discriminating test",
        expectedInformationGain: 0.95,
        expectedConfidenceGain: 0.7,
        cost: { normalized: 2 },
        risk: 0.1,
        reversibility: 0.95,
      },
      {
        id: "expensive-test",
        actionType: "measure" as const,
        objective: "run a high-cost test",
        expectedInformationGain: 1,
        expectedConfidenceGain: 1,
        cost: { normalized: 20 },
      },
    ];
    expect(scoreResearchAction(candidates[1]).score).toBeGreaterThan(scoreResearchAction(candidates[0]).score);
    expect(selectNextResearchAction(candidates, { maxCost: 3 })?.id).toBe("discriminating-test");
  });

  it("supports branch creation and refuses cross-branch edges", () => {
    let graph = graphWithContract();
    const hypothesis: ResearchHypothesisNode = {
      id: "hypothesis-1",
      kind: "hypothesis",
      label: "Alternative mechanism",
      branchId: "branch:main",
      createdAt: NOW + 1,
      statement: "A different mechanism explains the observation",
      status: "open",
    };
    graph = addResearchNode(graph, hypothesis, { at: NOW + 1 });
    graph = createResearchBranch(graph, {
      branchId: "branch:alternative",
      label: "Alternative mechanism",
      hypothesisIds: [hypothesis.id],
      now: NOW + 2,
    });
    expect(graph.branches.map((branch) => branch.id)).toEqual(["branch:main", "branch:alternative"]);

    const alternativeAction: ResearchActionNode = {
      id: "action-alternative",
      kind: "action",
      label: "Alternative test",
      branchId: "branch:alternative",
      createdAt: NOW + 3,
      actionType: "challenge",
      objective: "test the alternative",
      status: "proposed",
      expectedInformationGain: 0.8,
      expectedConfidenceGain: 0.4,
      cost: { normalized: 1 },
      risk: 0,
      reversibility: 1,
      testsClaimIds: [],
      producedNodeIds: [],
    };
    graph = addResearchNode(graph, alternativeAction, { at: NOW + 3 });
    expect(() => addResearchEdge(graph, {
      source: alternativeAction.id,
      target: graph.rootClaimId,
      kind: "tests",
      branchId: "branch:alternative",
    })).toThrow("cannot cross branches");
  });

  it("compiles a report without promoting unresolved hypotheses to claims", () => {
    const graph = graphWithContract();
    const report = compileResearchReport(graph, NOW + 10);
    expect(report.claims).toHaveLength(1);
    expect(report.claims[0].readiness.ready).toBe(false);
    expect(report.unresolvedHypotheses).toEqual([]);
    expect(report.graphHash).toBe(graph.hash);
  });

  it("exports a versioned portable bundle and rejects tampered imports", () => {
    let graph = graphWithContract();
    const action: ResearchActionNode = {
      id: "action:portable",
      kind: "action",
      label: "Portable derivation",
      branchId: "branch:main",
      createdAt: NOW + 1,
      actionType: "derive",
      objective: "derive a portable result",
      status: "proposed",
      expectedInformationGain: 0.7,
      expectedConfidenceGain: 0.5,
      cost: { normalized: 1 },
      risk: 0,
      reversibility: 1,
      testsClaimIds: [graph.rootClaimId],
      producedNodeIds: [],
      adapter: "symbolic-deriver",
    };
    graph = addResearchNode(graph, action, { at: NOW + 1 });
    const bundle = exportResearchBundle(graph, NOW + 2);
    expect(bundle.requiredAdapters).toEqual([{ actionType: "derive", adapter: "symbolic-deriver" }]);
    expect(importResearchBundle(JSON.parse(JSON.stringify(bundle))).hash).toBe(graph.hash);

    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.graph.objective = "silently changed objective";
    expect(() => importResearchBundle(tampered)).toThrow("hash does not match");
  });

  it("tracks calibrated belief updates and detects dependent evidence families", () => {
    let graph = graphWithContract();
    const hypothesis: ResearchHypothesisNode = {
      id: "hypothesis:mechanism",
      kind: "hypothesis",
      label: "Mechanism hypothesis",
      branchId: "branch:main",
      createdAt: NOW + 1,
      statement: "The mechanism is active",
      status: "open",
    };
    graph = addResearchNode(graph, hypothesis, { at: NOW + 1 });
    graph = addResearchEvidence(graph, {
      evidence: {
        ...evidence("measurement:calibrated", "measurement", 0.9),
        sourceFamily: "instrument-1",
        modelFamily: "model-1",
        prediction: { predicted: 0.8, observed: 0.6 },
      },
      claimId: graph.rootClaimId,
      at: NOW + 2,
    });
    graph = updateResearchBelief(graph, hypothesis.id, {
      evidenceId: "measurement:calibrated",
      likelihoodUnderHypothesis: 0.9,
      likelihoodUnderAlternative: 0.2,
      observedProbability: 0.6,
    }, { at: NOW + 3, prior: 0.5 });
    const belief = graph.nodes.find((node) => node.id === hypothesis.id);
    expect(belief).toMatchObject({ kind: "hypothesis", belief: { posterior: 0.8181818181818181, updateCount: 1 } });
    expect(predictionLoss(0.8, 0.6)).toBeCloseTo(0.04);

    graph = addResearchEvidence(graph, {
      evidence: {
        ...evidence("measurement:dependent", "measurement", 0.9),
        sourceFamily: "instrument-1",
        modelFamily: "model-2",
      },
      claimId: graph.rootClaimId,
      at: NOW + 4,
    });
    graph = addResearchEvidence(graph, {
      evidence: {
        ...evidence("measurement:transitive", "measurement", 0.9),
        sourceFamily: "instrument-2",
        modelFamily: "model-2",
      },
      claimId: graph.rootClaimId,
      at: NOW + 5,
    });
    graph = addResearchEvidence(graph, {
      evidence: {
        ...evidence("measurement:declared-dependent", "measurement", 0.9),
        sourceFamily: "instrument-3",
        modelFamily: "model-3",
        independent: false,
      },
      claimId: graph.rootClaimId,
      at: NOW + 6,
    });
    const independence = assessEvidenceIndependence(graph, graph.rootClaimId);
    expect(independence.evidenceCount).toBe(4);
    expect(independence.independentGroups).toBe(1);
    expect(independence.warnings[0]).toContain("dependent records");
    expect(independence.warnings).toContain("one or more evidence records are explicitly marked non-independent");
  });

  it("requires rollback information for external-effect interventions", () => {
    const runtimeCandidate = {
      id: "action:unsafe",
      actionType: "observe" as const,
      objective: "touch an external system",
      expectedInformationGain: 0.5,
      expectedConfidenceGain: 0.2,
      cost: { normalized: 1 },
      intervention: {
        preconditions: [],
        controls: [],
        predictions: [],
        falsifiers: [],
        safetyClass: "external-effect" as const,
        replayability: "manual" as const,
      },
    };
    expect(() => scoreResearchAction(runtimeCandidate)).toThrow("rollbackPlan");
  });

  it("migrates a valid v1 graph to v2 while rejecting invalid structure", () => {
    const current = graphWithContract();
    const { hash: oldHash, eventId: oldEventId, ...legacyBase } = { ...current, schemaVersion: 1 };
    void oldHash;
    void oldEventId;
    const legacy = {
      ...legacyBase,
      hash: stableHash(legacyBase),
      eventId: stableEventId("research-graph", { researchId: current.researchId, hash: stableHash(legacyBase) }),
    };
    expect(validateResearchGraph(legacy).valid).toBe(true);
    const migrated = migrateResearchGraph(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.hash).not.toBe(legacy.hash);

    const invalid = { ...migrated, rootClaimId: "claim:missing" };
    expect(validateResearchGraph(invalid).valid).toBe(false);
  });
});
