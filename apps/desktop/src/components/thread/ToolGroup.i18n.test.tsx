import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/store";
import { ArtifactCard } from "./ArtifactCard";
import { StepSummaryRow } from "./StepSummaryRow";
import { ThreadView } from "./ThreadView";

// COPYCAT RULE: useUiStore is module-global; reset the locale after each test
// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

describe("ArtifactCard strings (i18n)", () => {
  it("renders the artifact kind, the producing tool, and the Open action in English", () => {
    render(
      <ArtifactCard
        block={{
          kind: "artifact",
          path: "figures/trend.png",
          filename: "trend.png",
          artifact: "figure",
          tool: "write",
        }}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("figure")).toBeInTheDocument();
    expect(screen.getByText("· via write")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});

describe("StepSummaryRow strings (i18n)", () => {
  it("renders the step count in English", () => {
    render(<StepSummaryRow block={{ kind: "step-summary", summary: "Prepped the dataset", steps: 3 }} />);
    expect(screen.getByText("3 steps")).toBeInTheDocument();
  });
});

describe("ThreadView strings (i18n)", () => {
  it("renders the example badge and sample-session notice in English", () => {
    render(
      <MemoryRouter>
        <ThreadView
          session={{
            id: "ses_1",
            projectId: "proj_1",
            title: "Demo session",
            group: "Examples",
            blocks: [],
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Example · read-only")).toBeInTheDocument();
    expect(
      screen.getByText("This is a sample session. Start a live agent session to chat for real."),
    ).toBeInTheDocument();
    expect(screen.getByText("New session")).toBeInTheDocument();
  });
});
