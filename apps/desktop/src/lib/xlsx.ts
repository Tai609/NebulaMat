// Render a workbook to per-sheet HTML tables for the previewer, preserving the
// visual formatting Excel/WPS shows: cell fills, font size/color/weight/italic,
// alignment, borders, and column widths. We use ExcelJS (not SheetJS) because
// the open-source SheetJS build's sheet_to_html emits values only — no styles —
// which is why fills and font sizes were previously lost. Pure (no DOM) so it
// can be unit-tested; caps keep a huge sheet from locking the UI.
import ExcelJS from "exceljs";

export interface SheetHtml {
  name: string;
  /** A `<table>` fragment; all cell text is HTML-escaped. */
  html: string;
  truncated: boolean;
}

const MAX_ROWS = 500;
const MAX_COLS = 50;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

/** ExcelJS colors are 8-hex ARGB. Take the RGB and treat it as opaque — these
 *  files routinely store a `00` alpha byte that still means a visible color in
 *  Excel/WPS, so honoring alpha would wrongly hide fills. Theme/indexed colors
 *  (no `argb`) are skipped rather than guessed. */
function argbToCss(color: unknown): string | undefined {
  const argb = (color as { argb?: string } | undefined)?.argb;
  if (typeof argb !== "string" || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

const V_ALIGN: Record<string, string> = { top: "top", middle: "middle", bottom: "bottom" };

/** Inline CSS for one cell from its ExcelJS style. */
function cellStyle(cell: ExcelJS.Cell): string {
  const s: string[] = [];
  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: unknown } | undefined;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = argbToCss(fill.fgColor);
    if (bg) s.push(`background:${bg}`);
  }
  const font = cell.font ?? {};
  const color = argbToCss(font.color);
  if (color) s.push(`color:${color}`);
  if (font.size) s.push(`font-size:${(font.size * 4) / 3}px`); // pt → px
  if (font.name) s.push(`font-family:'${font.name.replace(/'/g, "")}',sans-serif`);
  if (font.bold) s.push("font-weight:600");
  if (font.italic) s.push("font-style:italic");
  if (font.underline) s.push("text-decoration:underline");

  const align = cell.alignment ?? {};
  // Default alignment mirrors Excel: numbers right, everything else left.
  const horiz = align.horizontal ?? (cell.type === ExcelJS.ValueType.Number ? "right" : "left");
  if (horiz === "center" || horiz === "right") s.push(`text-align:${horiz}`);
  if (align.vertical && V_ALIGN[align.vertical]) s.push(`vertical-align:${V_ALIGN[align.vertical]}`);
  if (align.wrapText) s.push("white-space:normal");

  for (const side of ["top", "right", "bottom", "left"] as const) {
    const b = (cell.border as Record<string, { style?: string; color?: unknown }> | undefined)?.[side];
    if (b?.style) {
      const w = b.style.includes("thick") || b.style === "medium" ? 2 : 1;
      s.push(`border-${side}:${w}px solid ${argbToCss(b.color) ?? "#c9c2b6"}`);
    }
  }
  return s.join(";");
}

export async function workbookSheets(bytes: ArrayBuffer): Promise<SheetHtml[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  return wb.worksheets.map((ws) => {
    const dim = ws.dimensions as { top?: number; left?: number; bottom?: number; right?: number } | undefined;
    const top = dim?.top || 1;
    const left = dim?.left || 1;
    const bottom = dim?.bottom || 1;
    const right = dim?.right || 1;
    const lastRow = Math.min(bottom, top + MAX_ROWS - 1);
    const lastCol = Math.min(right, left + MAX_COLS - 1);
    const truncated = bottom > lastRow || right > lastCol;

    // Merges: the top-left cell spans; every other covered cell is skipped.
    const spans = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    for (const range of ws.model.merges ?? []) {
      const [a, b] = range.split(":");
      const s = cellRef(a);
      const e = cellRef(b);
      if (!s || !e) continue;
      spans.set(`${s.r},${s.c}`, { rs: e.r - s.r + 1, cs: e.c - s.c + 1 });
      for (let r = s.r; r <= e.r; r++)
        for (let c = s.c; c <= e.c; c++) if (r !== s.r || c !== s.c) covered.add(`${r},${c}`);
    }

    // Column widths (Excel char units → px), so the layout matches the sheet.
    let cols = "";
    for (let c = left; c <= lastCol; c++) {
      const w = ws.getColumn(c).width;
      cols += `<col style="width:${w ? Math.round(w * 7 + 5) : 64}px">`;
    }

    let body = "";
    for (let r = top; r <= lastRow; r++) {
      body += "<tr>";
      for (let c = left; c <= lastCol; c++) {
        if (covered.has(`${r},${c}`)) continue;
        const cell = ws.getCell(r, c);
        const span = spans.get(`${r},${c}`);
        const attrs = span ? ` rowspan="${span.rs}" colspan="${span.cs}"` : "";
        const style = cellStyle(cell);
        body += `<td${attrs}${style ? ` style="${style}"` : ""}>${escapeHtml(cell.text ?? "")}</td>`;
      }
      body += "</tr>";
    }

    return {
      name: ws.name,
      html: `<table><colgroup>${cols}</colgroup><tbody>${body}</tbody></table>`,
      truncated,
    };
  });
}

/** Decode an A1-style cell ref (e.g. "AB12") to 1-based {r, c}. */
function cellRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10), c };
}
