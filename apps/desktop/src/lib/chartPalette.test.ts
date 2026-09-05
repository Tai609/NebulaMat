import { describe, expect, it } from "vitest";
import { seriesColor, CHART_PALETTE_LIGHT, CHART_PALETTE_DARK } from "@ai4s/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The palette is the single source of truth shared with index.css --series-*
// and runtime/.../openscience.mplstyle. Lock the hexes so those three stay in sync.
describe("chart palette (single source of truth)", () => {
  it("assigns categorical hues in fixed order and wraps only past 8", () => {
    expect(CHART_PALETTE_LIGHT.categorical).toEqual([
      "#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
    ]);
    expect(seriesColor(0, "light")).toBe("#2a78d6");
    expect(seriesColor(0, "dark")).toBe("#3987e5");
    expect(seriesColor(8, "light")).toBe(seriesColor(0, "light")); // never a generated 9th hue
    expect(CHART_PALETTE_DARK.categorical).toHaveLength(8);
  });
});

describe("publication skill guardrails", () => {
  const root = resolve(process.cwd(), "../..");
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");

  it("rejects generic diagram output and requires final-size figure and table QA", () => {
    const core = read("runtime/skills/core/publication-figures/SKILL.md");

    expect(core).toContain("Do not use Mermaid, PlantUML");
    expect(core).toContain("No collisions");
    expect(core).toContain("paper-writing, literature-survey, and experiment skills");
    expect(core).toContain("Resolve an over-wide table in this order");
    expect(core).toMatch(/at\s+least 8 pt at final size/);
    expect(core).toContain("pdftoppm");
    expect(core).toMatch(/no\s+overlap, clipping, or margin overflow/);
  });
});
