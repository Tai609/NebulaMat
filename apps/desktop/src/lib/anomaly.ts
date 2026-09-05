// Parser for gridded climate-anomaly data (P1-3, earth/climate). A `.anom` file
// is text in one of two portable shapes, both offline:
//   • long CSV  — a header naming lat / lon / value(anomaly) columns, one row
//                 per grid cell;
//   • label grid — first row = longitudes, first column = latitudes, cells the
//                 values (an empty/`lat\lon` top-left corner).
// Output is a rectangular grid (rows = latitude ascending, cols = longitude
// ascending) the map viewer renders on an equirectangular (plate carrée)
// projection with a diverging colormap centered at zero.

export interface AnomalyGrid {
  lats: number[]; // ascending
  lons: number[]; // ascending
  /** values[latIndex][lonIndex]; NaN where a cell is missing. */
  values: number[][];
  min: number;
  max: number;
  /** max(|min|, |max|) — the symmetric range for a zero-centered diverging map. */
  absMax: number;
  unit?: string;
}

function splitRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.split(/[,\t;]/).map((c) => c.trim()));
}

const LAT_RE = /^lat|latitude$/i;
const LON_RE = /^lon|lng|long|longitude$/i;
const VAL_RE = /anom|value|temp|deviation|delta/i;

function finalize(
  latSet: Set<number>,
  lonSet: Set<number>,
  cells: Map<string, number>,
  unit?: string,
): AnomalyGrid {
  const lats = [...latSet].sort((a, b) => a - b);
  const lons = [...lonSet].sort((a, b) => a - b);
  const values = lats.map((la) => lons.map((lo) => cells.get(`${la},${lo}`) ?? NaN));
  let min = Infinity;
  let max = -Infinity;
  for (const v of cells.values()) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  return { lats, lons, values, min, max, absMax: Math.max(Math.abs(min), Math.abs(max)) || 1, unit };
}

export function parseAnomaly(text: string): AnomalyGrid {
  const rows = splitRows(text);
  if (rows.length < 2) throw new Error("no grid data");
  const header = rows[0];
  const latCol = header.findIndex((h) => LAT_RE.test(h));
  const lonCol = header.findIndex((h) => LON_RE.test(h));

  // Long CSV: explicit lat/lon columns.
  if (latCol >= 0 && lonCol >= 0) {
    let valCol = header.findIndex((h, i) => i !== latCol && i !== lonCol && VAL_RE.test(h));
    if (valCol < 0) valCol = header.findIndex((_, i) => i !== latCol && i !== lonCol);
    if (valCol < 0) throw new Error("no value column in the anomaly CSV");
    const latSet = new Set<number>();
    const lonSet = new Set<number>();
    const cells = new Map<string, number>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const la = Number(r[latCol]);
      const lo = Number(r[lonCol]);
      const v = Number(r[valCol]);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      latSet.add(la);
      lonSet.add(lo);
      if (Number.isFinite(v)) cells.set(`${la},${lo}`, v);
    }
    if (cells.size === 0) throw new Error("anomaly CSV has no finite values");
    return finalize(latSet, lonSet, cells, header[valCol]);
  }

  // Labeled grid: first row = longitudes (after a corner cell), first col = lats.
  const lons = rows[0].slice(1).map(Number);
  if (lons.some((x) => !Number.isFinite(x)) || lons.length === 0) {
    throw new Error("unrecognized anomaly format (need lat/lon columns or a labeled grid)");
  }
  const latSet = new Set<number>();
  const lonSet = new Set<number>(lons);
  const cells = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const la = Number(r[0]);
    if (!Number.isFinite(la)) continue;
    latSet.add(la);
    for (let j = 0; j < lons.length; j++) {
      const v = Number(r[j + 1]);
      if (Number.isFinite(v)) cells.set(`${la},${lons[j]}`, v);
    }
  }
  if (cells.size === 0) throw new Error("labeled grid has no finite values");
  return finalize(latSet, lonSet, cells);
}

/** Diverging blue↔white↔red for a zero-centered value t ∈ [-1, 1]. */
export function divergingColor(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  // control stops: blue (-1) → white (0) → red (+1), perceptually balanced
  const blue: [number, number, number] = [33, 102, 172];
  const white: [number, number, number] = [247, 247, 247];
  const red: [number, number, number] = [178, 24, 43];
  const lerp = (a: [number, number, number], b: [number, number, number], f: number): [number, number, number] =>
    [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  return x < 0 ? lerp(white, blue, -x) : lerp(white, red, x);
}
