import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";
import { Composer } from "./Composer";
import { WorkflowStarters } from "./WorkflowStarters";

// COPYCAT RULE: useUiStore is module-global; reset the locale after each test
// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

describe("Composer strings (i18n)", () => {
  it("renders the default placeholder and the approval-mode switch in English", () => {
    render(<Composer onSend={() => {}} approvalMode="approve" onApprovalModeChange={() => {}} />);
    expect(screen.getByPlaceholderText("Ask anything")).toBeInTheDocument();
    expect(screen.getByLabelText("Approval mode")).toHaveTextContent("Approve for me");
  });
});

describe("WorkflowStarters strings (i18n)", () => {
  it("renders the welcome copy and a starter card's title/description in English", () => {
    render(<WorkflowStarters onPick={() => {}} />);
    expect(screen.getByText("What should we look into?")).toBeInTheDocument();
    expect(screen.getByText("Run a demo analysis, end to end")).toBeInTheDocument();
    expect(
      screen.getByText("Simulate a dataset, fit a model, and produce a figure and a traceable report."),
    ).toBeInTheDocument();
  });
});

describe("LiveSessionPage strings (i18n)", () => {
  it("renders the disconnected-runtime card in English (no Tauri sidecar in tests)", async () => {
    renderAt("/live");
    expect(await screen.findByText("DeepSeek Harness runtime")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) =>
        node?.textContent === "The desktop app runs a bundled DeepSeek Harness automatically. In the browser, start one with dsh --profile web and connect.",
      ),
    ).toBeInTheDocument();
  });
});
