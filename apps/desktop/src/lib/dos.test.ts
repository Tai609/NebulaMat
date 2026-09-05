import { describe, expect, it } from "vitest";
import { parseDoscar } from "./dos";

// 5 header lines, a control line (Emax Emin NEDOS Efermi weight), then TDOS rows.
const NONSPIN = [
  "   1   1   1   0",
  "  1.0 1.0 1.0 1.0 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "  5.0 -5.0   5   0.5   1.0",
  " -5.0  0.00  0.00",
  " -2.5  0.50  0.30",
  "  0.0  1.20  1.10",
  "  2.5  0.40  2.00",
  "  5.0  0.00  2.50",
  "",
].join("\n");

const SPIN = [
  "   2   2   1   0",
  "  1.0 1.0 1.0 1.0 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "  4.0 -4.0   4   1.0   1.0",
  " -4.0 0.0 0.0 0.0 0.0",
  " -1.0 0.8 0.7 0.5 0.4",
  "  1.0 1.5 1.4 1.2 1.1",
  "  4.0 0.0 0.0 2.0 1.9",
].join("\n");

describe("parseDoscar", () => {
  it("reads a non-spin DOSCAR: energies, DOS, Fermi", () => {
    const d = parseDoscar(NONSPIN);
    expect(d.spin).toBe(false);
    expect(d.nedos).toBe(5);
    expect(d.efermi).toBeCloseTo(0.5, 6);
    expect(d.energies).toEqual([-5, -2.5, 0, 2.5, 5]);
    expect(d.up).toEqual([0, 0.5, 1.2, 0.4, 0]);
    expect(d.down).toBeUndefined();
  });

  it("reads a spin-polarized DOSCAR: up and down channels", () => {
    const d = parseDoscar(SPIN);
    expect(d.spin).toBe(true);
    expect(d.nedos).toBe(4);
    expect(d.efermi).toBeCloseTo(1.0, 6);
    expect(d.up).toEqual([0, 0.8, 1.5, 0]);
    expect(d.down).toEqual([0, 0.7, 1.4, 0]);
  });

  it("rejects non-DOSCAR text", () => {
    expect(() => parseDoscar("just some\nrandom text\n")).toThrow();
  });
});
