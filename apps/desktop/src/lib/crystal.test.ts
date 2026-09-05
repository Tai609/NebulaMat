import { describe, expect, it } from "vitest";
import {
  catalogEntryFor,
  buildPeriodicRenderModel,
  crystalFromApiPayload,
  expandPeriodicRenderModel,
  inferConservativeBonds,
  isMaterialsProjectId,
  normalizeElement,
  parseCif,
  parseLammpsDumpFrames,
  parsePoscar,
  parseXdatcarFrames,
} from "./crystal";

describe("Materials Project crystal records", () => {
  it("recognizes MP ids and carries offline structures for the screening examples", () => {
    expect(isMaterialsProjectId("mp-35596")).toBe(true);
    expect(isMaterialsProjectId("mp-nope")).toBe(false);
    expect(catalogEntryFor("MP-35596")).toMatchObject({
      formula: "NiFe2O4",
      crystalSystem: "cubic",
      bandGap: 1.38,
    });
    expect(catalogEntryFor("mp-19326")).toMatchObject({ formula: "MnO2", crystalSystem: "tetragonal" });
  });

  it("normalizes a Materials Project structure response", () => {
    const parsed = crystalFromApiPayload({
      data: [{
        formula_pretty: "NiO",
        symmetry: { crystal_system: "Cubic", symbol: "Fm-3m" },
        structure: {
          lattice: { a: 4.17, b: 4.17, c: 4.17, alpha: 90, beta: 90, gamma: 90 },
          sites: [
            { species: [{ element: "Ni" }], abc: [0, 0, 0] },
            { species: [{ element: "O" }], abc: [0.5, 0.5, 0.5] },
          ],
        },
      }],
    }, "mp-19009");
    expect(parsed).toMatchObject({
      materialId: "mp-19009",
      formula: "NiO",
      lattice: { lengths: [4.17, 4.17, 4.17], angles: [90, 90, 90] },
      sites: [{ element: "Ni", frac: [0, 0, 0] }, { element: "O", frac: [0.5, 0.5, 0.5] }],
    });
  });

  it("normalizes element symbols from API and CIF variants", () => {
    expect(normalizeElement("fe3+")).toBe("Fe");
    expect(normalizeElement("13C")).toBe("C");
    expect(normalizeElement("site1")).toBe("site1");

    const api = crystalFromApiPayload({
      lattice: { lengths: [3, 3, 3], angles: [90, 90, 90] },
      sites: [{ element: "si", frac: [0, 0, 0] }, { element: "fe3+", frac: [0.5, 0.5, 0.5] }],
    });
    expect(api?.sites.map((site) => site.element)).toEqual(["Si", "Fe"]);

    const cif = parseCif(`
_cell_length_a 3
_cell_length_b 3
_cell_length_c 3
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
si1 0 0 0
fe3+ 0.5 0.5 0.5
`);
    expect(cif?.sites.map((site) => site.element)).toEqual(["Si", "Fe"]);
  });

  it("parses a CIF cell and fractional atom sites", () => {
    const parsed = parseCif(`
data_NiO
_cell_length_a 4.17(1)
_cell_length_b 4.17
_cell_length_c 4.17
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ni 0(1) 0 0
O 0.5 0.5 0.5
loop_
_audit_note
kept separate from atom sites
`);
    expect(parsed?.lattice.lengths).toEqual([4.17, 4.17, 4.17]);
    expect(parsed?.sites).toEqual([
      { element: "Ni", frac: [0, 0, 0] },
      { element: "O", frac: [0.5, 0.5, 0.5] },
    ]);
  });

  it("parses Direct POSCAR sites and preserves the lattice matrix", () => {
    const parsed = parsePoscar(`NiO
1.0
3.0 0 0
0 3.0 0
0 0 3.0
Ni O
1 1
Direct
0 0 0
0.5 0.5 0.5
`);
    expect(parsed).toMatchObject({
      formula: "NiO",
      lattice: { lengths: [3, 3, 3], matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]] },
      sites: [{ element: "Ni", frac: [0, 0, 0] }, { element: "O", frac: [0.5, 0.5, 0.5] }],
    });
  });

  it("parses all XDATCAR ionic configurations", () => {
    const frames = parseXdatcarFrames(`NiO
1.0
3 0 0
0 3 0
0 0 3
Ni O
1 1
Direct configuration=     1
0 0 0
0.5 0.5 0.5
Direct configuration=     2
0.1 0 0
0.6 0.5 0.5
`);
    expect(frames).toHaveLength(2);
    expect(frames[1].sites[0].frac[0]).toBeCloseTo(0.1);
  });

  it("parses scaled LAMMPS dump frames", () => {
    const frames = parseLammpsDumpFrames(`ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 4
0 4
0 4
ITEM: ATOMS id element xs ys zs
2 O 0.5 0.5 0.5
1 Ni 0 0 0
`);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      lattice: { lengths: [4, 4, 4] },
      sites: [{ siteId: "1", element: "Ni", frac: [0, 0, 0] }, { siteId: "2", element: "O", frac: [0.5, 0.5, 0.5] }],
    });
  });

  it("parses compiler JSON bonds and creates each referenced oxygen image once", () => {
    const structure = crystalFromApiPayload({
      formula: "NiO",
      lattice: { matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], lengths: [3, 3, 3], angles: [90, 90, 90] },
      sites: [{ site_id: "Ni-1", element: "Ni", frac: [0, 0, 0] }, { site_id: "O-1", element: "O", frac: [0.9, 0, 0] }],
      bonds: [
        { site_index_a: 0, site_index_b: 1, image_shift: [-1, 0, 0], length_angstrom: 0.3 },
        { site_index_a: 0, site_index_b: 1, image_shift: [-1, 0, 0], length_angstrom: 0.3 },
      ],
      source: "openscience-structure-compiler",
    });
    expect(structure?.bonds).toHaveLength(2);
    const model = buildPeriodicRenderModel(structure!);
    expect(new Set(model.atoms.map((atom) => atom.key)).size).toBe(model.atoms.length);
    expect(model.atoms.filter((atom) => atom.siteIndex === 1 && atom.imageShift[0] === -1)).toHaveLength(1);
    expect(model.bonds).toHaveLength(2);
  });

  it("keeps both directions of a periodic bond local to the central cell", () => {
    const structure = crystalFromApiPayload({
      formula: "NiO",
      lattice: { matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], lengths: [3, 3, 3], angles: [90, 90, 90] },
      sites: [{ element: "Ni", frac: [0, 0, 0] }, { element: "O", frac: [0.9, 0, 0] }],
      bonds: [{ site_index_a: 0, site_index_b: 1, image_shift: [-1, 0, 0], length_angstrom: 0.3 }],
    });
    const model = buildPeriodicRenderModel(structure!);
    const atomByKey = new Map(model.atoms.map((atom) => [atom.key, atom]));
    const lengths = model.bonds.map((bond) => {
      const a = atomByKey.get(bond.atomKeyA)!;
      const b = atomByKey.get(bond.atomKeyB)!;
      return Math.hypot(...a.frac.map((value, axis) => (b.frac[axis] - value) * 3));
    });

    expect(lengths).toHaveLength(2);
    expect(lengths.every((length) => Math.abs(length - 0.3) < 1e-9)).toBe(true);
  });

  it("expands boundary atoms and periodic bonds without duplicate instances", () => {
    const structure = crystalFromApiPayload({
      formula: "NiO",
      lattice: { matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], lengths: [3, 3, 3], angles: [90, 90, 90] },
      sites: [{ element: "Ni", frac: [0, 0, 0] }, { element: "O", frac: [0.9, 0, 0] }],
      bonds: [{ site_index_a: 0, site_index_b: 1, image_shift: [-1, 0, 0], length_angstrom: 0.3 }],
    })!;
    const expanded = expandPeriodicRenderModel(buildPeriodicRenderModel(structure), 1);
    const atomKeys = expanded.model.atoms.map((atom) => atom.key);
    const bondKeys = expanded.model.bonds.map((bond) => bond.key);

    expect(atomKeys).toContain("0@1,0,0");
    expect(new Set(atomKeys).size).toBe(atomKeys.length);
    expect(new Set(bondKeys).size).toBe(bondKeys.length);
    expect(expanded.model.bonds.length).toBeGreaterThan(0);
  });

  it("does not create cell-spanning bonds for the NiFe2O4 catalog structure", () => {
    const structure = catalogEntryFor("mp-35596")!;
    const model = buildPeriodicRenderModel(structure, inferConservativeBonds(structure));
    const atomByKey = new Map(model.atoms.map((atom) => [atom.key, atom]));
    const lengths = model.bonds.map((bond) => {
      const a = atomByKey.get(bond.atomKeyA)!;
      const b = atomByKey.get(bond.atomKeyB)!;
      return Math.hypot(
        (b.frac[0] - a.frac[0]) * structure.lattice.lengths[0],
        (b.frac[1] - a.frac[1]) * structure.lattice.lengths[1],
        (b.frac[2] - a.frac[2]) * structure.lattice.lengths[2],
      );
    });

    expect(lengths.length).toBeGreaterThan(100);
    expect(Math.max(...lengths)).toBeLessThan(2.5);
  });

  it("fallback bonding does not connect O-O or metal-metal pairs", () => {
    const structure = {
      lattice: { lengths: [3, 3, 3] as [number, number, number], angles: [90, 90, 90] as [number, number, number] },
      sites: [
        { element: "Ni", frac: [0, 0, 0] as [number, number, number] },
        { element: "Fe", frac: [0.2, 0, 0] as [number, number, number] },
        { element: "O", frac: [0.5, 0.5, 0.5] as [number, number, number] },
        { element: "O", frac: [0.55, 0.5, 0.5] as [number, number, number] },
      ],
    };
    const bonds = inferConservativeBonds(structure);
    expect(bonds.every((bond) => structure.sites[bond.siteIndexA].element === "O" || structure.sites[bond.siteIndexB].element === "O")).toBe(true);
    expect(bonds.every((bond) => structure.sites[bond.siteIndexA].element !== structure.sites[bond.siteIndexB].element)).toBe(true);
  });
});
