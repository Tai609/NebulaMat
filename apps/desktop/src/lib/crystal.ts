/** Crystal structure data and small, dependency-free parsers used by the
 * Materials Project preview. Coordinates are fractional unless noted. */

export interface CrystalSite {
  siteId?: string;
  element: string;
  /** Fractional coordinates in the unit cell. */
  frac: [number, number, number];
  occupancy?: number;
  oxidationState?: number | null;
  properties?: Record<string, unknown>;
}

export interface CrystalBond {
  siteIndexA: number;
  siteIndexB: number;
  /** Periodic image of B relative to A. */
  imageShift: [number, number, number];
  lengthAngstrom?: number;
  kind?: "bond" | "coordination" | "periodic";
}

export interface CrystalLattice {
  lengths: [number, number, number];
  angles: [number, number, number];
  matrix?: [[number, number, number], [number, number, number], [number, number, number]];
}

export interface CrystalStructure {
  materialId?: string;
  formula?: string;
  lattice: CrystalLattice;
  sites: CrystalSite[];
  crystalSystem?: string;
  spaceGroup?: string;
  bonds?: CrystalBond[];
  /** Periodic axes. Crystals default to all three; surface trajectories can
   * explicitly disable the vacuum direction. */
  pbc?: [boolean, boolean, boolean];
  source?: string;
}

export interface PeriodicAtomInstance {
  key: string;
  siteIndex: number;
  imageShift: [number, number, number];
  frac: [number, number, number];
}

export interface PeriodicBondInstance {
  key: string;
  atomKeyA: string;
  atomKeyB: string;
  siteIndexA: number;
  siteIndexB: number;
  imageShiftA: [number, number, number];
  imageShiftB: [number, number, number];
}

export interface PeriodicRenderModel {
  atoms: PeriodicAtomInstance[];
  bonds: PeriodicBondInstance[];
}

export interface CrystalCatalogEntry extends CrystalStructure {
  materialId: string;
  label: string;
  summary: string;
  bandGap?: number;
  energyAboveHull?: number;
  metallic?: boolean;
}

function spinelSites(tetrahedral: string, octahedral: string, oxygenU = 0.255): CrystalSite[] {
  const tetra: Array<[number, number, number]> = [
    [0.125, 0.125, 0.125], [0.125, 0.625, 0.625], [0.625, 0.125, 0.625], [0.625, 0.625, 0.125],
    [0.875, 0.875, 0.875], [0.875, 0.375, 0.375], [0.375, 0.875, 0.375], [0.375, 0.375, 0.875],
  ];
  const octa: Array<[number, number, number]> = [
    [0.5, 0.5, 0.5], [0.5, 0.75, 0.75], [0.75, 0.5, 0.75], [0.75, 0.75, 0.5],
    [0, 0, 0.5], [0, 0.25, 0.75], [0.25, 0, 0.75], [0.25, 0.25, 0.5],
    [0, 0.5, 0], [0, 0.75, 0.25], [0.25, 0.5, 0.25], [0.25, 0.75, 0],
    [0.5, 0, 0], [0.5, 0.25, 0.25], [0.75, 0, 0.25], [0.75, 0.25, 0],
  ];
  const centerings: Array<[number, number, number]> = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
  const oxygen: Array<[number, number, number]> = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    for (const translation of centerings) {
      oxygen.push([
        (sx * oxygenU + translation[0] + 1) % 1,
        (sy * oxygenU + translation[1] + 1) % 1,
        (sz * oxygenU + translation[2] + 1) % 1,
      ]);
    }
  }
  return [
    ...tetra.map((frac) => ({ element: tetrahedral, frac })),
    ...octa.map((frac) => ({ element: octahedral, frac })),
    ...oxygen.map((frac) => ({ element: "O", frac })),
  ];
}

function rutileSites(metal: string, oxygenU = 0.305): CrystalSite[] {
  return [
    { element: metal, frac: [0, 0, 0] },
    { element: metal, frac: [0.5, 0.5, 0.5] },
    { element: "O", frac: [oxygenU, oxygenU, 0] },
    { element: "O", frac: [1 - oxygenU, 1 - oxygenU, 0] },
    { element: "O", frac: [(0.5 + oxygenU) % 1, (0.5 - oxygenU + 1) % 1, 0.5] },
    { element: "O", frac: [(0.5 - oxygenU + 1) % 1, (0.5 + oxygenU) % 1, 0.5] },
  ];
}

/** Conventional-cell structures for the examples used by the materials
 * screening workflow. They keep the viewer useful offline while live MP
 * records remain the source for ids outside this small catalog. */
export const CRYSTAL_CATALOG: readonly CrystalCatalogEntry[] = [
  {
    materialId: "mp-35596",
    label: "NiFe2O4",
    formula: "NiFe2O4",
    summary: "Ni-Fe benchmark chemistry",
    bandGap: 1.38,
    energyAboveHull: 0,
    lattice: { lengths: [8.34, 8.34, 8.34], angles: [90, 90, 90] },
    crystalSystem: "cubic",
    spaceGroup: "Fd-3m",
    sites: spinelSites("Ni", "Fe"),
  },
  {
    materialId: "mp-1271793",
    label: "Co3O4",
    formula: "Co3O4",
    summary: "OER reference benchmark",
    bandGap: 1.47,
    energyAboveHull: 0,
    lattice: { lengths: [8.08, 8.08, 8.08], angles: [90, 90, 90] },
    crystalSystem: "cubic",
    spaceGroup: "Fd-3m",
    sites: spinelSites("Co", "Co"),
  },
  {
    materialId: "mp-1275132",
    label: "NiCo2O4",
    formula: "NiCo2O4",
    summary: "Highest conductivity candidate",
    energyAboveHull: 0.058,
    metallic: true,
    lattice: { lengths: [8.11, 8.11, 8.11], angles: [90, 90, 90] },
    crystalSystem: "cubic",
    spaceGroup: "Fd-3m",
    sites: spinelSites("Ni", "Co"),
  },
  {
    materialId: "mp-36843",
    label: "NiMn2O4",
    formula: "NiMn2O4",
    summary: "Low-cost alternative",
    energyAboveHull: 0.013,
    metallic: true,
    lattice: { lengths: [8.44, 8.44, 8.44], angles: [90, 90, 90] },
    crystalSystem: "cubic",
    spaceGroup: "Fd-3m",
    sites: spinelSites("Ni", "Mn"),
  },
  {
    materialId: "mp-19326",
    label: "beta-MnO2",
    formula: "MnO2",
    summary: "Lowest-cost option; Mn dissolution risk",
    energyAboveHull: 0.016,
    metallic: true,
    lattice: { lengths: [4.40, 4.40, 2.87], angles: [90, 90, 90] },
    crystalSystem: "tetragonal",
    spaceGroup: "P42/mnm",
    sites: rutileSites("Mn"),
  },
];

export function isMaterialsProjectId(value: string): boolean {
  return /^mp-\d+$/i.test(value.trim());
}

export function catalogEntryFor(materialId: string): CrystalCatalogEntry | undefined {
  const normalized = materialId.trim().toLowerCase();
  return CRYSTAL_CATALOG.find((entry) => entry.materialId.toLowerCase() === normalized);
}

/** Convert Materials Project JSON's structure shape into the local contract. */
export function crystalFromApiPayload(payload: unknown, materialId?: string): CrystalStructure | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = Array.isArray(root.data) ? root.data[0] : root.data && typeof root.data === "object" ? root.data : root;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const structure = (record.structure && typeof record.structure === "object" ? record.structure : record) as Record<string, unknown>;
  const lattice = (structure.lattice && typeof structure.lattice === "object" ? structure.lattice : null) as Record<string, unknown> | null;
  const matrix = lattice?.matrix;
  const directLengths = Array.isArray(lattice?.lengths) ? lattice.lengths.slice(0, 3).map(Number) : null;
  const lengths = lattice?.a && lattice?.b && lattice?.c
    ? [Number(lattice.a), Number(lattice.b), Number(lattice.c)]
    : directLengths?.length === 3 ? directLengths : matrixToLengths(matrix);
  if (!lengths || lengths.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const directAngles = Array.isArray(lattice?.angles) ? lattice.angles.slice(0, 3).map(Number) : null;
  const angles = lattice?.alpha && lattice?.beta && lattice?.gamma
    ? [Number(lattice.alpha), Number(lattice.beta), Number(lattice.gamma)]
    : directAngles?.length === 3 ? directAngles : matrixToAngles(matrix, lengths);
  const rawSites = Array.isArray(structure.sites) ? structure.sites : [];
  const sites: CrystalSite[] = [];
  for (const raw of rawSites) {
    if (!raw || typeof raw !== "object") continue;
    const site = raw as Record<string, unknown>;
    const abc = Array.isArray(site.abc) ? site.abc : Array.isArray(site.frac_coords) ? site.frac_coords : Array.isArray(site.frac) ? site.frac : null;
    const species = Array.isArray(site.species) ? site.species[0] : site.species;
    const rawElement = species && typeof species === "object"
      ? String((species as Record<string, unknown>).element ?? (species as Record<string, unknown>).label ?? "")
      : String(species ?? site.element ?? "");
    const element = normalizeElement(rawElement);
    if (!abc || abc.length < 3 || !element) continue;
    const frac: [number, number, number] = [Number(abc[0]), Number(abc[1]), Number(abc[2])];
    if (frac.every(Number.isFinite)) sites.push({
      siteId: typeof site.site_id === "string" ? site.site_id : typeof site.siteId === "string" ? site.siteId : undefined,
      element,
      frac: normalizeFractionalCoordinates(frac),
      occupancy: Number.isFinite(Number(site.occupancy)) ? Number(site.occupancy) : undefined,
      oxidationState: Number.isFinite(Number(site.oxidation_state ?? site.oxidationState)) ? Number(site.oxidation_state ?? site.oxidationState) : undefined,
      properties: site.properties && typeof site.properties === "object" ? site.properties as Record<string, unknown> : undefined,
    });
  }
  if (!sites.length) return null;
  const rawBonds = Array.isArray(record.bonds) ? record.bonds : Array.isArray(structure.bonds) ? structure.bonds : [];
  const bonds = rawBonds.map(parseBond).filter((bond): bond is CrystalBond => bond !== null);
  const latticeMatrix = normalizeMatrix(matrix);
  return {
    materialId,
    formula: typeof record.formula_pretty === "string" ? record.formula_pretty : typeof record.formula === "string" ? record.formula : undefined,
    lattice: { lengths: lengths as [number, number, number], angles: angles as [number, number, number], matrix: latticeMatrix ?? undefined },
    sites,
    crystalSystem: typeof record.symmetry === "object" && record.symmetry ? String((record.symmetry as Record<string, unknown>).crystal_system ?? "") : undefined,
    spaceGroup: typeof record.symmetry === "object" && record.symmetry ? String((record.symmetry as Record<string, unknown>).symbol ?? "") : undefined,
    bonds: bonds.length ? bonds : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
  };
}

/** Parse the subset of CIF needed for a faithful ball-and-stick preview. */
export function parseCif(text: string, materialId?: string): CrystalStructure | null {
  const scalar = (name: string) => {
    const match = text.match(new RegExp(`^\\s*_${name}\\s+([^\\s#]+)`, "im"));
    return match ? parseCifNumber(match[1]) : NaN;
  };
  const lengths: [number, number, number] = [scalar("cell_length_a"), scalar("cell_length_b"), scalar("cell_length_c")];
  if (lengths.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const angles: [number, number, number] = [scalar("cell_angle_alpha"), scalar("cell_angle_beta"), scalar("cell_angle_gamma")].map((value) => Number.isFinite(value) ? value : 90) as [number, number, number];
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  const sites: CrystalSite[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.toLowerCase() === "loop_") {
      header = null;
      const fields: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith("_")) {
        fields.push(lines[j].trim().split(/\s+/)[0].toLowerCase());
        j += 1;
      }
      if (fields.some((field) => field.includes("_atom_site_fract_x"))) {
        header = fields;
        i = j - 1;
        continue;
      }
    }
    if (!header || line.startsWith("_") || line.toLowerCase() === "loop_") continue;
    const values = line.match(/(?:[^\s']+|'[^']*')+/g)?.map((value) => value.replace(/^'|'$/g, "")) ?? [];
    if (values.length < header.length) continue;
    const ix = (names: string[]) => header!.findIndex((field) => names.some((name) => field === name));
    const elementIndex = ix(["_atom_site_type_symbol", "_atom_site_label"]);
    const xIndex = ix(["_atom_site_fract_x"]);
    const yIndex = ix(["_atom_site_fract_y"]);
    const zIndex = ix(["_atom_site_fract_z"]);
    if (xIndex < 0 || yIndex < 0 || zIndex < 0 || elementIndex < 0) continue;
    const element = normalizeElement(values[elementIndex]);
    const frac: [number, number, number] = [parseCifNumber(values[xIndex]), parseCifNumber(values[yIndex]), parseCifNumber(values[zIndex])];
    const occupancyIndex = ix(["_atom_site_occupancy"]);
    const occupancy = occupancyIndex >= 0 ? parseCifNumber(values[occupancyIndex]) : undefined;
    if (element && frac.every(Number.isFinite)) sites.push({ element, frac: normalizeFractionalCoordinates(frac), occupancy: Number.isFinite(occupancy) ? occupancy : undefined });
  }
  return sites.length ? { materialId, lattice: { lengths, angles }, sites } : null;
}

/** Parse VASP 4/5 POSCAR and CONTCAR files with Direct or Cartesian sites. */
export function parsePoscar(text: string, materialId?: string): CrystalStructure | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 8) return null;
  const scale = Number(lines[1]);
  if (!Number.isFinite(scale) || scale === 0) return null;
  const rawMatrix = lines.slice(2, 5).map((line) => line.split(/\s+/).slice(0, 3).map(Number));
  if (rawMatrix.some((row) => row.length !== 3 || row.some((value) => !Number.isFinite(value)))) return null;
  const determinant = matrixDeterminant(rawMatrix);
  const factor = scale < 0 ? Math.cbrt(Math.abs(scale / determinant)) : scale;
  const matrix = rawMatrix.map((row) => row.map((value) => value * factor)) as NonNullable<CrystalLattice["matrix"]>;
  const lengths = matrixToLengths(matrix);
  if (!lengths) return null;
  const angles = matrixToAngles(matrix, lengths);
  let cursor = 5;
  const possibleNames = lines[cursor].split(/\s+/);
  const vasp5 = possibleNames.some((value) => /[A-Za-z]/.test(value));
  const elements = vasp5 ? possibleNames.map(normalizeElement) : [];
  if (vasp5) cursor += 1;
  const counts = lines[cursor].split(/\s+/).map(Number);
  if (!counts.length || counts.some((value) => !Number.isInteger(value) || value < 0)) return null;
  cursor += 1;
  if (/^s/i.test(lines[cursor] ?? "")) cursor += 1;
  const direct = /^d/i.test(lines[cursor] ?? "");
  const cartesian = /^[ck]/i.test(lines[cursor] ?? "");
  if (!direct && !cartesian) return null;
  cursor += 1;
  const sites: CrystalSite[] = [];
  const inverse = cartesian ? invertMatrix(matrix) : null;
  for (let group = 0; group < counts.length; group += 1) {
    for (let item = 0; item < counts[group]; item += 1) {
      const values = (lines[cursor++] ?? "").split(/\s+/).slice(0, 3).map(Number);
      if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return null;
      const frac = direct ? values : multiplyRowByMatrix(values.map((value) => value * factor), inverse!);
      sites.push({ element: elements[group] || `X${group + 1}`, frac: normalizeFractionalCoordinates(frac as [number, number, number]) });
    }
  }
  return sites.length ? {
    materialId,
    formula: elements.length === counts.length ? elements.map((element, index) => `${element}${counts[index] === 1 ? "" : counts[index]}`).join("") : undefined,
    lattice: { lengths: lengths as [number, number, number], angles: angles as [number, number, number], matrix },
    sites,
    source: "poscar",
  } : null;
}

/** Parse every ionic configuration in a VASP XDATCAR trajectory. */
export function parseXdatcarFrames(text: string, materialId?: string): CrystalStructure[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const starts = lines
    .map((line, index) => (/^direct\s+configuration/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (!starts.length) return [];
  const header = lines.slice(0, starts[0]);
  const counts = header[header.length - 1]?.split(/\s+/).map(Number) ?? [];
  const atomCount = counts.reduce((total, count) => total + (Number.isInteger(count) ? count : 0), 0);
  if (!atomCount) return [];
  return starts.flatMap((start, frameIndex) => {
    const coordinates = lines.slice(start + 1, start + 1 + atomCount);
    if (coordinates.length !== atomCount) return [];
    const parsed = parsePoscar([...header, "Direct", ...coordinates].join("\n"), `${materialId ?? "XDATCAR"}#${frameIndex + 1}`);
    return parsed ? [{ ...parsed, source: "xdatcar" }] : [];
  });
}

/** Parse orthogonal or restricted-triclinic LAMMPS text dump trajectories. */
export function parseLammpsDumpFrames(text: string, materialId?: string): CrystalStructure[] {
  const lines = text.split(/\r?\n/);
  const frames: CrystalStructure[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (!lines[cursor].trim().startsWith("ITEM: TIMESTEP")) {
      cursor += 1;
      continue;
    }
    const timestep = lines[cursor + 1]?.trim() ?? String(frames.length);
    cursor += 2;
    if (!lines[cursor]?.trim().startsWith("ITEM: NUMBER OF ATOMS")) continue;
    const atomCount = Number(lines[cursor + 1]);
    cursor += 2;
    const boundsHeader = lines[cursor]?.trim() ?? "";
    if (!boundsHeader.startsWith("ITEM: BOX BOUNDS") || !Number.isInteger(atomCount) || atomCount <= 0) continue;
    const rawBounds = lines.slice(cursor + 1, cursor + 4).map((line) => line.trim().split(/\s+/).map(Number));
    if (rawBounds.length !== 3 || rawBounds.some((row) => row.length < 2 || row.some((value) => !Number.isFinite(value)))) break;
    cursor += 4;
    const atomHeader = lines[cursor]?.trim() ?? "";
    if (!atomHeader.startsWith("ITEM: ATOMS")) continue;
    const columns = atomHeader.replace(/^ITEM:\s+ATOMS\s+/, "").split(/\s+/);
    const index = (name: string) => columns.indexOf(name);
    const ix = index("x"), iy = index("y"), iz = index("z");
    const ixs = index("xs"), iys = index("ys"), izs = index("zs");
    const iid = index("id"), itype = index("type");
    const ielement = Math.max(index("element"), index("elem"));
    const scaled = ixs >= 0 && iys >= 0 && izs >= 0;
    if (!scaled && (ix < 0 || iy < 0 || iz < 0)) {
      cursor += atomCount + 1;
      continue;
    }
    const triclinic = /\bxy\b/.test(boundsHeader);
    const xy = triclinic ? (rawBounds[0][2] ?? 0) : 0;
    const xz = triclinic ? (rawBounds[1][2] ?? 0) : 0;
    const yz = triclinic ? (rawBounds[2][2] ?? 0) : 0;
    const xlo = rawBounds[0][0] - Math.min(0, xy, xz, xy + xz);
    const xhi = rawBounds[0][1] - Math.max(0, xy, xz, xy + xz);
    const ylo = rawBounds[1][0] - Math.min(0, yz);
    const yhi = rawBounds[1][1] - Math.max(0, yz);
    const zlo = rawBounds[2][0], zhi = rawBounds[2][1];
    const matrix: NonNullable<CrystalLattice["matrix"]> = [
      [xhi - xlo, 0, 0],
      [xy, yhi - ylo, 0],
      [xz, yz, zhi - zlo],
    ];
    const lengths = matrixToLengths(matrix);
    if (!lengths) break;
    const inverse = invertMatrix(matrix);
    const sites = lines.slice(cursor + 1, cursor + 1 + atomCount).flatMap((line, rowIndex) => {
      const values = line.trim().split(/\s+/);
      if (values.length < columns.length) return [];
      const frac = scaled
        ? [Number(values[ixs]), Number(values[iys]), Number(values[izs])]
        : multiplyRowByMatrix([Number(values[ix]) - xlo, Number(values[iy]) - ylo, Number(values[iz]) - zlo], inverse);
      if (frac.some((value) => !Number.isFinite(value))) return [];
      const type = itype >= 0 ? values[itype] : "1";
      const element = ielement >= 0 ? normalizeElement(values[ielement]) : `X${type}`;
      return [{
        siteId: iid >= 0 ? values[iid] : String(rowIndex + 1),
        element,
        frac: normalizeFractionalCoordinates(frac),
      } satisfies CrystalSite];
    }).sort((a, b) => Number(a.siteId) - Number(b.siteId));
    if (sites.length === atomCount) {
      frames.push({
        materialId: `${materialId ?? "LAMMPS"}#${timestep}`,
        lattice: {
          lengths: lengths as [number, number, number],
          angles: matrixToAngles(matrix, lengths) as [number, number, number],
          matrix,
        },
        sites,
        source: "lammps-dump",
      });
    }
    cursor += atomCount + 1;
  }
  return frames;
}

export function normalizeFractionalCoordinates(frac: readonly number[]): [number, number, number] {
  return frac.slice(0, 3).map((value) => {
    const normalized = ((Number(value) % 1) + 1) % 1;
    return Math.abs(normalized - 1) < 1e-10 || Math.abs(normalized) < 1e-10 ? 0 : normalized;
  }) as [number, number, number];
}

/** Convert fractional coordinates into Cartesian Angstrom coordinates. */
export function fractionalToCartesianCoordinates(
  frac: readonly number[],
  lattice: CrystalLattice,
): [number, number, number] {
  const matrix = lattice.matrix ?? latticeMatrixFromParameters(lattice);
  return multiplyRowByMatrix(frac, matrix);
}

/** Convert Cartesian Angstrom coordinates into fractional coordinates. */
export function cartesianToFractionalCoordinates(
  cartesian: readonly number[],
  lattice: CrystalLattice,
): [number, number, number] {
  const matrix = lattice.matrix ?? latticeMatrixFromParameters(lattice);
  return multiplyRowByMatrix(cartesian, invertMatrix(matrix));
}

/** Build a complete lattice record from three ASE-style row vectors. */
export function crystalLatticeFromMatrix(
  matrix: NonNullable<CrystalLattice["matrix"]>,
): CrystalLattice | null {
  if (Math.abs(matrixDeterminant(matrix)) < 1e-12) return null;
  const lengths = matrixToLengths(matrix);
  if (!lengths || lengths.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const angles = matrixToAngles(matrix, lengths);
  if (angles.some((value) => !Number.isFinite(value))) return null;
  return {
    lengths: lengths as [number, number, number],
    angles: angles as [number, number, number],
    matrix,
  };
}

/** Build exactly the central sites and periodic images referenced by the bond graph. */
export function buildPeriodicRenderModel(structure: CrystalStructure, fallbackBonds?: CrystalBond[]): PeriodicRenderModel {
  const atoms = new Map<string, PeriodicAtomInstance>();
  const bonds = new Map<string, PeriodicBondInstance>();
  const atomKey = (siteIndex: number, shift: readonly number[]) => `${siteIndex}@${shift.join(",")}`;
  const addAtom = (siteIndex: number, shift: [number, number, number]) => {
    const site = structure.sites[siteIndex];
    if (!site) return null;
    const key = atomKey(siteIndex, shift);
    if (!atoms.has(key)) atoms.set(key, {
      key,
      siteIndex,
      imageShift: shift,
      frac: [site.frac[0] + shift[0], site.frac[1] + shift[1], site.frac[2] + shift[2]],
    });
    return key;
  };
  structure.sites.forEach((_site, index) => addAtom(index, [0, 0, 0]));
  for (const edge of (structure.bonds?.length ? structure.bonds : fallbackBonds ?? [])) {
    if (!structure.sites[edge.siteIndexA] || !structure.sites[edge.siteIndexB]) continue;
    const shift = edge.imageShift.map((value) => Math.trunc(value)) as [number, number, number];
    const directions: Array<[[number, number, number], [number, number, number], number, number]> = [
      [[0, 0, 0], shift, edge.siteIndexA, edge.siteIndexB],
    ];
    if (shift.some(Boolean)) {
      // A(0) -> B(shift) is the same periodic edge as
      // B(0) -> A(-shift). Keep the source atom in the central cell so the
      // reverse edge stays local instead of spanning an entire lattice vector.
      directions.push([[0, 0, 0], shift.map((value) => -value) as [number, number, number], edge.siteIndexB, edge.siteIndexA]);
    }
    for (const [shiftA, shiftB, indexA, indexB] of directions) {
      const a = addAtom(indexA, shiftA);
      const b = addAtom(indexB, shiftB);
      if (!a || !b || a === b) continue;
      const key = [a, b].sort().join("--");
      if (!bonds.has(key)) bonds.set(key, { key, atomKeyA: a, atomKeyB: b, siteIndexA: indexA, siteIndexB: indexB, imageShiftA: shiftA, imageShiftB: shiftB });
    }
  }
  return { atoms: [...atoms.values()], bonds: [...bonds.values()] };
}

/** Tile a periodic scene into a finite supercell, keeping boundary sites once. */
export function expandPeriodicRenderModel(renderModel: PeriodicRenderModel, size: 1 | 2 | 3): { model: PeriodicRenderModel; labelKeys: Set<string> } {
  const centralAtoms = renderModel.atoms.filter((atom) => !atom.imageShift.some(Boolean));
  const centralAtomBySite = new Map(centralAtoms.map((atom) => [atom.siteIndex, atom]));
  const atoms = new Map<string, PeriodicAtomInstance>();
  const bonds = new Map<string, PeriodicBondInstance>();
  const labelKeys = new Set<string>();
  const atomKey = (siteIndex: number, shift: readonly number[]) => `${siteIndex}@${shift.join(",")}`;
  const addAtom = (siteIndex: number, shift: [number, number, number]) => {
    const central = centralAtomBySite.get(siteIndex);
    if (!central) return null;
    const frac = central.frac.map((value, index) => value + shift[index]) as [number, number, number];
    if (!frac.every((value) => value >= -1e-7 && value <= size + 1e-7)) return null;
    const key = atomKey(siteIndex, shift);
    if (!atoms.has(key)) atoms.set(key, { key, siteIndex, imageShift: shift, frac });
    return key;
  };

  for (let ix = 0; ix <= size; ix += 1) for (let iy = 0; iy <= size; iy += 1) for (let iz = 0; iz <= size; iz += 1) {
    for (const atom of centralAtoms) {
      const key = addAtom(atom.siteIndex, [ix, iy, iz]);
      if (key && ix === 0 && iy === 0 && iz === 0) labelKeys.add(key);
    }
  }

  for (const bond of renderModel.bonds) {
    for (let ix = 0; ix < size; ix += 1) for (let iy = 0; iy < size; iy += 1) for (let iz = 0; iz < size; iz += 1) {
      const base = [ix, iy, iz];
      const shiftA = base.map((value, index) => value + bond.imageShiftA[index]) as [number, number, number];
      const shiftB = base.map((value, index) => value + bond.imageShiftB[index]) as [number, number, number];
      const atomKeyA = addAtom(bond.siteIndexA, shiftA);
      const atomKeyB = addAtom(bond.siteIndexB, shiftB);
      if (!atomKeyA || !atomKeyB || atomKeyA === atomKeyB) continue;
      const key = [atomKeyA, atomKeyB].sort().join("--");
      if (!bonds.has(key)) bonds.set(key, {
        key,
        atomKeyA,
        atomKeyB,
        siteIndexA: bond.siteIndexA,
        siteIndexB: bond.siteIndexB,
        imageShiftA: shiftA,
        imageShiftB: shiftB,
      });
    }
  }
  return { model: { atoms: [...atoms.values()], bonds: [...bonds.values()] }, labelKeys };
}

/** Conservative fallback for files without a compiler-provided bond graph. */
export function inferConservativeBonds(structure: CrystalStructure): CrystalBond[] {
  const anions = new Set(["O", "S", "Se", "N", "F", "Cl", "H"]);
  const radii: Record<string, number> = { H: 0.31, O: 0.66, N: 0.71, F: 0.57, S: 1.05, Cl: 1.02, Ni: 1.24, Fe: 1.26, Co: 1.25, Mn: 1.39, Cu: 1.32, Ti: 1.36, V: 1.34, Cr: 1.28 };
  const matrix = structure.lattice.matrix ?? latticeMatrixFromParameters(structure.lattice);
  const cartesian = (frac: readonly number[]) => multiplyRowByMatrix(frac, matrix);
  const edges = new Map<string, CrystalBond>();
  for (let i = 0; i < structure.sites.length; i += 1) for (let j = i + 1; j < structure.sites.length; j += 1) {
    const a = structure.sites[i];
    const b = structure.sites[j];
    if (anions.has(a.element) === anions.has(b.element)) continue;
    const shifts = (axis: number) => structure.pbc?.[axis] === false ? [0] : [-1, 0, 1];
    for (const sx of shifts(0)) for (const sy of shifts(1)) for (const sz of shifts(2)) {
      const shift: [number, number, number] = [sx, sy, sz];
      const delta = [b.frac[0] + sx - a.frac[0], b.frac[1] + sy - a.frac[1], b.frac[2] + sz - a.frac[2]];
      const vector = cartesian(delta);
      const distance = Math.hypot(...vector);
      const threshold = ((radii[a.element] ?? 1.15) + (radii[b.element] ?? 1.15)) * 1.18;
      if (distance < 0.5 || distance > threshold) continue;
      const key = `${i}:${j}:${shift.join(",")}`;
      edges.set(key, { siteIndexA: i, siteIndexB: j, imageShift: shift, lengthAngstrom: distance, kind: "coordination" });
    }
  }
  return [...edges.values()];
}

function parseCifNumber(value: string): number {
  const normalized = value.trim().replace(/\(\d+\)$/, "");
  return normalized === "?" || normalized === "." ? NaN : Number(normalized);
}

function parseBond(value: unknown): CrystalBond | null {
  if (!value || typeof value !== "object") return null;
  const bond = value as Record<string, unknown>;
  const siteIndexA = Number(bond.site_index_a ?? bond.siteIndexA);
  const siteIndexB = Number(bond.site_index_b ?? bond.siteIndexB);
  const rawShift = bond.image_shift ?? bond.imageShift;
  if (!Number.isInteger(siteIndexA) || !Number.isInteger(siteIndexB) || !Array.isArray(rawShift) || rawShift.length !== 3) return null;
  const imageShift = rawShift.map(Number) as [number, number, number];
  if (!imageShift.every(Number.isInteger)) return null;
  const length = Number(bond.length_angstrom ?? bond.lengthAngstrom);
  return { siteIndexA, siteIndexB, imageShift, lengthAngstrom: Number.isFinite(length) ? length : undefined, kind: String(bond.kind ?? "coordination") as CrystalBond["kind"] };
}

function normalizeMatrix(value: unknown): CrystalLattice["matrix"] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const rows = value.slice(0, 3).map((row) => Array.isArray(row) ? row.slice(0, 3).map(Number) : []);
  if (rows.some((row) => row.length !== 3 || row.some((entry) => !Number.isFinite(entry)))) return null;
  return rows as CrystalLattice["matrix"];
}

export function normalizeElement(value: string): string {
  // Accept common CIF/POSCAR forms such as `fe`, `Fe3+`, and isotope labels
  // such as `13C`, while avoiding accidental matches inside site names.
  const match = value.trim().match(/^(?:\d+)?([A-Za-z]{1,2})(?=$|[^A-Za-z])/);
  if (!match) return value.trim();
  return match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
}

function matrixDeterminant(matrix: number[][]): number {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

function invertMatrix(matrix: NonNullable<CrystalLattice["matrix"]>): number[][] {
  const det = matrixDeterminant(matrix);
  if (Math.abs(det) < 1e-12) return [[NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN]];
  return [
    [(matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det, (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det, (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det],
    [(matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det, (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det, (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det],
    [(matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det, (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det, (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det],
  ];
}

function multiplyRowByMatrix(row: readonly number[], matrix: readonly (readonly number[])[]): [number, number, number] {
  return [
    row[0] * matrix[0][0] + row[1] * matrix[1][0] + row[2] * matrix[2][0],
    row[0] * matrix[0][1] + row[1] * matrix[1][1] + row[2] * matrix[2][1],
    row[0] * matrix[0][2] + row[1] * matrix[1][2] + row[2] * matrix[2][2],
  ];
}

function latticeMatrixFromParameters(lattice: CrystalLattice): NonNullable<CrystalLattice["matrix"]> {
  const [a, b, c] = lattice.lengths;
  const [alpha, beta, gamma] = lattice.angles.map((value) => value * Math.PI / 180);
  const sinGamma = Math.sin(gamma) || 1;
  const cx = c * Math.cos(beta);
  const cy = c * (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma)) / sinGamma;
  return [[a, 0, 0], [b * Math.cos(gamma), b * sinGamma, 0], [cx, cy, Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy))]];
}

function matrixToLengths(matrix: unknown): number[] | null {
  if (!Array.isArray(matrix) || matrix.length < 3) return null;
  const rows = matrix.slice(0, 3).map((row) => Array.isArray(row) ? row.slice(0, 3).map(Number) : []);
  if (rows.some((row) => row.length < 3)) return null;
  return rows.map((row) => Math.hypot(row[0], row[1], row[2]));
}

function matrixToAngles(matrix: unknown, lengths: number[]): number[] {
  if (!Array.isArray(matrix) || matrix.length < 3) return [90, 90, 90];
  const rows = matrix.slice(0, 3).map((row) => Array.isArray(row) ? row.slice(0, 3).map(Number) : []);
  if (rows.some((row) => row.length < 3)) return [90, 90, 90];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angle = (a: number[], b: number[], la: number, lb: number) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * 180 / Math.PI;
  return [angle(rows[1], rows[2], lengths[1], lengths[2]), angle(rows[0], rows[2], lengths[0], lengths[2]), angle(rows[0], rows[1], lengths[0], lengths[1])];
}
