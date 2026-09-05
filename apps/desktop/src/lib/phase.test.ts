import { describe, expect, it } from "vitest";
import { parsePhaseDiagram } from "./phase";

// Li–O binary: pure elements at y=0, two stable oxides on the hull, and an
// unstable LiO sitting above the tie-line between them.
const DOC = JSON.stringify({
  elements: ["Li", "O"],
  entries: [
    { formula: "Li", composition: { Li: 1 }, formation_energy_per_atom: 0.0 },
    { formula: "O2", composition: { O: 1 }, formation_energy_per_atom: 0.0 },
    { formula: "Li2O", composition: { Li: 2, O: 1 }, formation_energy_per_atom: -2.0 },
    { formula: "LiO2", composition: { Li: 1, O: 2 }, formation_energy_per_atom: -1.0 },
    { formula: "LiO", composition: { Li: 1, O: 1 }, formation_energy_per_atom: -0.5 },
  ],
});

describe("parsePhaseDiagram", () => {
  const pd = parsePhaseDiagram(DOC);
  const by = (f: string) => pd.entries.find((e) => e.formula === f)!;

  it("computes composition x as the fraction of the second element", () => {
    expect(by("Li").x).toBeCloseTo(0);
    expect(by("O2").x).toBeCloseTo(1);
    expect(by("Li2O").x).toBeCloseTo(1 / 3);
    expect(by("LiO2").x).toBeCloseTo(2 / 3);
    expect(by("LiO").x).toBeCloseTo(1 / 2);
  });

  it("marks hull entries stable and off-hull entries metastable", () => {
    expect(by("Li2O").stable).toBe(true);
    expect(by("LiO2").stable).toBe(true);
    expect(by("Li").stable).toBe(true);
    expect(by("O2").stable).toBe(true);
    expect(by("LiO").stable).toBe(false);
  });

  it("computes energy above hull for the unstable phase", () => {
    // hull between Li2O(1/3,-2) and LiO2(2/3,-1): at x=1/2 the hull is -1.5,
    // so LiO at -0.5 sits 1.0 eV above the hull.
    expect(by("LiO").eAboveHull).toBeCloseTo(1.0, 6);
    expect(by("Li2O").eAboveHull).toBeCloseTo(0, 6);
  });

  it("returns the hull vertices sorted by composition", () => {
    const xs = pd.hull.map((h) => h.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(pd.hull.map((h) => h.formula)).toContain("Li2O");
    expect(pd.hull.map((h) => h.formula)).not.toContain("LiO");
  });

  it("rejects non-binary systems and invalid JSON", () => {
    expect(() => parsePhaseDiagram(JSON.stringify({ elements: ["A", "B", "C"], entries: [] }))).toThrow(
      /2 elements/,
    );
    expect(() => parsePhaseDiagram("{bad")).toThrow(/not valid JSON/);
  });
});
