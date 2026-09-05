import assert from "node:assert/strict";
import test from "node:test";
import { admissionReason, inject } from "./index.js";

const hash = "a".repeat(64);

function approvedArguments(command = "sbatch run.slurm") {
  return {
    command,
    submission_manifest: {
      modelHash: hash,
      parametersHash: hash,
      auditHash: hash,
      costHash: hash,
      hash,
      command,
      humanApproval: {
        decision: "approved",
        actor: "human:alice",
        approvedAt: 1,
        modelHash: hash,
        parametersHash: hash,
        auditHash: hash,
        costHash: hash,
      },
    },
    dft_model_audit: { modelHash: hash, costHash: hash, hash },
  };
}

test("declares the DSH tools injection and preserves preparation reads", () => {
  assert.deepEqual(inject, ["tools"]);
  assert.equal(admissionReason({ name: "read", arguments: { path: "POSCAR" } }), undefined);
});

test("blocks the disabled built-in DeepSeek web tools and points to browser control", () => {
  assert.match(
    admissionReason({ name: "web_search", arguments: { query: "DFT" } }),
    /browser-control/,
  );
  assert.match(
    admissionReason({ name: "web_fetch", arguments: { url: "https://example.com" } }),
    /browser-control/,
  );
});

test("blocks nested remote commands before dispatch", () => {
  const reason = admissionReason({ name: "bash", arguments: { command: "bash -lc 'sbatch run.slurm'" } });
  assert.match(reason, /named human approval/);
});

test("allows only the hash-bound named-human approval", () => {
  assert.equal(admissionReason({ name: "bash", arguments: approvedArguments() }), undefined);
  const stale = approvedArguments();
  stale.command = "sbatch other.slurm";
  assert.match(
    admissionReason({ name: "bash", arguments: stale }),
    /command does not match/,
  );
});
