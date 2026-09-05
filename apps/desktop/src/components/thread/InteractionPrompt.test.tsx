import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PermissionAskedEvent, QuestionAskedEvent } from "@ai4s/sdk";
import { InteractionPrompt } from "./InteractionPrompt";

const singleQ: QuestionAskedEvent = {
  type: "question.asked",
  sessionId: "ses_1",
  requestId: "que_1",
  questions: [
    {
      question: "Which data file should I analyze?",
      header: "Select file",
      options: [
        { label: "atlas.csv", description: "3 rows: species" },
        { label: "export.csv", description: "306 rows" },
      ],
    },
  ],
};

const multiQ: QuestionAskedEvent = {
  ...singleQ,
  requestId: "que_2",
  questions: [{ ...singleQ.questions[0], multiple: true }],
};

const noop = () => {};

describe("InteractionPrompt — question", () => {
  it("answers immediately on click for a single-select question", async () => {
    const onAnswer = vi.fn();
    render(<InteractionPrompt question={singleQ} onAnswer={onAnswer} onReject={noop} onPermission={noop} />);
    await userEvent.click(screen.getByText("atlas.csv"));
    expect(onAnswer).toHaveBeenCalledWith("que_1", [["atlas.csv"]]);
  });

  it("collects multiple selections behind a Submit for a multi-select question", async () => {
    const onAnswer = vi.fn();
    render(<InteractionPrompt question={multiQ} onAnswer={onAnswer} onReject={noop} onPermission={noop} />);
    // No immediate answer on click.
    await userEvent.click(screen.getByText("atlas.csv"));
    await userEvent.click(screen.getByText("export.csv"));
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onAnswer).toHaveBeenCalledWith("que_2", [["atlas.csv", "export.csv"]]);
  });

  it("skips a question via reject", async () => {
    const onReject = vi.fn();
    render(<InteractionPrompt question={singleQ} onAnswer={noop} onReject={onReject} onPermission={noop} />);
    await userEvent.click(screen.getByText("Skip"));
    expect(onReject).toHaveBeenCalledWith("que_1");
  });
});

describe("InteractionPrompt — permission", () => {
  const perm: PermissionAskedEvent = {
    type: "permission.asked",
    sessionId: "ses_1",
    requestId: "per_1",
    action: "bash",
    resources: ["rm -rf build/"],
  };

  it("shows the action and resources and replies once / always / reject", async () => {
    const onPermission = vi.fn();
    render(<InteractionPrompt permission={perm} onAnswer={noop} onReject={noop} onPermission={onPermission} />);
    expect(screen.getByText("rm -rf build/")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onPermission).toHaveBeenCalledWith("per_1", "once");
    await userEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(onPermission).toHaveBeenCalledWith("per_1", "always");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onPermission).toHaveBeenCalledWith("per_1", "reject");
  });
});
