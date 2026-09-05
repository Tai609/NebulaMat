import { describe, expect, it } from "vitest";
import { parseEigenval } from "./bands";

// 5 header lines, control line (NELECT NKPTS NBANDS), then k-point blocks.
const NONSPIN = [
  "   2   2   2   1",
  "  0.1 0.1 0.1 0.1 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "    8   3   3",
  "",
  "  0.0 0.0 0.0  1.0",
  "   1  -5.0  1.0",
  "   2   0.5  1.0",
  "   3   4.0  0.0",
  "",
  "  0.5 0.0 0.0  1.0",
  "   1  -4.5  1.0",
  "   2   1.0  1.0",
  "   3   3.5  0.0",
  "",
  "  0.5 0.5 0.0  1.0",
  "   1  -4.0  1.0",
  "   2   1.5  1.0",
  "   3   3.0  0.0",
].join("\n");

const SPIN = [
  "   2   2   2   1",
  "  0.1 0.1 0.1 0.1 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "    8   2   2",
  "",
  "  0.0 0.0 0.0  1.0",
  "   1  -3.0  -2.8  1.0 1.0",
  "   2   2.0   2.2  0.0 0.0",
  "",
  "  0.5 0.0 0.0  1.0",
  "   1  -2.5  -2.3  1.0 1.0",
  "   2   2.5   2.7  0.0 0.0",
].join("\n");

describe("parseEigenval", () => {
  it("reads a non-spin band structure across k-points", () => {
    const d = parseEigenval(NONSPIN);
    expect(d.spin).toBe(false);
    expect(d.nkpts).toBe(3);
    expect(d.nbands).toBe(3);
    expect(d.kpoints).toHaveLength(3);
    // band 0 (lowest) energies across the 3 k-points
    expect(d.bands[0]).toEqual([-5.0, -4.5, -4.0]);
    expect(d.bands[2]).toEqual([4.0, 3.5, 3.0]);
    expect(d.eMin).toBeCloseTo(-5.0);
    expect(d.eMax).toBeCloseTo(4.0);
    expect(d.bandsDown).toBeUndefined();
  });

  it("reads spin-polarized bands (two energy columns)", () => {
    const d = parseEigenval(SPIN);
    expect(d.spin).toBe(true);
    expect(d.bands[0]).toEqual([-3.0, -2.5]);
    expect(d.bandsDown?.[0]).toEqual([-2.8, -2.3]);
    expect(d.bands[1]).toEqual([2.0, 2.5]);
  });

  it("rejects non-EIGENVAL text", () => {
    expect(() => parseEigenval("random\ntext\nhere\n")).toThrow();
  });
});
