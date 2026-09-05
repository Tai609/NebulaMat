import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BandView } from "./BandView";

const EIGENVAL = [
  "   2   2   2   1",
  "  0.1 0.1 0.1 0.1 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "    8   2   2",
  "",
  "  0.0 0.0 0.0  1.0",
  "   1  -5.0  1.0",
  "   2   4.0  0.0",
  "",
  "  0.5 0.0 0.0  1.0",
  "   1  -4.5  1.0",
  "   2   3.5  0.0",
].join("\n");

function bytesOf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

describe("BandView", () => {
  it("renders one polyline per band with axis labels", () => {
    const { container } = render(<BandView filename="EIGENVAL" bytes={bytesOf(EIGENVAL)} />);
    expect(container.textContent).toContain("2 bands × 2 k-points");
    expect(container.textContent).toContain("Energy (eV)");
    // one <path> per band (2 bands)
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("shows a friendly error for non-EIGENVAL bytes", () => {
    render(<BandView filename="EIGENVAL" bytes={bytesOf("nope\n")} />);
    expect(screen.getByText(/Could not read this EIGENVAL/)).toBeInTheDocument();
  });
});
