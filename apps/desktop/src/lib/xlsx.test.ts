import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { workbookSheets } from "./xlsx";

async function toBytes(build: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe("workbookSheets", () => {
  it("renders every sheet to an HTML table, keeping merged cells as spans", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("Data");
      ws.getCell("A1").value = "Report title";
      ws.mergeCells("A1:B1");
      ws.getCell("A2").value = "name";
      ws.getCell("B2").value = "value";
      ws.getCell("A3").value = "moon";
      ws.getCell("B3").value = 42;
      wb.addWorksheet("Notes").getCell("A1").value = "only one cell";
    });
    const sheets = await workbookSheets(bytes);

    expect(sheets.map((s) => s.name)).toEqual(["Data", "Notes"]);
    expect(sheets[0].html).toContain("<table");
    expect(sheets[0].html).toContain("Report title");
    expect(sheets[0].html).toMatch(/colspan="2"/);
    expect(sheets[0].truncated).toBe(false);
    expect(sheets[1].html).toContain("only one cell");
  });

  it("preserves cell fill, font color/size, and bold as inline styles", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("S");
      const cell = ws.getCell("A1");
      cell.value = "Header";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC45038" } };
      cell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    });
    const html = (await workbookSheets(bytes))[0].html;
    expect(html).toContain("background:#C45038");
    expect(html).toContain("color:#FFFFFF");
    expect(html).toMatch(/font-size:18(\.\d+)?px/); // 14pt → px
    expect(html).toContain("font-weight:600");
  });

  it("escapes HTML in cell values", async () => {
    const bytes = await toBytes((wb) => {
      wb.addWorksheet("S").getCell("A1").value = "<img src=x>";
    });
    expect((await workbookSheets(bytes))[0].html).not.toContain("<img");
  });
});
