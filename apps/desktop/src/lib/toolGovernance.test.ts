import { describe, expect, it } from "vitest";
import { stableHash, type DFTModelAudit, type SubmissionManifest } from "@ai4s/shared";
import { classifyToolRisk, decideToolAdmission, hasNamedHumanApproval } from "./toolGovernance";

const hash = (value: string) => stableHash(value);

function submissionRecords(): { audit: DFTModelAudit; manifest: SubmissionManifest } {
  const audit: DFTModelAudit = {
    schemaVersion: 1,
    auditId: "audit-1",
    decision: "approved",
    activePhase: "candidate-surface",
    atomCount: 48,
    freeAtoms: 20,
    fixedAtoms: 28,
    kpoints: { mesh: [3, 3, 1] },
    memoryEstimateGb: 32,
    plannedRunCount: 4,
    lowerCostAlternative: "Screen a smaller cell first.",
    frozenLayerPolicy: "Relax the adsorbate and top two layers.",
    scientificJustification: "Candidate active surface.",
    convergenceEvidence: [],
    warnings: [],
    modelHash: hash("POSCAR"),
    costHash: hash("cost"),
    hash: hash("audit"),
    eventId: "audit-event-1",
  };
  const parametersHash = hash("INCAR+KPOINTS");
  const manifest: SubmissionManifest = {
    schemaVersion: 1,
    manifestId: "manifest-1",
    workflowId: "workflow-1",
    modelHash: audit.modelHash,
    parametersHash,
    auditHash: audit.hash,
    costHash: audit.costHash,
    artifacts: [{ path: "POSCAR", role: "structure", hash: audit.modelHash }],
    command: "sbatch run.slurm",
    surface: "hpc",
    humanApproval: {
      decision: "approved",
      actor: "human:alice",
      approvedAt: 1,
      modelHash: audit.modelHash,
      parametersHash,
      auditHash: audit.hash,
      costHash: audit.costHash,
      eventId: "approval-event-1",
    },
    hash: hash("manifest"),
    eventId: "manifest-event-1",
  };
  return { audit, manifest };
}

describe("research tool governance", () => {
  it("blocks the disabled built-in DeepSeek web tools and points to browser control", () => {
    expect(decideToolAdmission({ sessionId: "s", callId: "c", tool: "web_search", input: { query: "DFT" } }))
      .toEqual(expect.objectContaining({ decision: "block", reason: expect.stringContaining("browser-control") }));
    expect(decideToolAdmission({ sessionId: "s", callId: "c2", tool: "web_fetch", input: { url: "https://example.com" } }))
      .toEqual(expect.objectContaining({ decision: "block", reason: expect.stringContaining("browser-control") }));
  });

  it("lets ordinary reads and DFT preparation proceed", () => {
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "read", input: { path: "POSCAR" } })).toBe("dft-preparation");
    expect(decideToolAdmission({ sessionId: "s", callId: "c", tool: "read", input: { path: "README.md" } })).toEqual({ decision: "allow" });
  });

  it("blocks remote and DFT execution until exact human approval exists", () => {
    const context = { sessionId: "s", callId: "c", tool: "bash", input: { command: "sbatch run_vasp.sh" } };
    expect(classifyToolRisk(context)).toBe("remote-execution");
    expect(decideToolAdmission(context).decision).toBe("require-human-approval");
  });

  it("classifies only an executor's operative command as remote execution", () => {
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "read", input: { path: "docs/sbatch-notes.md" } })).toBe("ordinary");
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "write", input: { content: "ssh cluster" } })).toBe("mutating");
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "bash", input: { command: "git commit -m 'document sbatch'" } })).toBe("mutating");
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "bash", input: { command: "env NODES=1 sbatch run.slurm" } })).toBe("remote-execution");
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "bash", input: { command: "bash -lc 'sbatch run.slurm'" } })).toBe("remote-execution");
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "ssh_connect", input: { host: "cluster" } })).toBe("remote-execution");
    expect(classifyToolRisk({ sessionId: "s", callId: "c", tool: "mcp.materials.submit_dft", input: {} })).toBe("remote-execution");
  });

  it("prefers the DFT submission contracts and rejects stale bindings", () => {
    const { audit, manifest } = submissionRecords();
    const context = {
      sessionId: "s",
      callId: "c",
      tool: "bash",
      input: { command: "sbatch run.slurm", submission_manifest: manifest, dft_model_audit: audit },
    };
    expect(decideToolAdmission(context)).toEqual({ decision: "allow" });
    expect(decideToolAdmission({ ...context, input: { ...context.input, command: "sbatch another.slurm" } }).decision)
      .toBe("require-human-approval");
    expect(decideToolAdmission({
      ...context,
      input: {
        ...context.input,
        submission_manifest: { ...manifest, modelHash: hash("changed") },
        human_approval: {
          decision: "approved",
          actor: "human:alice",
          model_sha256: "0".repeat(64),
          parameters_sha256: "1".repeat(64),
          audit_sha256: "2".repeat(64),
          cost_sha256: "3".repeat(64),
        },
      },
    }).decision).toBe("require-human-approval");
  });

  it("requires a named human and all four hash bindings", () => {
    const approval = {
      decision: "approved",
      actor: "human:alice",
      model_sha256: "0".repeat(64),
      parameters_sha256: "1".repeat(64),
      audit_sha256: "2".repeat(64),
      cost_sha256: "3".repeat(64),
    };
    expect(hasNamedHumanApproval(approval)).toBe(true);
    expect(hasNamedHumanApproval({ ...approval, actor: "materials-reviewer" })).toBe(false);
    expect(hasNamedHumanApproval({ ...approval, cost_sha256: "" })).toBe(false);
  });
});
