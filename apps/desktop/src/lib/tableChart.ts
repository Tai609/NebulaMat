// Pure helpers for the native table chart (P1-5): decide which columns are
// numeric and pick a sensible default chart from a parsed table. Kept separate
// from the React view so the logic is unit-testable.
import type { ParsedTable } from "./csv";

export interface ColumnInfo {
  name: string;
  index: number;
  numeric: boolean;
  /** Parsed values aligned to table.rows; null where a cell isn't a finite number. */
  values: (number | null)[];
}

const NA = new Set(["", "na", "nan", "null", "none", "-"]);

function parseNum(cell: string): number | null {
  const t = cell.trim();
  if (NA.has(t.toLowerCase())) return null;
  // strip a trailing % and thousands separators for a friendlier numeric read
  const cleaned = t.replace(/,/g, "").replace(/%$/, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function analyzeColumns(table: ParsedTable): ColumnInfo[] {
  return table.columns.map((name, index) => {
    const values = table.rows.map((r) => (index < r.length ? parseNum(r[index]) : null));
    const present = values.filter((_, i) => (table.rows[i][index] ?? "").trim() !== "");
    const finite = present.filter((v) => v !== null).length;
    // Numeric if most present cells parse as numbers (tolerates a few stray labels).
    const numeric = present.length > 0 && finite / present.length >= 0.6;
    return { name, index, numeric, values };
  });
}

export type ChartType = "line" | "bar" | "scatter";

export interface ChartSpec {
  xIndex: number;
  yIndexes: number[];
  type: ChartType;
}

/** A sensible default: the first non-numeric column (or the first column) as X,
 *  the numeric columns as Y series (capped at 8), and a type that fits X. */
export function defaultChartSpec(cols: ColumnInfo[]): ChartSpec | null {
  const numeric = cols.filter((c) => c.numeric);
  if (numeric.length === 0) return null;
  const firstCategorical = cols.find((c) => !c.numeric);
  const xIndex = firstCategorical ? firstCategorical.index : numeric[0].index;
  const yIndexes = numeric.filter((c) => c.index !== xIndex).map((c) => c.index).slice(0, 8);
  if (yIndexes.length === 0) {
    // Only one numeric column and it's the X → plot it alone against row order.
    return { xIndex: -1, yIndexes: [numeric[0].index], type: "line" };
  }
  const xNumeric = cols[xIndex]?.numeric ?? false;
  return { xIndex, yIndexes, type: xNumeric ? "line" : "bar" };
}

/** Whether a table can be charted at all (has at least one numeric column). */
export function canChart(table: ParsedTable): boolean {
  return analyzeColumns(table).some((c) => c.numeric);
}
