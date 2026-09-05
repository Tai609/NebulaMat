import { describe, expect, it } from "vitest";
import { analyzeColumns, canChart, defaultChartSpec } from "./tableChart";
import type { ParsedTable } from "./csv";

const T: ParsedTable = {
  columns: ["month", "sales", "returns"],
  rows: [
    ["Jan", "100", "5"],
    ["Feb", "120", "8"],
    ["Mar", "90", "3"],
  ],
  truncated: false,
};

describe("analyzeColumns", () => {
  it("flags numeric vs categorical columns", () => {
    const cols = analyzeColumns(T);
    expect(cols[0].numeric).toBe(false); // month
    expect(cols[1].numeric).toBe(true); // sales
    expect(cols[2].numeric).toBe(true); // returns
    expect(cols[1].values).toEqual([100, 120, 90]);
  });

  it("parses percents and thousands separators, tolerates a few NA", () => {
    const t: ParsedTable = {
      columns: ["x"],
      rows: [["1,200"], ["3%"], ["NA"], ["4"]],
      truncated: false,
    };
    const c = analyzeColumns(t)[0];
    expect(c.numeric).toBe(true);
    expect(c.values).toEqual([1200, 3, null, 4]);
  });
});

describe("defaultChartSpec", () => {
  it("uses the categorical column as X, numeric columns as Y, bar for categorical X", () => {
    const spec = defaultChartSpec(analyzeColumns(T))!;
    expect(spec.xIndex).toBe(0); // month
    expect(spec.yIndexes).toEqual([1, 2]); // sales, returns
    expect(spec.type).toBe("bar");
  });

  it("uses a line when X is numeric", () => {
    const t: ParsedTable = {
      columns: ["t", "y"],
      rows: [["0", "1"], ["1", "4"], ["2", "9"]],
      truncated: false,
    };
    const spec = defaultChartSpec(analyzeColumns(t))!;
    expect(spec.type).toBe("line");
    expect(spec.xIndex).toBe(0);
    expect(spec.yIndexes).toEqual([1]);
  });

  it("returns null when there is nothing numeric to plot", () => {
    const t: ParsedTable = { columns: ["a", "b"], rows: [["x", "y"]], truncated: false };
    expect(defaultChartSpec(analyzeColumns(t))).toBeNull();
    expect(canChart(t)).toBe(false);
  });

  it("caps at 8 Y series", () => {
    const cols = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const t: ParsedTable = {
      columns: ["label", ...cols],
      rows: [["a", ...cols.map(() => "1")]],
      truncated: false,
    };
    const spec = defaultChartSpec(analyzeColumns(t))!;
    expect(spec.yIndexes.length).toBe(8);
  });
});
