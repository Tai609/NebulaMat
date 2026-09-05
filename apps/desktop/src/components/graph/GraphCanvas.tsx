import { useEffect, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import type { GraphDocument, GraphNode } from "@/lib/tauri";

interface GraphCanvasProps {
  graph: GraphDocument;
  selectedId: string | null;
  query: string;
  onSelect: (node: GraphNode) => void;
}

interface GraphPalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  series: string[];
}

function cssPalette(): GraphPalette {
  const css = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    text: value("--text", "#2a2723"),
    muted: value("--muted", "#8c877d"),
    border: value("--border", "#e7e3da"),
    surface: value("--surface", "#ffffff"),
    accent: value("--accent", "#c15f3c"),
    series: Array.from({ length: 8 }, (_, index) =>
      value(`--series-${index + 1}`, ["#2a78d6", "#1baf7a", "#eda100", "#008300"][index % 4]),
    ),
  };
}

export function graphOption(
  graph: GraphDocument,
  selectedId: string | null,
  query: string,
  palette: GraphPalette,
): EChartsOption {
  const normalized = query.trim().toLocaleLowerCase();
  const categories = [...new Set(graph.nodes.map((node) => node.communityName ?? node.nodeType ?? "concept"))];
  const categoryIndex = new Map(categories.map((name, index) => [name, index]));
  const labelFloor = [...graph.nodes]
    .sort((a, b) => b.degree - a.degree)[Math.min(24, Math.max(0, graph.nodes.length - 1))]?.degree ?? 0;
  const selected = new Set(
    normalized
      ? graph.nodes
          .filter((node) =>
            [node.label, node.sourceFile, node.communityName]
              .filter(Boolean)
              .some((value) => value!.toLocaleLowerCase().includes(normalized)),
          )
          .map((node) => node.id)
      : graph.nodes.map((node) => node.id),
  );
  return {
    animationDuration: graph.nodes.length > 300 ? 0 : 240,
    animationDurationUpdate: 180,
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
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        cursor: "pointer",
        categories: categories.map((name, index) => ({
          name,
          itemStyle: { color: palette.series[index % palette.series.length] },
        })),
        data: graph.nodes.map((node) => {
          const matches = selected.has(node.id);
          const isSelected = node.id === selectedId;
          return {
            id: node.id,
            name: node.label,
            value: node.degree,
            category: categoryIndex.get(node.communityName ?? node.nodeType ?? "concept") ?? 0,
            symbolSize: Math.min(34, 9 + Math.sqrt(Math.max(1, node.degree)) * 3) + (isSelected ? 5 : 0),
            itemStyle: {
              opacity: matches ? 1 : 0.12,
              borderColor: isSelected ? palette.accent : palette.surface,
              borderWidth: isSelected ? 3 : 1,
            },
            label: {
              show: isSelected || (matches && node.degree >= labelFloor && graph.nodes.length < 500),
              color: palette.text,
              fontSize: 11,
              width: 160,
              overflow: "truncate",
              position: "right",
            },
            emphasis: {
              focus: "adjacency",
              label: { show: true, color: palette.text, fontWeight: 600 },
            },
          };
        }),
        links: graph.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          lineStyle: {
            color: edge.confidence === "AMBIGUOUS" ? palette.muted : palette.border,
            type: edge.confidence === "AMBIGUOUS" ? "dashed" : "solid",
            opacity: normalized && (!selected.has(edge.source) || !selected.has(edge.target)) ? 0.05 : 0.55,
            curveness: 0.08,
          },
        })),
        edgeSymbol: graph.edges.length < 900 ? ["none", "arrow"] : ["none", "none"],
        edgeSymbolSize: 5,
        force: {
          initLayout: "circular",
          repulsion: Math.max(70, Math.min(240, 13_000 / Math.max(30, graph.nodes.length))),
          gravity: 0.08,
          edgeLength: [42, 118],
          friction: 0.58,
          layoutAnimation: graph.nodes.length < 350,
        },
        lineStyle: { width: 1 },
      },
    ],
  };
}

export function GraphCanvas({ graph, selectedId, query, onSelect }: GraphCanvasProps) {
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
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(graphOption(graph, selectedId, query, palette), { notMerge: true });
  }, [graph, selectedId, query, palette]);

  return <div ref={hostRef} data-testid="graph-canvas" className="h-full min-h-[320px] w-full" />;
}
