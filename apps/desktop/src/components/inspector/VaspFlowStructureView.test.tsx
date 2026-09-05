import { describe, expect, it } from "vitest";
import { crystalStructureToVaspFlowScene } from "./VaspFlowStructureView";

describe("crystalStructureToVaspFlowScene", () => {
  it("keeps periodic bonds attached to explicit image atoms", () => {
    const scene = crystalStructureToVaspFlowScene({
      formula: "Li2",
      lattice: {
        lengths: [4, 4, 4],
        angles: [90, 90, 90],
        matrix: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      },
      sites: [
        { element: "Li", frac: [0.05, 0.5, 0.5] },
        { element: "Li", frac: [0.95, 0.5, 0.5] },
      ],
      bonds: [{
        siteIndexA: 0,
        siteIndexB: 1,
        imageShift: [-1, 0, 0],
        lengthAngstrom: 0.4,
        kind: "periodic",
      }],
    });

    expect(scene.summary.formula).toBe("Li2");
    expect(scene.atoms).toHaveLength(3);
    expect(scene.atoms[2].is_periodic_image).toBe(true);
    expect(scene.bonds[0]).toMatchObject({ start_atom_index: 0, end_atom_index: 2 });
    expect(scene.atoms[2].position[0]).toBeCloseTo(-0.2);
  });
});
