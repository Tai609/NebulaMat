import {
  cartesianToFractionalCoordinates,
  crystalLatticeFromMatrix,
  normalizeElement,
  normalizeFractionalCoordinates,
  type CrystalLattice,
  type CrystalSite,
  type CrystalStructure,
} from "./crystal";

export interface MolecularDynamicsFrame {
  structure: CrystalStructure;
  /** Zero-based position in the source trajectory before UI sampling. */
  sourceIndex: number;
  step?: number;
  timeFs?: number;
  phase?: string;
  seed?: number;
}

export interface MolecularDynamicsTrajectory {
  frames: MolecularDynamicsFrame[];
  totalFrames: number;
  sampled: boolean;
}

export interface UmaThermoRow {
  phase: string;
  step: number;
  timeFs: number;
  temperatureK: number;
  potentialEnergyEv: number;
  kineticEnergyEv: number;
  totalEnergyEv: number;
  maxForceEvPerAngstrom: number;
  minimumDistanceAngstrom?: number;
}

interface ExtxyzProperty {
  name: string;
  count: number;
  offset: number;
}

const DEFAULT_MAX_UI_FRAMES = 600;

/** Parse an ASE extended-XYZ trajectory without depending on Python in the UI. */
export function parseExtxyzTrajectory(
  text: string,
  materialId = "trajectory.extxyz",
  maxFrames = DEFAULT_MAX_UI_FRAMES,
): MolecularDynamicsTrajectory {
  const lines = text.split(/\r?\n/);
  const parsed: MolecularDynamicsFrame[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    if (cursor >= lines.length) break;
    const atomCount = Number(lines[cursor].trim());
    if (!Number.isInteger(atomCount) || atomCount <= 0 || cursor + atomCount + 1 >= lines.length) break;
    const header = parseExtxyzHeader(lines[cursor + 1] ?? "");
    const lattice = parseLattice(header.Lattice);
    if (!lattice) {
      cursor += atomCount + 2;
      continue;
    }
    const properties = parsePropertyLayout(header.Properties);
    const species = findProperty(properties, ["species", "symbol", "symbols"]);
    const position = findProperty(properties, ["pos", "position", "positions"]);
    if (!species || !position || position.count < 3) {
      cursor += atomCount + 2;
      continue;
    }
    const moveMask = findProperty(properties, ["move_mask", "movemask"]);
    const role = findProperty(properties, ["atom_role", "role"]);
    const pbc = parsePbc(header.pbc);
    const sites: CrystalSite[] = [];
    for (let index = 0; index < atomCount; index += 1) {
      const values = (lines[cursor + 2 + index] ?? "").trim().split(/\s+/);
      const cartesian = values.slice(position.offset, position.offset + 3).map(Number);
      if (values.length < properties.reduce((total, item) => total + item.count, 0)
        || cartesian.length !== 3 || cartesian.some((value) => !Number.isFinite(value))) {
        sites.length = 0;
        break;
      }
      const rawFractional = cartesianToFractionalCoordinates(cartesian, lattice);
      if (rawFractional.some((value) => !Number.isFinite(value))) {
        sites.length = 0;
        break;
      }
      const normalized = normalizeFractionalCoordinates(rawFractional);
      const frac = rawFractional.map((value, axis) => pbc[axis] ? normalized[axis] : value) as [number, number, number];
      const movable = moveMask ? parseExtxyzBoolean(values[moveMask.offset]) : undefined;
      const atomRole = role ? values[role.offset] : undefined;
      const propertiesRecord: Record<string, unknown> = {};
      if (movable !== undefined) propertiesRecord.fixed = !movable;
      if (atomRole) propertiesRecord.role = atomRole;
      sites.push({
        siteId: String(index + 1),
        element: normalizeElement(values[species.offset] ?? "X"),
        frac,
        properties: Object.keys(propertiesRecord).length ? propertiesRecord : undefined,
      });
    }
    if (sites.length === atomCount) {
      const sourceIndex = parsed.length;
      parsed.push({
        sourceIndex,
        step: finiteInteger(header.md_step ?? header.step),
        timeFs: finiteNumber(header.time_fs),
        phase: header.md_phase ?? header.phase,
        seed: finiteInteger(header.md_seed ?? header.seed),
        structure: {
          materialId: `${materialId}#${sourceIndex + 1}`,
          lattice,
          sites,
          pbc,
          source: "extxyz-trajectory",
        },
      });
    }
    cursor += atomCount + 2;
  }

  const frames = sampleTrajectoryFrames(parsed, maxFrames);
  return { frames, totalFrames: parsed.length, sampled: frames.length < parsed.length };
}

/** Parse the deterministic CSV schema emitted by the ASE + UMA runner. */
export function parseUmaThermoCsv(text: string): UmaThermoRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const column = (name: string) => header.indexOf(name);
  const indexes = {
    phase: column("phase"),
    step: column("step"),
    time: column("time_fs"),
    temperature: column("temperature_k"),
    potential: column("potential_energy_ev"),
    kinetic: column("kinetic_energy_ev"),
    total: column("total_energy_ev"),
    force: column("max_force_ev_per_angstrom"),
    distance: column("minimum_distance_angstrom"),
  };
  if (Object.values(indexes).slice(0, 8).some((index) => index < 0)) return [];
  return lines.slice(1).flatMap((line) => {
    const values = parseCsvLine(line);
    const numeric = {
      step: Number(values[indexes.step]),
      timeFs: Number(values[indexes.time]),
      temperatureK: Number(values[indexes.temperature]),
      potentialEnergyEv: Number(values[indexes.potential]),
      kineticEnergyEv: Number(values[indexes.kinetic]),
      totalEnergyEv: Number(values[indexes.total]),
      maxForceEvPerAngstrom: Number(values[indexes.force]),
    };
    if (Object.values(numeric).some((value) => !Number.isFinite(value))) return [];
    const distance = Number(values[indexes.distance]);
    return [{
      phase: values[indexes.phase] ?? "",
      ...numeric,
      minimumDistanceAngstrom: Number.isFinite(distance) ? distance : undefined,
    } satisfies UmaThermoRow];
  });
}

export function thermoRowForFrame(
  frame: MolecularDynamicsFrame | undefined,
  displayedIndex: number,
  displayedFrameCount: number,
  rows: readonly UmaThermoRow[],
): UmaThermoRow | undefined {
  if (!rows.length) return undefined;
  if (frame?.step !== undefined) {
    const exact = rows.find((row) => row.step === frame.step);
    if (exact) return exact;
    return rows.reduce((closest, row) =>
      Math.abs(row.step - frame.step!) < Math.abs(closest.step - frame.step!) ? row : closest,
    );
  }
  const denominator = Math.max(1, displayedFrameCount - 1);
  return rows[Math.round(displayedIndex / denominator * (rows.length - 1))];
}

export function nearestFrameIndexForStep(frames: readonly MolecularDynamicsFrame[], step: number): number {
  if (!frames.length) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  frames.forEach((frame, index) => {
    const candidate = frame.step ?? frame.sourceIndex;
    const distance = Math.abs(candidate - step);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function parseExtxyzHeader(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  for (const match of line.matchAll(pattern)) result[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  return result;
}

function parseLattice(value?: string): CrystalLattice | null {
  const entries = value?.trim().split(/\s+/).map(Number) ?? [];
  if (entries.length !== 9 || entries.some((entry) => !Number.isFinite(entry))) return null;
  return crystalLatticeFromMatrix([
    entries.slice(0, 3) as [number, number, number],
    entries.slice(3, 6) as [number, number, number],
    entries.slice(6, 9) as [number, number, number],
  ]);
}

function parsePropertyLayout(value?: string): ExtxyzProperty[] {
  const tokens = value?.split(":") ?? [];
  const properties: ExtxyzProperty[] = [];
  let offset = 0;
  for (let index = 0; index + 2 < tokens.length; index += 3) {
    const count = Number(tokens[index + 2]);
    if (!Number.isInteger(count) || count <= 0) return [];
    properties.push({ name: tokens[index].toLowerCase(), count, offset });
    offset += count;
  }
  return properties;
}

function findProperty(properties: readonly ExtxyzProperty[], names: readonly string[]): ExtxyzProperty | undefined {
  return properties.find((property) => names.includes(property.name));
}

function parsePbc(value?: string): [boolean, boolean, boolean] {
  const flags = value?.trim().split(/\s+/).map(parseExtxyzBoolean) ?? [];
  return [flags[0] ?? true, flags[1] ?? true, flags[2] ?? true];
}

function parseExtxyzBoolean(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (/^(?:t|true|1)$/i.test(value)) return true;
  if (/^(?:f|false|0)$/i.test(value)) return false;
  return undefined;
}

function sampleTrajectoryFrames(frames: MolecularDynamicsFrame[], maximum: number): MolecularDynamicsFrame[] {
  const limit = Math.max(2, Math.floor(maximum));
  if (frames.length <= limit) return frames;
  const selected = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    selected.add(Math.round(index * (frames.length - 1) / (limit - 1)));
  }
  return [...selected].sort((a, b) => a - b).map((index) => frames[index]);
}

function finiteNumber(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteInteger(value?: string): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else current += char;
  }
  values.push(current);
  return values;
}
