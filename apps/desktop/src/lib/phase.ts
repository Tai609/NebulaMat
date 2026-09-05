// Parser + convex-hull stability for a binary phase diagram (P1-3, materials).
// A `.phase` file is JSON: two elements and a list of entries, each with an
// atomic composition and a formation energy per atom. We compute the lower
// convex hull — the entries on it are thermodynamically stable; entries above
// it are metastable, with an energy above hull. Pure, offline.

export interface PhaseEntryIn {
  formula: string;
  composition: Record<string, number>;
  formation_energy_per_atom: number;
}

export interface PhaseEntry {
  formula: string;
  /** Fraction of the second element, n_B / (n_A + n_B) ∈ [0, 1]. */
  x: number;
  /** Formation energy per atom (eV). */
  y: number;
  stable: boolean;
  eAboveHull: number;
}

export interface PhaseDiagram {
  elements: [string, string];
  entries: PhaseEntry[];
  /** Lower-hull vertices (stable phases), sorted by x. */
  hull: { x: number; y: number; formula: string }[];
}

function cross(
  o: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Lower convex hull via Andrew's monotone chain over points sorted by (x, y). */
function lowerHull(points: { x: number; y: number; formula: string }[]) {
  const pts = [...points].sort((p, q) => (p.x !== q.x ? p.x - q.x : p.y - q.y));
  const hull: typeof pts = [];
  for (const p of pts) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
      hull.pop();
    }
    hull.push(p);
  }
  return hull;
}

/** Interpolated hull energy at composition x (assumes x within the hull span). */
function hullEnergyAt(hull: { x: number; y: number }[], x: number): number {
  if (hull.length === 0) return 0;
  if (x <= hull[0].x) return hull[0].y;
  if (x >= hull[hull.length - 1].x) return hull[hull.length - 1].y;
  for (let i = 0; i < hull.length - 1; i++) {
    const a = hull[i];
    const b = hull[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      return a.y + (b.y - a.y) * t;
    }
  }
  return 0;
}

export function parsePhaseDiagram(text: string): PhaseDiagram {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const obj = raw as { elements?: string[]; entries?: PhaseEntryIn[] };
  const elements = obj.elements ?? [];
  const entriesIn = obj.entries ?? [];
  if (elements.length !== 2) {
    throw new Error("binary phase diagram needs exactly 2 elements");
  }
  if (entriesIn.length === 0) throw new Error("no entries");
  const [A, B] = elements;

  const pts = entriesIn.map((e) => {
    const a = e.composition[A] ?? 0;
    const b = e.composition[B] ?? 0;
    const total = a + b;
    return {
      formula: e.formula,
      x: total > 0 ? b / total : 0,
      y: e.formation_energy_per_atom,
    };
  });

  const hull = lowerHull(pts);
  const tol = 1e-6;

  // Stability is defined by the energy above the hull, not by hull-vertex
  // membership: a phase exactly on a tie-line (collinear, so dropped as a
  // redundant vertex by the monotone chain) is still marginally stable.
  const entries: PhaseEntry[] = pts.map((p) => {
    const eAbove = p.y - hullEnergyAt(hull, p.x);
    return {
      formula: p.formula,
      x: p.x,
      y: p.y,
      stable: eAbove <= tol,
      eAboveHull: Math.max(0, eAbove),
    };
  });

  return {
    elements: [A, B],
    entries,
    hull: hull.map((h) => ({ x: h.x, y: h.y, formula: h.formula })),
  };
}
