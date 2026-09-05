// Minimal RFC-4180-ish CSV/TSV parsing for table previews. Handles quoted
// fields (embedded delimiters, quotes, newlines); caps rows so a huge file
// can't lock the UI.
//
// Resilience for the dirty CSV agents tend to emit: an unquoted field that
// contains a CSS/JSON-style value (`0 1px 3px rgba(0,0,0,0.04)`) has real
// commas inside brackets. A strict RFC parser splits those into extra columns
// and the table explodes. We track bracket depth OUTSIDE quotes and treat a
// delimiter inside `()`/`[]`/`{}` as field content — quoted fields still parse
// strictly, so well-formed CSV is unaffected. Rows are then normalized to the
// header width so the rendered table is always rectangular.

export interface ParsedTable {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

export function parseDelimited(text: string, delimiter: "," | "\t", maxRows = 500): ParsedTable {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let depth = 0; // bracket nesting depth, tracked only outside quotes
  let truncated = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty trailing lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    depth = 0; // brackets never span lines (unlike quotes)
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter && depth === 0) {
      pushField();
    } else if (c === "\n") {
      pushRow();
      if (rows.length > maxRows) {
        truncated = true;
        break;
      }
    } else if (c !== "\r") {
      if (OPENERS[c]) depth++;
      else if (CLOSERS.has(c) && depth > 0) depth--;
      field += c;
    }
  }
  if (!truncated && (field !== "" || row.length > 0)) pushRow();

  const columns = rows.shift() ?? [];
  const width = columns.length;
  const normalized = rows
    .slice(0, maxRows)
    .map((r) => normalizeWidth(r, width, delimiter));
  return { columns, rows: normalized, truncated };
}

/** Make a row exactly `width` cells: pad short rows with empty strings; fold a
 *  genuinely over-long row's surplus back into the last cell so the table stays
 *  rectangular instead of spilling extra columns. */
function normalizeWidth(row: string[], width: number, delimiter: string): string[] {
  if (width <= 0 || row.length === width) return row;
  if (row.length < width) return [...row, ...Array(width - row.length).fill("")];
  return [...row.slice(0, width - 1), row.slice(width - 1).join(delimiter)];
}

/** Parse CSV or TSV by filename extension. */
export function parseTableFile(filename: string, text: string): ParsedTable {
  const delim = filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  return parseDelimited(text, delim as "," | "\t");
}
