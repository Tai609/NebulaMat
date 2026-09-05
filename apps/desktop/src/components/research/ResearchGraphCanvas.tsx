import { useEffect, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import type { ResearchGraph, ResearchNode } from "@ai4s/shared";

interface ResearchGraphCanvasProps {
  graph: ResearchGraph;
  selectedId: string | null;
  query: string;
  onSelect: (node: ResearchNode) => void;
}

interface ResearchPalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  series: string[];
}

const KIND_COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#4a3aa7", "#e34948", "#e87ba4"];

function cssPalette(): ResearchPalette {
  const css = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    text: value("--text", "#2a2723"),
    muted: value("--muted", "#8c877d"),
    border: value("--border", "#e7e3da"),
    surface: value("--surface", "#ffffff"),
    accent: value("--accent", "#c15f3c"),
    series: Array.from({ length: 8 }, (_, index) => value(`--series-${index + 1}`, KIND_COLORS[index % KIND_COLORS.length])),
  };
}

export function researchGraphOption(
  graph: ResearchGraph,
  selectedId: string | null,
  query: string,
  palette: ResearchPalette,
): EChartsOption {
  const normalized = query.trim().toLocaleLowerCase();
  const kinds = [...new Set(graph.nodes.map((node) => node.kind))];
  const kindIndex = new Map(kinds.map((kind, index) => [kind, index]));
  const matchingIds = new Set(
    normalized
      ? graph.nodes
        .filter((node) => [node.label, node.id, node.kind, node.branchId]
          .some((value) => value.toLocaleLowerCase().includes(normalized)))
        .map((node) => node.id)
      : graph.nodes.map((node) => node.id),
  );
  return {
    animationDuration: graph.nodes.length > 300 ? 0 : 220,
    animationDurationUpdate: 160,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const data = (params as { data?: { name?: string; relation?: string } }).data;
        return data?.relation ?? data?.name ?? "";
      },
    },
    series: [{
      type: "graph",
      layout: "force",
      roam: true,
      draggable: true,
      cursor: "pointer",
      categories: kinds.map((kind, index) => ({
        name: kind,
        itemStyle: { color: palette.series[index % palette.series.length] },
      })),
      data: graph.nodes.map((node) => {
        const isMatch = matchingIds.has(node.id);
        const isSelected = node.id === selectedId;
        const size = node.kind === "claim" ? 27 : node.kind === "hypothesis" ? 23 : 17;
        return {
          id: node.id,
          name: node.label,
          category: kindIndex.get(node.kind) ?? 0,
          symbolSize: size + (isSelected ? 5 : 0),
          itemStyle: {
            opacity: isMatch ? 1 : 0.12,
            borderColor: isSelected ? palette.accent : palette.surface,
            borderWidth: isSelected ? 3 : 1,
          },
          label: {
            show: isSelected || (isMatch && (node.kind === "claim" || node.kind === "hypothesis")),
            color: palette.text,
            fontSize: 11,
            width: 180,
            overflow: "truncate",
            position: "right",
          },
          emphasis: { focus: "adjacency", label: { show: true, color: palette.text, fontWeight: 600 } },
        };
      }),
      links: graph.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relation: edge.kind,
        lineStyle: {
          color: palette.border,
          type: edge.kind === "refutes" || edge.kind === "invalidates" ? "dashed" : "solid",
          opacity: normalized && (!matchingIds.has(edge.source) || !matchingIds.has(edge.target)) ? 0.05 : 0.6,
          curveness: 0.08,
        },
      })),
      edgeSymbol: graph.edges.length < 900 ? ["none", "arrow"] : ["none", "none"],
      edgeSymbolSize: 5,
      force: {
        initLayout: "circular",
        repulsion: Math.max(90, Math.min(260, 14_000 / Math.max(30, graph.nodes.length))),
        gravity: 0.08,
        edgeLength: [52, 136],
        friction: 0.58,
        layoutAnimation: graph.nodes.length < 350,
      },
      lineStyle: { width: 1 },
    }],
  };
}

export function ResearchGraphCanvas({ graph, selectedId, query, onSelect }: ResearchGraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const [palette, setPalette] = useState(cssPalette);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    void import("echarts").then((echarts) => {
      if (cancelled || !hostRef.current) return;
      const chart = echarts.init(hostRef.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.on("click", (params) => {
        if (params.dataType !== "node") return;
        const id = (params.data as { id?: string })?.id;
        const node = graph.nodes.find((candidate) => candidate.id === id);
        if (node) onSelect(node);
      });
      resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(hostRef.current);
      themeObserver = new MutationObserver(() => setPalette(cssPalette()));
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      setPalette(cssPalette());
    });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [graph, onSelect]);

  useEffect(() => {
    chartRef.current?.setOption(researchGraphOption(graph, selectedId, query, palette), { notMerge: true });
  }, [graph, selectedId, query, palette]);

  return <div ref={hostRef} data-testid="research-graph-canvas" className="h-full min-h-[320px] w-full" />;
}
