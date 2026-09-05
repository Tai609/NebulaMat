/**
 * dsh-vaspflow host: structure parsing and 3D scene assembly — Node port of
 * backend/structure.py + backend/structure_scene.py (pymatgen replaced by a
 * self-contained POSCAR/CONTCAR parser and a minimum-distance bond algorithm).
 *
 * Data contract matches the Python original field-for-field.
 *
 * @module dsh-vaspflow/host/structure
 */
import { statSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const SYMMETRY_ATOM_LIMIT = 512;
const BOND_ATOM_LIMIT = 2048;
const SUPPORTED_BOND_ALGORITHMS = new Set(['crystal-nn', 'minimum-distance', 'cut-off-dict']);

/**
 * Van der Waals radii (Å) by atomic number — ported from crystvis-js data.js.
 * Index 0 is the default for unknown elements.
 */
const VDW_RADII = [
  1.77, // default (Z=0)
  1.2, 1.4, 1.82, 1.7, 2.08, 1.95, 1.55, 1.7, 1.73, 1.54, 2.27, 1.73, 2.05,
  2.1, 2.08, 2.0, 1.97, 1.88, 2.75, 1.973, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7,
  1.7, 1.63, 1.4, 1.39, 1.87, 1.7, 1.85, 1.9, 2.1, 2.02, 1.7, 1.7, 1.7,
  1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.63, 1.72, 1.58, 1.93, 2.17, 2.2, 2.06,
  2.15, 2.16, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7,
  1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.72, 1.66,
  1.55, 1.96, 2.02, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.86,
  1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7,
];

/** Atomic numbers of the common VASP elements (H..Ba + lanthanides). */
const ELEMENT_Z = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
  Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18,
  K: 19, Ca: 20, Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26, Co: 27,
  Ni: 28, Cu: 29, Zn: 30, Ga: 31, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36,
  Rb: 37, Sr: 38, Y: 39, Zr: 40, Nb: 41, Mo: 42, Tc: 43, Ru: 44, Rh: 45,
  Pd: 46, Ag: 47, Cd: 48, In: 49, Sn: 50, Sb: 51, Te: 52, I: 53, Xe: 54,
  Cs: 55, Ba: 56, La: 57, Ce: 58, Pr: 59, Nd: 60, Pm: 61, Sm: 62, Eu: 63,
  Gd: 64, Tb: 65, Dy: 66, Ho: 67, Er: 68, Tm: 69, Yb: 70, Lu: 71,
  Hf: 72, Ta: 73, W: 74, Re: 75, Os: 76, Ir: 77, Pt: 78, Au: 79, Hg: 80,
  Tl: 81, Pb: 82, Bi: 83, Po: 84, At: 85, Rn: 86,
};

/** Van der Waals radius of an element symbol (Å), default 1.7. */
function vdwRadiusOf(symbol) {
  const z = ELEMENT_Z[symbol] ?? 0;
  return VDW_RADII[z] ?? 1.7;
}

/** Element color (CPK) for the client scene (hex string). */
function cpkColorOf(symbol) {
  // Reuse the same palette as the client elementColors.ts by mapping to hex.
  const CPK = {
    H: '#ffffff', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5',
    C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', Ne: '#b3e3f5',
    Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000',
    S: '#ffff30', Cl: '#1ff01f', Ar: '#80d1e3', K: '#8f40d4', Ca: '#3dff00',
    Sc: '#e6e6e6', Ti: '#bfc2c7', V: '#a6a6ab', Cr: '#8a99c7', Mn: '#9c7ac7',
    Fe: '#e06633', Co: '#f090a0', Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0',
    Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929',
    Kr: '#5cb8d1', Rb: '#702eb0', Sr: '#00ff00', Y: '#94ffff', Zr: '#94e0e0',
    Nb: '#73c2c9', Mo: '#54b5b5', Tc: '#3b9e9e', Ru: '#248f8f', Rh: '#0a7d8c',
    Pd: '#006985', Ag: '#c0c0c0', Cd: '#ffd98f', In: '#a67573', Sn: '#668080',
    Sb: '#9e63b5', Te: '#d47a00', I: '#940094', Xe: '#429eb0', Cs: '#57178f',
    Ba: '#00c900', La: '#70d4ff', Hf: '#4dc2ff', Ta: '#4da6ff', W: '#2194d6',
    Re: '#267dab', Os: '#266696', Ir: '#175487', Pt: '#d0d0e0', Au: '#ffd123',
    Hg: '#b8b8d0', Pb: '#575961', Bi: '#9e4fb5',
  };
  return CPK[symbol] ?? '#888888';
}

/** Parse a POSCAR/CONTCAR file into {lattice, species, fracCoords, numAtoms}. */
export function parseStructureFile(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  // Skip comment lines at the top (some files start with a comment line).
  let idx = 0;
  while (idx < lines.length && lines[idx].trim() === '') idx += 1;
  // line 0: comment; line 1: scale; lines 2-4: lattice vectors
  let scale;
  try {
    scale = toFloat(lines[idx + 1].trim().split(/\s+/)[0]);
  } catch {
    scale = 1.0;
  }
  const lattice = [];
  for (let i = 0; i < 3; i += 1) {
    const parts = lines[idx + 2 + i].trim().split(/\s+/).slice(0, 3).map(toFloat);
    lattice.push(parts.map((v) => v * scale));
  }
  // species line + counts line
  let cursor = idx + 5;
  const speciesLine = lines[cursor].trim();
  const species = speciesLine.split(/\s+/).filter((s) => /^[A-Za-z]/.test(s));
  cursor += 1;
  // counts may span multiple lines
  const counts = [];
  while (cursor < lines.length && counts.length < species.length) {
    const parts = lines[cursor].trim().split(/\s+/);
    for (const part of parts) {
      const n = Number(part);
      if (Number.isFinite(n) && n >= 0) counts.push(n);
      if (counts.length >= species.length) break;
    }
    cursor += 1;
  }
  // Selective dynamics line?
  if (cursor < lines.length && /selective/i.test(lines[cursor])) cursor += 1;
  // coordinate mode line
  let cartesian = false;
  if (cursor < lines.length) {
    const mode = lines[cursor].trim().toLowerCase();
    if (mode.startsWith('c')) cartesian = true;
    else if (mode.startsWith('d')) cartesian = false;
  }
  cursor += 1;
  // coordinates
  const fracCoords = [];
  const total = counts.reduce((a, b) => a + b, 0);
  // Precompute the lattice inverse for Cartesian→fractional conversion.
  const inv = cartesian ? inverseMatrix(lattice) : null;
  while (cursor < lines.length && fracCoords.length < total) {
    const line = lines[cursor].trim();
    cursor += 1;
    if (line === '') continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    let x;
    let y;
    let z;
    try {
      x = toFloat(parts[0]);
      y = toFloat(parts[1]);
      z = toFloat(parts[2]);
    } catch {
      continue;
    }
    if (inv !== null) {
      const frac = matVec(inv, [x, y, z]);
      fracCoords.push(frac);
    } else {
      fracCoords.push([x, y, z]);
    }
  }
  return {
    lattice,
    species: expandSpecies(species, counts),
    fracCoords,
    numAtoms: fracCoords.length,
  };
}

/** get_structure equivalent: lattice matrix + cartesian coords. */
export function getStructure(filePath) {
  const struct = parseStructureFile(filePath);
  const coords = struct.fracCoords.map((frac) => matVec(struct.lattice, frac));
  return {
    lattice: struct.lattice,
    species: struct.species,
    coords,
    frac_coords: struct.fracCoords,
    num_atoms: struct.numAtoms,
  };
}

/**
 * get_structure_scene equivalent: cell + atoms + bonds + bond_families +
 * summary + warnings.
 */
export function getStructureScene(filePath, options = {}) {
  const { includeConnectivity = true, bondAlgorithm = 'minimum-distance' } = options;
  const warnings = [];
  let struct;
  try {
    struct = parseStructureFile(filePath);
  } catch (error) {
    return {
      version: 1,
      cell: { vectors: [], lengths: [], angles: [] },
      atoms: [],
      bonds: [],
      bond_families: [],
      summary: {
        formula: '-', atom_count: 0, space_group: null, space_group_number: null,
        crystal_system: null, bond_algorithm: includeConnectivity ? null : null,
      },
      warnings: [`Structure parse failed: ${error}`],
    };
  }
  const symmetry = structureSymmetrySummary(struct, warnings);
  const normalized = normalizeBondAlgorithm(bondAlgorithm, warnings);
  const atoms = baseAtomSpecs(struct);
  const { bonds, bondFamilies } = buildBondSpecs(struct, atoms, {
    includeConnectivity,
    bondAlgorithm: normalized,
    warnings,
  });
  return {
    version: 1,
    cell: {
      vectors: cleanMatrix(struct.lattice),
      lengths: cellLengths(struct.lattice),
      angles: cellAngles(struct.lattice),
    },
    atoms,
    bonds,
    bond_families: bondFamilies,
    summary: {
      formula: reducedFormula(struct.species),
      atom_count: struct.numAtoms,
      space_group: symmetry.space_group,
      space_group_number: symmetry.space_group_number,
      crystal_system: symmetry.crystal_system,
      bond_algorithm: includeConnectivity ? normalized : null,
    },
    warnings,
  };
}

// ---- symmetry ---------------------------------------------------------------

function structureSymmetrySummary(struct, warnings) {
  if (struct.numAtoms > SYMMETRY_ATOM_LIMIT) {
    warnings.push('Symmetry analysis skipped for large structure.');
    return emptySymmetrySummary();
  }
  // A full space-group determination needs spglib; the Node port reports
  // "unknown" instead of failing, matching the Python fallback path.
  warnings.push('Symmetry analysis unavailable in Node port (spglib not present).');
  return emptySymmetrySummary();
}

function emptySymmetrySummary() {
  return { space_group: null, space_group_number: null, crystal_system: null };
}

// ---- bonds ------------------------------------------------------------------

function normalizeBondAlgorithm(value, warnings) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (SUPPORTED_BOND_ALGORITHMS.has(normalized)) return normalized;
  warnings.push(`Unsupported bond algorithm '${value}', using minimum-distance.`);
  return 'minimum-distance';
}

/**
 * Minimum-distance neighbor algorithm (port of pymatgen MinimumDistanceNN):
 * for each atom, find its nearest neighbor distance, then connect to every
 * atom within (1 + tolerance) of that distance (default tol 0.3).
 *
 * Periodic-boundary handling: when the shortest distance between two base
 * atoms crosses the cell boundary (image ≠ 0), BOTH sides get their true
 * bonded partner rendered — an image of the other atom (is_periodic_image:
 * true) is appended to `atoms` just outside the cell, and two bonds are
 * emitted (base A ↔ image of B near A, base B ↔ image of A near B). The scene
 * renders the real bonds to the atoms outside the cell instead of drawing a
 * chord straight across the cell between the two base atoms.
 */
function buildBondSpecs(struct, atoms, { includeConnectivity, bondAlgorithm, warnings }) {
  if (!includeConnectivity) return { bonds: [], bondFamilies: [] };
  if (struct.numAtoms > BOND_ATOM_LIMIT) {
    warnings.push('Bond analysis skipped for large structure.');
    return { bonds: [], bondFamilies: [] };
  }
  try {
    const lattice = struct.lattice;
    const positions = struct.fracCoords;
    const n = positions.length;
    const bondsByPair = new Map();
    const familyLengths = new Map();
    // site_key -> atom index, covering every atom (base + appended images).
    const atomIndexByKey = new Map();
    atoms.forEach((atom, index) => {
      atomIndexByKey.set(`${atom.site_index}:0:0:0`, index);
    });
    // Deduplicate appended periodic images: site_key of the image itself.
    const imageIndexByKey = new Map();
    const ensureImage = (siteIndex, image) => {
      const key = `${siteIndex}:${image[0]}:${image[1]}:${image[2]}`;
      const existing = imageIndexByKey.get(key);
      if (existing !== undefined) return existing;
      const spec = atomSpec(struct, siteIndex, image, true);
      const newIndex = atoms.length;
      atoms.push(spec);
      imageIndexByKey.set(key, newIndex);
      return newIndex;
    };

    // Connect pairs of base atoms using the crystvis-js bond criterion: the
    // minimum periodic distance must be < (vdw[i] + vdw[j]) / 2.
    const vdw = struct.species.map((s) => vdwRadiusOf(s));
    for (let source = 0; source < n; source += 1) {
      const sourceAtomIndex = atomIndexByKey.get(`${source}:0:0:0`);
      if (sourceAtomIndex === undefined) continue;
      for (let target = source + 1; target < n; target += 1) {
        const { dist, image } = periodicDistanceWithImage(lattice, positions[source], positions[target]);
        const threshold = (vdw[source] + vdw[target]) / 2;
        if (dist >= threshold) continue;
        const targetAtomIndex = atomIndexByKey.get(`${target}:0:0:0`);
        if (targetAtomIndex === undefined) continue;
        const startElement = struct.species[source];
        const endElement = struct.species[target];
        const familyKey = bondFamilyKey(startElement, endElement);
        const isCrossing = image[0] !== 0 || image[1] !== 0 || image[2] !== 0;

        if (!isCrossing) {
          // Same-cell bond: base ↔ base.
          const pairKey = [sourceAtomIndex, targetAtomIndex].sort((a, b) => a - b).join(':');
          if (bondsByPair.has(pairKey)) continue;
          const startPosition = atoms[sourceAtomIndex].position;
          const endPosition = atoms[targetAtomIndex].position;
          const length = distance(startPosition, endPosition);
          bondsByPair.set(pairKey, {
            id: `bond:${sourceAtomIndex}-${targetAtomIndex}`,
            family_key: familyKey,
            start_atom_index: sourceAtomIndex,
            end_atom_index: targetAtomIndex,
            length: cleanFloat(length),
          });
          if (!familyLengths.has(familyKey)) familyLengths.set(familyKey, []);
          familyLengths.get(familyKey).push(length);
          continue;
        }

        // Crossing bond: BOTH sides get their true bonded partner rendered —
        // an image of the other atom just outside the cell (not a chord drawn
        // straight across the cell between the two base atoms).
        //   `image` minimizes |frac(a) - frac(b) + image|, so
        //   - b's image near a sits at frac_b - image,
        //   - a's image near b sits at frac_a + image.
        const bImage = [-image[0], -image[1], -image[2]]; // frac_b - image
        const aImage = image;                              // frac_a + image
        // Bond A: base A ↔ image of B near A.
        const endB = ensureImage(target, bImage);
        const keyA = `${sourceAtomIndex}:${endB}`;
        if (!bondsByPair.has(keyA)) {
          const startPosition = atoms[sourceAtomIndex].position;
          const endPosition = atoms[endB].position;
          const length = distance(startPosition, endPosition);
          bondsByPair.set(keyA, {
            id: `bond:${sourceAtomIndex}-${endB}`,
            family_key: familyKey,
            start_atom_index: sourceAtomIndex,
            end_atom_index: endB,
            length: cleanFloat(length),
          });
          if (!familyLengths.has(familyKey)) familyLengths.set(familyKey, []);
          familyLengths.get(familyKey).push(length);
        }
        // Bond B: base B ↔ image of A near B.
        const endA = ensureImage(source, aImage);
        const keyB = `${targetAtomIndex}:${endA}`;
        if (!bondsByPair.has(keyB)) {
          const startPosition = atoms[targetAtomIndex].position;
          const endPosition = atoms[endA].position;
          const length = distance(startPosition, endPosition);
          bondsByPair.set(keyB, {
            id: `bond:${targetAtomIndex}-${endA}`,
            family_key: familyKey,
            start_atom_index: targetAtomIndex,
            end_atom_index: endA,
            length: cleanFloat(length),
          });
          if (!familyLengths.has(familyKey)) familyLengths.set(familyKey, []);
          familyLengths.get(familyKey).push(length);
        }
      }
    }
    const bonds = [...bondsByPair.values()];
    const bondFamilies = [...familyLengths.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, lengths]) => ({
        key,
        elements: key.split('|'),
        min_length: cleanFloat(Math.min(...lengths)),
        max_length: cleanFloat(Math.max(...lengths)),
      }));
    return { bonds, bondFamilies };
  } catch (error) {
    warnings.push(`Bond analysis failed: ${error}`);
    return { bonds: [], bondFamilies: [] };
  }
}

function baseAtomSpecs(struct) {
  return struct.fracCoords.map((_, index) => atomSpec(struct, index, [0, 0, 0], false));
}

function atomSpec(struct, siteIndex, image, isPeriodicImage) {
  const element = struct.species[siteIndex];
  const cart = matVec(struct.lattice, struct.fracCoords[siteIndex]);
  const position = [
    cart[0] + image[0] * struct.lattice[0][0] + image[1] * struct.lattice[1][0] + image[2] * struct.lattice[2][0],
    cart[1] + image[0] * struct.lattice[0][1] + image[1] * struct.lattice[1][1] + image[2] * struct.lattice[2][1],
    cart[2] + image[0] * struct.lattice[0][2] + image[1] * struct.lattice[1][2] + image[2] * struct.lattice[2][2],
  ];
  const fractionalPosition = [
    struct.fracCoords[siteIndex][0] + image[0],
    struct.fracCoords[siteIndex][1] + image[1],
    struct.fracCoords[siteIndex][2] + image[2],
  ];
  return {
    id: atomId(element, siteIndex, image),
    site_index: siteIndex,
    element,
    position: cleanVector(position),
    fractional_position: cleanVector(fractionalPosition),
    image_offset: image.map((v) => Math.round(v) + 0),
    is_periodic_image: isPeriodicImage,
  };
}

function atomId(element, siteIndex, image) {
  if (image[0] === 0 && image[1] === 0 && image[2] === 0) return `${element}-${siteIndex}`;
  return `${element}-${siteIndex}-image-${image[0]}-${image[1]}-${image[2]}`;
}

// ---- lattice / vector math ---------------------------------------------------

function periodicDistanceWithImage(lattice, a, b) {
  let best = Infinity;
  let bestImage = [0, 0, 0];
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      for (let k = -1; k <= 1; k += 1) {
        const delta = cartesianDelta(lattice, a, b, i, j, k);
        const len = Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2);
        if (len < best) {
          best = len;
          bestImage = [i, j, k];
        }
      }
    }
  }
  return { dist: best, image: bestImage };
}

/** Exact cartesian delta of frac(a) - frac(b) + image under lattice matrix. */
function cartesianDelta(lattice, a, b, i, j, k) {
  const df = [a[0] - b[0] + i, a[1] - b[1] + j, a[2] - b[2] + k];
  return [
    df[0] * lattice[0][0] + df[1] * lattice[1][0] + df[2] * lattice[2][0],
    df[0] * lattice[0][1] + df[1] * lattice[1][1] + df[2] * lattice[2][1],
    df[0] * lattice[0][2] + df[1] * lattice[1][2] + df[2] * lattice[2][2],
  ];
}

function matVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** 3x3 matrix inverse (row-major), or null when singular. */
function inverseMatrix(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-20) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function vectorLength(v) {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

function vectorAngle(left, right) {
  const lLen = vectorLength(left);
  const rLen = vectorLength(right);
  if (lLen === 0 || rLen === 0) return 0.0;
  let cosine = (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (lLen * rLen);
  cosine = Math.max(-1.0, Math.min(1.0, cosine));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function cellLengths(lattice) {
  return lattice.map(vectorLength);
}

function cellAngles(lattice) {
  return [
    vectorAngle(lattice[1], lattice[2]),
    vectorAngle(lattice[0], lattice[2]),
    vectorAngle(lattice[0], lattice[1]),
  ];
}

function distance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function bondFamilyKey(left, right) {
  const [first, second] = [left, right].sort();
  return `${first}|${second}`;
}

// ---- helpers ------------------------------------------------------------------

function toFloat(s) {
  return Number(s.replace(/D/g, 'E').replace(/d/g, 'e'));
}

function expandSpecies(species, counts) {
  const out = [];
  species.forEach((symbol, i) => {
    const n = counts[i] ?? 0;
    for (let j = 0; j < n; j += 1) out.push(symbol);
  });
  return out;
}

function reducedFormula(species) {
  const counts = new Map();
  for (const symbol of species) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  const entries = [...counts.entries()];
  if (entries.length === 0) return '-';
  let gcd = entries[0][1];
  for (const [, n] of entries) gcd = gcdOf(gcd, n);
  return entries.map(([symbol, n]) => (n / gcd === 1 ? symbol : `${symbol}${n / gcd}`)).join('');
}

function gcdOf(a, b) {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function cleanMatrix(matrix) {
  return matrix.map((row) => cleanVector(row));
}

function cleanVector(values) {
  return values.map(cleanFloat);
}

function cleanFloat(value) {
  const number = Number(value);
  if (Math.abs(number) < 1e-12) return 0.0;
  return number;
}

export function structureFileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
