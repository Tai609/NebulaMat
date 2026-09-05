import { describe, expect, it } from "vitest";
import {
  canTransition,
  createMaterialsWorkflow,
  attachDFTValidation,
  isDFTValidationReady,
  isSubmissionReady,
  stableHash,
  transitionMaterialsWorkflow,
  type DFTModelAudit,
  type DFTValidationReport,
  type SubmissionManifest,
} from "@ai4s/shared";

const hash = (value: string) => stableHash(value);

function approvedRecords(): { audit: DFTModelAudit; manifest: SubmissionManifest } {
  const audit: DFTModelAudit = {
    schemaVersion: 1,
    auditId: "audit-1",
    decision: "approved",
    activePhase: "candidate-surface",
    atomCount: 48,
    freeAtoms: 20,
    fixedAtoms: 28,
    slabLayers: 4,
    supercell: { a: 3, b: 3, c: 1 },
    coverage: "1/9 ML",
    kpoints: { mesh: [3, 3, 1], gammaCentered: true },
    memoryEstimateGb: 32,
    plannedRunCount: 4,
    lowerCostAlternative: "Use a 2x2 screening cell before the converged 3x3 run.",
    frozenLayerPolicy: "Relax adsorbate and top two layers; fix deeper layers.",
    scientificJustification: "Represents the candidate active surface at the requested coverage.",
    convergenceEvidence: ["3x3 k-mesh changes adsorption energy by <0.02 eV"],
    warnings: [],
    modelHash: hash("POSCAR"),
    costHash: hash("cost"),
    hash: hash("audit"),
    eventId: "audit-event-1",
  };
  const manifest: SubmissionManifest = {
    schemaVersion: 1,
    manifestId: "manifest-1",
    workflowId: "wf-1",
    modelHash: audit.modelHash,
    parametersHash: hash("INCAR+KPOINTS"),
    auditHash: audit.hash,
    costHash: audit.costHash,
    artifacts: [{ path: "POSCAR", role: "structure", hash: audit.modelHash }],
    command: "sbatch run.slurm",
    surface: "hpc",
    humanApproval: {
      decision: "approved",
      actor: "human:alice",
      approvedAt: 100,
      modelHash: audit.modelHash,
      parametersHash: hash("INCAR+KPOINTS"),
      auditHash: audit.hash,
      costHash: audit.costHash,
      eventId: "approval-event-1",
    },
    hash: hash("manifest"),
    eventId: "manifest-event-1",
  };
  return { audit, manifest };
}

function validationReport(workflowId = "wf-1"): DFTValidationReport {
  return {
    schemaVersion: 1,
    workflowId,
    runId: "run-1",
    outcome: "passed",
    checks: [{
      id: "energy-convergence",
      outcome: "passed",
      evidencePaths: ["runs/run-1/OUTCAR"],
      observed: "0.01 eV",
      expected: "< 0.02 eV",
    }],
    artifactHashes: [hash("OUTCAR")],
    reviewedBy: "human:alice",
    reviewedAt: 3,
    hash: hash("validation"),
    eventId: "validation-event-1",
  };
}

describe("governed DFT workflow", () => {
  it("hashes canonical records independently of object key order", () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
    expect(stableHash({ a: 2 })).not.toBe(stableHash({ a: 1 }));
  });

  it("allows only declared DFT stage transitions", () => {
    expect(canTransition("draft", "model-audit")).toBe(true);
    expect(canTransition("draft", "submitted")).toBe(false);
    expect(canTransition("dft.prepare", "dft.audit")).toBe(true);
  });

  it("blocks submission until the audit and named approval bind exact hashes", () => {
    const { audit, manifest } = approvedRecords();
    expect(isSubmissionReady(manifest, audit)).toBe(true);
    expect(isSubmissionReady({ ...manifest, modelHash: hash("changed") }, audit)).toBe(false);
    expect(isSubmissionReady({
      ...manifest,
      modelHash: hash("other-model"),
      humanApproval: { ...manifest.humanApproval!, modelHash: hash("other-model") },
    }, audit)).toBe(false);
    expect(isSubmissionReady(manifest, { ...audit, fixedAtoms: 27 })).toBe(false);
    expect(isSubmissionReady(manifest, audit, "another-workflow")).toBe(false);

    const workflow = {
      ...createMaterialsWorkflow({ workflowId: "wf-1", goal: "adsorption energy", now: 1 }),
      stage: "approved" as const,
      modelAudit: audit,
      submissionManifest: manifest,
    };
    const submitted = transitionMaterialsWorkflow(workflow, "submitted", { at: 2, actor: "human:alice" });
    expect(submitted.stage).toBe("submitted");
    expect(submitted.events[0]?.eventId).toMatch(/^workflow-event_/);
    expect(submitted.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires a passed, evidence-backed validation before DFT completion", () => {
    const validating = {
      ...createMaterialsWorkflow({ workflowId: "wf-1", goal: "adsorption energy", now: 1 }),
      stage: "validating" as const,
    };
    expect(() => transitionMaterialsWorkflow(validating, "completed", { at: 4 })).toThrow(
      /scientific checks and independent human review/,
    );

    const failed = validationReport();
    failed.outcome = "failed";
    expect(() => transitionMaterialsWorkflow({ ...validating, validation: failed }, "completed"))
      .toThrow(/scientific checks and independent human review/);

    const inconclusive = validationReport();
    inconclusive.checks[0] = { ...inconclusive.checks[0], outcome: "inconclusive" };
    expect(() => transitionMaterialsWorkflow({ ...validating, validation: inconclusive }, "completed"))
      .toThrow(/scientific checks and independent human review/);

    const missingEvidence = validationReport();
    missingEvidence.checks[0] = { ...missingEvidence.checks[0], evidencePaths: [] };
    expect(() => transitionMaterialsWorkflow({ ...validating, validation: missingEvidence }, "completed"))
      .toThrow(/scientific checks and independent human review/);

    const validated = attachDFTValidation(validating, validationReport());
    expect(isDFTValidationReady(validated.validation, validated.workflowId)).toBe(true);
    const completed = transitionMaterialsWorkflow(validated, "completed", { at: 4, actor: "human:alice" });
    expect(completed.stage).toBe("completed");
    expect(completed.status).toBe("succeeded");
  });

  it("rejects validation reports belonging to another workflow", () => {
    const validating = {
      ...createMaterialsWorkflow({ workflowId: "wf-1", goal: "adsorption energy", now: 1 }),
      stage: "validating" as const,
    };
    const otherWorkflow = validationReport("wf-2");
    expect(isDFTValidationReady(otherWorkflow, "wf-1")).toBe(false);
    expect(() => attachDFTValidation(validating, otherWorkflow)).toThrow(
      /scientific checks and independent human review/,
    );
    expect(() => transitionMaterialsWorkflow({ ...validating, validation: otherWorkflow }, "completed"))
      .toThrow(/scientific checks and independent human review/);
  });
});
