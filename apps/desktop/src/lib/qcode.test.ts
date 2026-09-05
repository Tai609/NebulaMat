import { describe, expect, it } from "vitest";
import { parseQCode, segmentsFor } from "./qcode";

const DOC = JSON.stringify({
  sources: [{ id: "i1", title: "Interview 1", text: "I trust the doctor but fear the cost." }],
  codes: [{ name: "trust" }, { name: "fear" }],
  annotations: [
    { source: "i1", code: "trust", start: 2, end: 18 }, // "trust the doctor"
    { source: "i1", code: "fear", start: 23, end: 36 }, // "fear the cost"
  ],
});

describe("parseQCode", () => {
  it("parses sources, codes, annotations and counts", () => {
    const d = parseQCode(DOC);
    expect(d.sources).toHaveLength(1);
    expect(d.codes.map((c) => c.name)).toEqual(["trust", "fear"]);
    expect(d.countByCode).toEqual({ trust: 1, fear: 1 });
    expect(d.warnings).toEqual([]);
  });

  it("slices the exact quote from the source (never invents text)", () => {
    const d = parseQCode(DOC);
    expect(d.quoteOf(d.annotations[0])).toBe("trust the doctor");
    expect(d.quoteOf(d.annotations[1])).toBe("fear the cost");
  });

  it("warns on an out-of-range span and an unknown code, but does not throw", () => {
    const doc = parseQCode(
      JSON.stringify({
        sources: [{ id: "s", text: "short" }],
        codes: [{ name: "a" }],
        annotations: [
          { source: "s", code: "a", start: 0, end: 999 }, // out of range
          { source: "s", code: "ghost", start: 0, end: 3 }, // unknown code
        ],
      }),
    );
    expect(doc.warnings.some((w) => w.includes("out-of-range"))).toBe(true);
    expect(doc.warnings.some((w) => w.includes("not in the codebook"))).toBe(true);
  });

  it("throws when there are no sources or the JSON is invalid", () => {
    expect(() => parseQCode("{}")).toThrow(/no sources/);
    expect(() => parseQCode("{ not json")).toThrow(/not valid JSON/);
  });
});

describe("segmentsFor", () => {
  it("splits text at annotation boundaries and tags each run with its codes", () => {
    const d = parseQCode(DOC);
    const segs = segmentsFor(d, "i1");
    // reconstruct the original text from the segments (no loss)
    expect(segs.map((s) => s.text).join("")).toBe("I trust the doctor but fear the cost.");
    const coded = segs.filter((s) => s.codes.length > 0);
    expect(coded.map((s) => s.text)).toEqual(["trust the doctor", "fear the cost"]);
  });

  it("keeps every code on an overlapping region", () => {
    const d = parseQCode(
      JSON.stringify({
        sources: [{ id: "s", text: "abcdefgh" }],
        codes: [{ name: "x" }, { name: "y" }],
        annotations: [
          { source: "s", code: "x", start: 0, end: 5 },
          { source: "s", code: "y", start: 3, end: 8 },
        ],
      }),
    );
    const segs = segmentsFor(d, "s");
    const overlap = segs.find((s) => s.text === "de");
    expect(overlap?.codes.sort()).toEqual(["x", "y"]);
  });
});
