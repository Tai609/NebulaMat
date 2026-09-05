import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReviewerCard } from "./ReviewerCard";

const block = {
  kind: "reviewer" as const,
  findings: [
    {
      level: "warn" as const,
      title: "Duplicate PMID in plan",
      evidence: "same PMID for two papers",
      check: "citation" as const,
    },
    { level: "error" as const, title: "Figure older than its code", check: "figure" as const },
  ],
};

describe("ReviewerCard", () => {
  it("shows finding badges, check tags, and titles, expanded by default", () => {
    render(<ReviewerCard block={block} />);
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(screen.getByText("Duplicate PMID in plan")).toBeInTheDocument();
    expect(screen.getByText("same PMID for two papers")).toBeInTheDocument();
    expect(screen.getByText("citation")).toBeInTheDocument();
    expect(screen.getByText("figure ↔ code")).toBeInTheDocument();
    expect(screen.getByText("· 2 findings")).toBeInTheDocument();
  });

  it("collapses when the header is clicked", async () => {
    render(<ReviewerCard block={block} />);
    await userEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("same PMID for two papers")).not.toBeInTheDocument();
  });

  it("dismisses findings one by one", async () => {
    render(<ReviewerCard block={block} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss finding: Duplicate PMID in plan" }),
    );
    expect(screen.queryByText("Duplicate PMID in plan")).not.toBeInTheDocument();
    expect(screen.getByText("· 1 finding · 1 dismissed")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss finding: Figure older than its code" }),
    );
    expect(screen.getByText("All findings dismissed.")).toBeInTheDocument();
  });
});
