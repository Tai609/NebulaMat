import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchRuntime } from "@ai4s/sdk";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  runtime: null as ResearchRuntime | null,
}));

vi.mock("@/lib/tauri", () => ({ isTauri: true }));
vi.mock("@/lib/researchWorkspace", () => ({
  initializeResearchWorkspace: async () => mocks.runtime,
  researchWorkspaceKey: () => "C:\\workspace",
}));

import { requestResearchAutopilot, setActiveResearchId } from "@/lib/researchConversation";
import { ResearchConversationBar } from "./ResearchConversationBar";

describe("ResearchConversationBar autopilot", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window.localStorage.clear();
    const runtime = new ResearchRuntime({ now: () => 1_700_000_000_000 });
    runtime.createResearch({
      researchId: "research-auto",
      title: "Autonomous mechanism study",
      objective: "Discriminate two mechanisms",
      now: 1_700_000_000_000,
    });
    mocks.runtime = runtime;
    setActiveResearchId("research-auto");
  });

  it("starts once, applies the structured response, and sends the next autonomous turn", async () => {
    const onContinue = vi.fn();
    const view = render(
      <ResearchConversationBar sessionId="session-auto" blocks={[]} onContinue={onContinue} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Start autonomous research" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
    expect(onContinue.mock.calls[0][0]).toContain("autonomous CEBRO research operator");

    view.rerender(
      <ResearchConversationBar
        sessionId="session-auto"
        blocks={[{
          kind: "agent",
          markdown: `\`\`\`json\n${JSON.stringify({
            schemaVersion: 1,
            stage: "inspect",
            graphHash: mocks.runtime!.getResearch("research-auto").hash,
            summary: "The current graph has one claim and no tested evidence.",
            hypotheses: [],
            actions: [],
            evidence: [],
            nextStage: "hypothesize",
            nextPrompt: "Formulate competing hypotheses and explicit falsifiers",
            done: false,
          })}\n\`\`\``,
        }]}
        onContinue={onContinue}
      />,
    );

    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(2));
    expect(onContinue.mock.calls[1][0]).toContain("Formulate competing hypotheses");

    view.rerender(
      <ResearchConversationBar
        sessionId="session-auto"
        blocks={[{
          kind: "agent",
          markdown: `\`\`\`json\n${JSON.stringify({
            schemaVersion: 1,
            stage: "hypothesize",
            graphHash: mocks.runtime!.getResearch("research-auto").hash,
            summary: "A competing mechanism remains plausible.",
            hypotheses: [{ id: "hypothesis:automatic", statement: "A second mechanism remains plausible" }],
            actions: [],
            evidence: [],
            nextStage: "plan",
            nextPrompt: "Plan the lowest-cost discriminating observation",
            done: false,
          })}\n\`\`\``,
        }]}
        onContinue={onContinue}
      />,
    );

    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(3));
    expect(onContinue.mock.calls[2][0]).toContain("Plan the lowest-cost");
    expect(mocks.runtime!.getResearch("research-auto").nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hypothesis:automatic", kind: "hypothesis" }),
    ]));
  });

  it("consumes a launch request from the research page without another button click", async () => {
    const onContinue = vi.fn();
    requestResearchAutopilot("research-auto");

    render(
      <ResearchConversationBar sessionId="session-auto" blocks={[]} onContinue={onContinue} />,
    );

    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
    expect(onContinue.mock.calls[0][0]).toContain("autonomous CEBRO research operator");
  });
});
