import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DosView } from "./DosView";

const SPIN = [
  "   2   2   1   0",
  "  1.0 1.0 1.0 1.0 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "  4.0 -4.0   4   1.0   1.0",
  " -4.0 0.0 0.0 0.0 0.0",
  " -1.0 0.8 0.7 0.5 0.4",
  "  1.0 1.5 1.4 1.2 1.1",
  "  4.0 0.0 0.0 2.0 1.9",
].join("\n");

function bytesOf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

describe("DosView", () => {
  it("renders a spin-polarized DOS with two filled areas and Fermi marker", () => {
    const { container } = render(<DosView filename="DOSCAR" bytes={bytesOf(SPIN)} />);
    expect(container.textContent).toContain("spin-polarized");
    expect(container.textContent).toContain("E_F");
    // spin-up + spin-down areas → at least two filled paths
    const filled = Array.from(container.querySelectorAll("path")).filter((p) =>
      (p.getAttribute("fill") ?? "").startsWith("var(--series"),
    );
    expect(filled.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: /E − E_F/ })).toBeInTheDocument();
  });

  it("shows a friendly error for non-DOSCAR bytes", () => {
    render(<DosView filename="DOSCAR" bytes={bytesOf("not a doscar\n")} />);
    expect(screen.getByText(/Could not read this DOSCAR/)).toBeInTheDocument();
  });
});
