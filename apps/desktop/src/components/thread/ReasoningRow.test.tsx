import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReasoningRow } from "./ReasoningRow";

const block = { kind: "reasoning" as const, text: "checking the dataset shape" };

describe("ReasoningRow", () => {
  it("keeps streaming thoughts folded under the Thinking… label", () => {
    render(<ReasoningRow block={block} streaming />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    expect(screen.queryByText("checking the dataset shape")).not.toBeInTheDocument();
  });

  it("collapses to a Thought line once done, hiding the text until expanded", () => {
    render(<ReasoningRow block={block} />);
    expect(screen.getByText("Thought")).toBeInTheDocument();
    expect(screen.queryByText("checking the dataset shape")).not.toBeInTheDocument();
  });

  it("a done thought expands on click", () => {
    render(<ReasoningRow block={block} />);
    fireEvent.click(screen.getByText("Thought"));
    expect(screen.getByText("checking the dataset shape")).toBeInTheDocument();
  });
});
