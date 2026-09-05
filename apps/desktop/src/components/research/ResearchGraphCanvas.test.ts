import { describe, expect, it } from "vitest";
import { addResearchEdge, addResearchNode, createResearchGraph, type ResearchHypothesisNode } from "@ai4s/shared";
import { researchGraphOption } from "./ResearchGraphCanvas";

const palette = {
  text: "#111",
  muted: "#777",
  border: "#ddd",
  surface: "#fff",
  accent: "#c30",
  series: ["#06c", "#090", "#eda100"],
};

describe("researchGraphOption", () => {
  it("renders claim and hypothesis categories and fades non-matching branches", () => {
    let graph = createResearchGraph({
      researchId: "research-canvas",
      title: "Graph canvas",
      objective: "Inspect research relationships",
      now: 1_700_000_000_000,
    });
    const hypothesis: ResearchHypothesisNode = {
      id: "hypothesis:alt",
      kind: "hypothesis",
      label: "Alternative mechanism",
      branchId: "branch:main",
      createdAt: 1_700_000_000_001,
      statement: "A second mechanism explains the result",
      status: "open",
    };
    graph = addResearchNode(graph, hypothesis, { at: 1_700_000_000_001 });
    graph = addResearchEdge(graph, {
      source: hypothesis.id,
      target: graph.rootClaimId,
      kind: "alternative-to",
      at: 1_700_000_000_002,
    });
    const option = researchGraphOption(graph, graph.rootClaimId, "alternative", palette);
    const series = (option.series as Array<{
      categories: Array<{ name: string }>;
      data: Array<{ id: string; itemStyle: { opacity: number; borderWidth: number } }>;
      links: Array<{ lineStyle: { opacity: number } }>;
    }>)[0];

    expect(series.categories.map((category) => category.name)).toEqual(["claim", "hypothesis"]);
    expect(series.data.find((item) => item.id === hypothesis.id)?.itemStyle.opacity).toBe(1);
    expect(series.data.find((item) => item.id === graph.rootClaimId)?.itemStyle.opacity).toBe(0.12);
    expect(series.links[0].lineStyle.opacity).toBe(0.05);
  });
});
