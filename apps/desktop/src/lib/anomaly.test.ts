import { describe, expect, it } from "vitest";
import { divergingColor, parseAnomaly } from "./anomaly";

describe("parseAnomaly — long CSV", () => {
  const CSV = [
    "lat,lon,anomaly",
    "-45,0,-1.5",
    "-45,90,0.5",
    "45,0,2.0",
    "45,90,-0.5",
  ].join("\n");

  it("builds an ascending lat/lon grid with values", () => {
    const g = parseAnomaly(CSV);
    expect(g.lats).toEqual([-45, 45]);
    expect(g.lons).toEqual([0, 90]);
    expect(g.values[0]).toEqual([-1.5, 0.5]); // lat -45 row
    expect(g.values[1]).toEqual([2.0, -0.5]); // lat 45 row
  });

  it("computes a symmetric range for the diverging map", () => {
    const g = parseAnomaly(CSV);
    expect(g.min).toBeCloseTo(-1.5);
    expect(g.max).toBeCloseTo(2.0);
    expect(g.absMax).toBeCloseTo(2.0);
    expect(g.unit).toBe("anomaly");
  });
});

describe("parseAnomaly — labeled grid", () => {
  const GRID = [
    "lat/lon,0,90,180",
    "-30,-1,0,1",
    "30,2,-2,0.5",
  ].join("\n");

  it("reads longitudes from the header row and lats from the first column", () => {
    const g = parseAnomaly(GRID);
    expect(g.lons).toEqual([0, 90, 180]);
    expect(g.lats).toEqual([-30, 30]);
    expect(g.values[0]).toEqual([-1, 0, 1]);
    expect(g.values[1]).toEqual([2, -2, 0.5]);
  });
});

describe("parseAnomaly — errors", () => {
  it("rejects text that is neither long CSV nor a labeled grid", () => {
    expect(() => parseAnomaly("hello\nworld")).toThrow();
  });
});

describe("divergingColor", () => {
  it("is white at zero, blue for negative, red for positive", () => {
    expect(divergingColor(0)).toEqual([247, 247, 247]);
    const neg = divergingColor(-1);
    const pos = divergingColor(1);
    expect(neg[2]).toBeGreaterThan(neg[0]); // blue dominant
    expect(pos[0]).toBeGreaterThan(pos[2]); // red dominant
  });
});
