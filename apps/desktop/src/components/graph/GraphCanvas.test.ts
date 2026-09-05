import { describe, expect, it } from "vitest";
import type { GraphDocument, GraphNode } from "@/lib/tauri";
import { graphOption } from "./GraphCanvas";

const node = (id: string, label: string, communityName: string): GraphNode => ({
  id,
  label,
  communityName,
  community: communityName.slice(-1),
  nodeType: "code",
  sourceFile: `${id}.ts`,
  sourceLocation: "L1",
  role: null,
  degree: id === "a" ? 5 : 1,
});

describe("graphOption", () => {
  it("uses communities as categories and fades nodes outside the search", () => {
    const graph = {
      nodes: [node("a", "Parser", "Community 0"), node("b", "Renderer", "Community 1")],
      edges: [
        {
          source: "a",
          target: "b",
          relation: "calls",
          confidence: "EXTRACTED",
          confidenceScore: 1,
          sourceFile: "a.ts",
        },
      ],
    } as GraphDocument;
    const option = graphOption(graph, "a", "parser", {
      text: "#111",
      muted: "#777",
      border: "#ddd",
      surface: "#fff",
      accent: "#c30",
      series: ["#06c", "#090"],
    });
    const series = (option.series as Array<{
      categories: Array<{ name: string }>;
      data: Array<{ id: string; itemStyle: { opacity: number; borderWidth: number } }>;
      links: Array<{ lineStyle: { opacity: number } }>;
    }>)[0];

    expect(series.categories.map((category) => category.name)).toEqual(["Community 0", "Community 1"]);
    expect(series.data.find((item) => item.id === "a")?.itemStyle).toMatchObject({ opacity: 1, borderWidth: 3 });
    expect(series.data.find((item) => item.id === "b")?.itemStyle.opacity).toBe(0.12);
    expect(series.links[0].lineStyle.opacity).toBe(0.05);
  });
});
