import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QCodeView } from "./QCodeView";

const DOC = JSON.stringify({
  sources: [{ id: "i1", title: "Interview 1", text: "I trust the doctor but fear the cost." }],
  codes: [{ name: "trust" }, { name: "fear" }],
  annotations: [
    { source: "i1", code: "trust", start: 2, end: 18 },
    { source: "i1", code: "fear", start: 23, end: 36 },
  ],
});

describe("QCodeView", () => {
  it("renders the codebook, highlighted spans, and the exact-quote guarantee", () => {
    const { container } = render(<QCodeView filename="study.qcode" text={DOC} />);
    expect(container.textContent).toContain("quotes are exact source spans");
    // codebook shows both codes
    expect(screen.getByRole("button", { name: /trust/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fear/ })).toBeInTheDocument();
    // highlighted spans are <mark> elements whose text is sliced from the source
    const marks = Array.from(container.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marks).toContain("trust the doctor");
    expect(marks).toContain("fear the cost");
  });

  it("shows a friendly error for a malformed coding file", () => {
    render(<QCodeView filename="bad.qcode" text="{ not json" />);
    expect(screen.getByText(/Could not read this coding file/)).toBeInTheDocument();
  });
});
