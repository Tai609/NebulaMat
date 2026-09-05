import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactBlock } from "@ai4s/shared";
import { PresentedArtifactPane } from "./PresentedArtifactPane";

const artifact: ArtifactBlock = {
  kind: "artifact",
  path: "notes/result.md",
  filename: "result.md",
  artifact: "report",
  tool: "present_artifact",
  content: "# Result",
  presentation: { mode: "panel", title: "Result" },
};

describe("PresentedArtifactPane", () => {
  it("confirms before removing the panel from its Screen", async () => {
    const onClose = vi.fn();
    render(
      <PresentedArtifactPane
        artifact={artifact}
        leafId="leaf-artifact"
        sessionId="session-a"
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /close inspector/i }));
    expect(screen.getByRole("alertdialog", { name: "Close this panel?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /close inspector/i }));
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
