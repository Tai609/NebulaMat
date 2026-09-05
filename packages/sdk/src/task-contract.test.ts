import { describe, expect, it } from "vitest";
import { validateAgentTaskPacket, validateAgentTaskResult } from "./task-contract";

const packet = {
  task_id: "task:reader:1",
  role: "reader",
  objective: "Extract claims from the supplied source.",
  input_paths: ["papers/source.pdf"],
  output_paths: ["evidence/source.md"],
  acceptance_criteria: ["Every claim has a source anchor."],
  exclusions: ["Do not search for new sources."],
  evidence_standard: "Direct source text only.",
  stop_conditions: ["Stop when the supplied source is exhausted."],
  permissions: { allowed_tools: ["read"], allowed_paths: ["papers/source.pdf"], may_delegate: false },
};

describe("typed subagent contract", () => {
  it("normalizes a bounded task packet", () => {
    expect(validateAgentTaskPacket(packet).task_id).toBe("task:reader:1");
  });

  it("rejects missing paths and invalid ids", () => {
    expect(() => validateAgentTaskPacket({ ...packet, task_id: "../escape" })).toThrow();
    expect(() => validateAgentTaskPacket({ ...packet, output_paths: [] })).toThrow();
  });

  it("requires a complete typed result", () => {
    expect(
      validateAgentTaskResult({
        task_id: "task:reader:1",
        agent_id: "ses_reader",
        status: "completed",
        started_at: 10,
        ended_at: 20,
        deliverables: ["evidence/source.md"],
        evidence: [{ kind: "path", reference: "papers/source.pdf#page=1" }],
        limitations: [],
      }).status,
    ).toBe("completed");
  });
});
