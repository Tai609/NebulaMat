import { describe, expect, it } from "vitest";
import { agentModelForRole, agentRoleFromTask, reviewDecisionFromOutput } from "./agentAudit";

describe("agent audit metadata", () => {
  it("reads the delegated role from OpenCode task inputs", () => {
    expect(agentRoleFromTask({ subagent_type: "reader" }, "ignored")).toBe("reader");
    expect(agentRoleFromTask(undefined, "Source verifier")).toBe("source-verifier");
  });

  it("records an explicit or resolved agent model before falling back", () => {
    const agents = [
      {
        name: "reader",
        description: "",
        model: { providerID: "anthropic", modelID: "claude-sonnet" },
      },
    ];
    expect(agentModelForRole(agents, "reader", "fallback/model")).toBe(
      "anthropic/claude-sonnet",
    );
    expect(agentModelForRole(agents, "reader", "fallback/model", { model: "openai/gpt" })).toBe(
      "openai/gpt",
    );
  });

  it("extracts the independent review decision from the agent output", () => {
    const review = reviewDecisionFromOutput(
      'Done.\n```review\n{"findings":[{"level":"error","title":"Bad unit","evidence":"a.md:4"}],"note":"checked"}\n```',
    );
    expect(review?.findings[0]?.title).toBe("Bad unit");
  });
});
