import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GenomeView } from "./GenomeView";

const BED = "chr1\t0\t100\tgeneA\t500\t+\nchr1\t150\t260\tgeneB\t0\t-\nchr2\t0\t50\tgeneC";

describe("GenomeView", () => {
  it("renders features from a BED file as track rects with a format badge", () => {
    const { container } = render(<GenomeView filename="ann.bed" text={BED} />);
    expect(screen.getByText("BED")).toBeInTheDocument();
    // chr1 is busiest (2 features) → default contig; both features drawn as rects.
    const rects = container.querySelectorAll("svg rect");
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/2 features/)).toBeInTheDocument();
  });

  it("offers a contig selector when multiple contigs are present", () => {
    render(<GenomeView filename="ann.bed" text={BED} />);
    const select = screen.getByRole("combobox", { name: /contig/i });
    expect(select).toBeInTheDocument();
    // Two contigs listed; chr1 first (busiest).
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["chr1 (2)", "chr2 (1)"]);
  });

  it("switches contigs", async () => {
    render(<GenomeView filename="ann.bed" text={BED} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /contig/i }), "1");
    expect(screen.getByText(/1 features/)).toBeInTheDocument(); // chr2 has one
  });

  it("shows an empty state for a file with no features", () => {
    render(<GenomeView filename="empty.gff" text="##gff-version 3\n# nothing else\n" />);
    expect(screen.getByText(/No features found/)).toBeInTheDocument();
  });
});
