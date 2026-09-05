import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallStatus } from "@ai4s/shared";
import { ToolCallRow } from "./ToolCallRow";
import { useRuntimeStore } from "@/lib/runtime";

const STATUSES: [ToolCallStatus, string][] = [
  ["pending", "Pending"],
  ["running", "Running"],
  ["waiting-approval", "Waiting"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["failed", "Failed"],
];

describe("ToolCallRow", () => {
  afterEach(() => {
    useRuntimeStore.setState({ threads: {} });
  });

  it.each(STATUSES)("renders the %s status badge", (status, label) => {
    const { container } = render(
      <ToolCallRow block={{ kind: "tool-call", title: "Run tool", status }} />,
    );
    expect(container.querySelector(`[data-status="${status}"]`)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("shows the right-aligned meta", () => {
    render(
      <ToolCallRow
        block={{ kind: "tool-call", title: "Dispatch", status: "success", meta: "142 lines of output" }}
      />,
    );
    expect(screen.getByText("142 lines of output")).toBeInTheDocument();
  });

  it("shows the subagent's live activity under a running task row", () => {
    // The row self-subscribes to its child thread in the store (#34).
    useRuntimeStore.setState({
      threads: {
        ses_child: {
          blocks: [{ kind: "tool-call", title: "python3 analyze slide-03.jpg", status: "running" }],
          index: {},
          loaded: true,
        },
      },
    });
    render(
      <ToolCallRow
        block={{ kind: "tool-call", title: "Visual QA for slides", status: "running", childSessionId: "ses_child" }}
      />,
    );
    expect(screen.getByText("python3 analyze slide-03.jpg")).toBeInTheDocument();
  });

  it("hides the activity line once the task has settled", () => {
    useRuntimeStore.setState({
      threads: {
        ses_child: {
          blocks: [{ kind: "tool-call", title: "python3 analyze slide-03.jpg", status: "running" }],
          index: {},
          loaded: true,
        },
      },
    });
    render(
      <ToolCallRow
        block={{ kind: "tool-call", title: "Visual QA for slides", status: "success", childSessionId: "ses_child" }}
      />,
    );
    expect(screen.queryByText("python3 analyze slide-03.jpg")).not.toBeInTheDocument();
  });

  it("shows the inline output of a user-run shell command", () => {
    render(
      <ToolCallRow
        block={{
          kind: "tool-call",
          title: "pwd",
          status: "success",
          outputSummary: "/ws/2026-07-04-1030",
        }}
      />,
    );
    expect(screen.getByText("/ws/2026-07-04-1030")).toBeInTheDocument();
  });
});
