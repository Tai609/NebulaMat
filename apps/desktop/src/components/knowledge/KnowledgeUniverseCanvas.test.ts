import { describe, expect, it } from "vitest";
import type { KnowledgeUniverse, KnowledgeUniverseNode } from "@/lib/tauri";
import { universeOption } from "./KnowledgeUniverseCanvas";
import { universeThemeColor, universeType } from "./knowledgeUniverseTypes";

function node(id: string, nodeType = "concept", cluster = "testing"): KnowledgeUniverseNode {
  return {
    id,
    label: id.toUpperCase(),
    nodeType,
    cluster,
    sourceId: "output_1",
    degree: id === "b" ? 2 : 1,
    properties: "",
    relatedImages: [],
  };
}

const graph: KnowledgeUniverse = {
  nodes: [node("a", "chemical"), node("b"), node("c")],
  edges: [
    { source: "a", target: "b", relation: "knows", weight: 1, sourceId: "output_1" },
    { source: "b", target: "c", relation: "uses", weight: 1, sourceId: "output_1" },
  ],
  totalNodes: 3,
  totalEdges: 2,
  visibleNodes: 3,
  visibleEdges: 2,
  truncated: false,
};

function seriesData(depth: 1 | 2, typeFilter = "all") {
  const option = universeOption(graph, "a", "", typeFilter, 800, 500, depth);
  return (option.series as Array<{
    data: Array<{ id: string; itemStyle: { opacity: number } }>;
    links: Array<{ source: string; target: string; lineStyle: { opacity: number } }>;
  }>)[0];
}

describe("universeOption", () => {
  it("uses a draggable force layout with node repulsion", () => {
    const option = universeOption(graph, null, "", "all", 800, 500);
    const series = (option.series as Array<{
      layout: string;
      draggable: boolean;
      force: { repulsion: number; edgeLength: number[]; layoutAnimation: boolean };
    }>)[0];

    expect(series.layout).toBe("force");
    expect(series.draggable).toBe(true);
    expect(series.force.repulsion).toBeGreaterThan(0);
    expect(series.force.edgeLength).toEqual([72, 150]);
    expect(series.force.layoutAnimation).toBe(true);
  });

  it("expands selected paths from one hop to two hops", () => {
    expect(seriesData(1).data.find((item) => item.id === "c")?.itemStyle.opacity).toBe(0.1);
    expect(seriesData(2).data.find((item) => item.id === "c")?.itemStyle.opacity).toBe(1);
    expect(seriesData(2).links[1].lineStyle.opacity).toBe(0.38);
  });

  it("filters nodes and edges without inventing topology", () => {
    const chemicalOnly = seriesData(1, "chemical");
    expect(chemicalOnly.data.map((item) => item.id)).toEqual(["a"]);
    expect(chemicalOnly.links).toEqual([]);
  });

  it("uses experimental-domain categories with section fallback", () => {
    expect(universeType("chemical_entity", "characterization")).toBe("chemical");
    expect(universeType("process", "testing")).toBe("synthesis");
    expect(universeType("spectrum", "testing")).toBe("characterization");
    expect(universeType("experimental_condition", "synthesis")).toBe("testing");
    expect(universeType("concept", "characterization")).toBe("characterization");
    expect(universeType("unknown", "unknown")).toBe("other");
  });

  it("maps DOM category controls to the shared theme series tokens", () => {
    expect(universeThemeColor("chemical")).toBe("var(--series-1)");
    expect(universeThemeColor("concept", "testing")).toBe("var(--series-4)");
    expect(universeThemeColor("unknown", "unknown")).toBe("var(--series-7)");
  });

  it("uses the current semantic palette for chart chrome and categories", () => {
    const palette = {
      text: "rgb(11, 12, 13)",
      muted: "rgb(21, 22, 23)",
      border: "rgb(31, 32, 33)",
      surface: "rgb(41, 42, 43)",
      accent: "rgb(51, 52, 53)",
      series: ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7"],
    };
    const option = universeOption(graph, null, "", "all", 800, 500, 1, 0, palette);
    const tooltip = option.tooltip as { backgroundColor: string; borderColor: string; textStyle: { color: string } };
    const series = (option.series as Array<{
      data: Array<{ itemStyle: { color: string }; label: { color: string } }>;
    }>)[0];

    expect(tooltip.backgroundColor).toBe(palette.surface);
    expect(tooltip.borderColor).toBe(palette.border);
    expect(tooltip.textStyle.color).toBe(palette.text);
    expect(series.data[0]?.itemStyle.color).toBe(palette.series[0]);
    expect(series.data[0]?.label.color).toBe(palette.text);
  });
});
