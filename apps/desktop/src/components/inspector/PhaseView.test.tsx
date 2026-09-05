import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseView } from "./PhaseView";

const DOC = JSON.stringify({
  elements: ["Li", "O"],
  entries: [
    { formula: "Li", composition: { Li: 1 }, formation_energy_per_atom: 0.0 },
    { formula: "O2", composition: { O: 1 }, formation_energy_per_atom: 0.0 },
    { formula: "Li2O", composition: { Li: 2, O: 1 }, formation_energy_per_atom: -2.0 },
    { formula: "LiO", composition: { Li: 1, O: 1 }, formation_energy_per_atom: -0.5 },
  ],
});

describe("PhaseView", () => {
  it("renders the system, phase counts, hull path, and stable labels", () => {
    const { container } = render(<PhaseView filename="LiO.phase" text={DOC} />);
    expect(container.textContent).toContain("Li–O");
    expect(container.textContent).toContain("stable");
    expect(container.textContent).toContain("formation energy (eV/atom)");
    // a hull polyline + a circle per entry
    expect(container.querySelector("path")).not.toBeNull();
    expect(container.querySelectorAll("circle").length).toBe(4);
    // Li2O (stable) is labeled; LiO (metastable) label only shows on hover
    expect(container.textContent).toContain("Li2O");
  });

  it("shows a friendly error for a non-binary or malformed file", () => {
    render(<PhaseView filename="bad.phase" text={JSON.stringify({ elements: ["A"], entries: [] })} />);
    expect(screen.getByText(/Could not read this phase diagram/)).toBeInTheDocument();
  });
});
