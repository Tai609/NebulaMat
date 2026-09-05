import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import type { KnowledgeUniverse, KnowledgeUniverseNode } from "@/lib/tauri";
import {
  UNIVERSE_CATEGORIES,
  universeColor,
  universeNodeType,
} from "./knowledgeUniverseTypes";
import styles from "./KnowledgeUniverseCanvas.module.css";

export { UNIVERSE_CATEGORIES, universeColor, universeType } from "./knowledgeUniverseTypes";

interface UniversePalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  series: string[];
}

const DEFAULT_UNIVERSE_PALETTE: UniversePalette = {
  text: "#e7f3ff",
  muted: "#7d9ab7",
  border: "rgba(159, 190, 222, .38)",
  surface: "rgba(4, 11, 22, .94)",
  accent: "#68d9ff",
  series: UNIVERSE_CATEGORIES.map((category) => universeColor(category)),
};

function cssPalette(): UniversePalette {
  const css = getComputedStyle(document.documentElement);
  const probe = document.createElement("span");
  probe.style.position = "fixed";
  probe.style.pointerEvents = "none";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const value = (name: string, fallback: string) => {
    if (!css.getPropertyValue(name).trim()) return fallback;
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color.trim() || fallback;
  };
  try {
    return {
      text: value("--text", DEFAULT_UNIVERSE_PALETTE.text),
      muted: value("--muted", DEFAULT_UNIVERSE_PALETTE.muted),
      border: value("--border", DEFAULT_UNIVERSE_PALETTE.border),
      surface: value("--surface", DEFAULT_UNIVERSE_PALETTE.surface),
      accent: value("--accent", DEFAULT_UNIVERSE_PALETTE.accent),
      series: Array.from({ length: UNIVERSE_CATEGORIES.length }, (_, index) =>
        value(`--series-${index + 1}`, DEFAULT_UNIVERSE_PALETTE.series[index]),
      ),
    };
  } finally {
    probe.remove();
  }
}

function categoryColor(category: (typeof UNIVERSE_CATEGORIES)[number], palette: UniversePalette): string {
  return palette.series[UNIVERSE_CATEGORIES.indexOf(category)] ?? universeColor(category);
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0) / 4294967295;
}

function universePositions(nodes: KnowledgeUniverseNode[], width: number, height: number, rotation = 0): Map<string, [number, number]> {
  const positions = new Map<string, [number, number]>();
  const clusterGroups = new Map<string, KnowledgeUniverseNode[]>();
  for (const node of nodes) {
    const members = clusterGroups.get(node.cluster) ?? [];
    members.push(node);
    clusterGroups.set(node.cluster, members);
  }
  const clusters = [...clusterGroups.keys()].sort();
  const centerX = width / 2;
  const centerY = height / 2;
  const clusterRadius = Math.min(width, height) * .29;
  clusters.forEach((cluster, clusterIndex) => {
    const members = (clusterGroups.get(cluster) ?? []).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
    const angle = (Math.PI * 2 * clusterIndex) / Math.max(1, clusters.length) - Math.PI / 2 + rotation;
    const clusterX = centerX + Math.cos(angle) * clusterRadius;
    const clusterY = centerY + Math.sin(angle) * clusterRadius * .72;
    members.forEach((node, index) => {
      const ring = Math.floor(index / 18) + 1;
      const ringSize = Math.max(1, Math.min(18, members.length));
      const phase = hash(node.id) * Math.PI * 2;
      const localAngle = phase + (Math.PI * 2 * (index % ringSize)) / ringSize + rotation * .35;
      const localRadius = Math.min(150, 24 + ring * 31);
      const core = index === 0 && node.degree > (members[1]?.degree ?? 0) * 1.35;
      positions.set(node.id, core
        ? [centerX + Math.cos(angle) * clusterRadius * .34, centerY + Math.sin(angle) * clusterRadius * .25]
        : [clusterX + Math.cos(localAngle) * localRadius, clusterY + Math.sin(localAngle) * localRadius * .66]);
    });
  });
  return positions;
}

export interface KnowledgeUniverseCanvasProps {
  graph: KnowledgeUniverse;
  selectedId: string | null;
  query: string;
  typeFilter: string;
  pathDepth?: 1 | 2;
  onSelect: (node: KnowledgeUniverseNode) => void;
}

export function universeOption(
  graph: KnowledgeUniverse,
  selectedId: string | null,
  query: string,
  typeFilter: string,
  width: number,
  height: number,
  pathDepth: 1 | 2 = 1,
  rotation = 0,
  palette: UniversePalette = DEFAULT_UNIVERSE_PALETTE,
): EChartsOption {
  const needle = query.trim().toLocaleLowerCase();
  const visibleNodes = graph.nodes.filter((node) => typeFilter === "all" || universeNodeType(node) === typeFilter);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visibleEdges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const neighbors = new Map<string, Set<string>>();
  for (const edge of visibleEdges) {
    const sourceNeighbors = neighbors.get(edge.source) ?? new Set<string>();
    sourceNeighbors.add(edge.target);
    neighbors.set(edge.source, sourceNeighbors);
    const targetNeighbors = neighbors.get(edge.target) ?? new Set<string>();
    targetNeighbors.add(edge.source);
    neighbors.set(edge.target, targetNeighbors);
  }
  const matches = new Set(visibleNodes.filter((node) => !needle || [node.label, node.nodeType, node.cluster, node.sourceId].some((value) => value.toLocaleLowerCase().includes(needle))).map((node) => node.id));
  const activeSelectedId = selectedId && visibleIds.has(selectedId) ? selectedId : null;
  const adjacency = new Set<string>(activeSelectedId ? [activeSelectedId] : []);
  let frontier = new Set(activeSelectedId ? [activeSelectedId] : []);
  for (let depth = 0; depth < pathDepth && frontier.size; depth += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!adjacency.has(neighbor)) next.add(neighbor);
      }
    }
    next.forEach((id) => adjacency.add(id));
    frontier = next;
  }
  const positions = universePositions(visibleNodes, width, height, rotation);
  const idsForOpacity = needle ? matches : activeSelectedId ? adjacency : visibleIds;
  const hasFocus = Boolean(needle || activeSelectedId);
  const labelThreshold = [...visibleNodes]
    .sort((a, b) => b.degree - a.degree)[Math.min(11, visibleNodes.length - 1)]?.degree ?? Number.POSITIVE_INFINITY;
  const lightweight = visibleNodes.length > 260 || visibleEdges.length > 650;
  return {
    animation: !lightweight,
    animationDuration: lightweight ? 0 : 220,
    animationDurationUpdate: lightweight ? 0 : 120,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      confine: true,
      renderMode: "richText",
      backgroundColor: palette.surface,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const data = (params as { data?: { name?: string; nodeType?: string; degree?: number } }).data;
        return data?.name ? `${data.name}\n${data.nodeType ?? "unknown"} | ${data.degree ?? 0} links` : "";
      },
    },
    series: [{
      type: "graph",
      layout: "force",
      roam: true,
      draggable: true,
      cursor: "pointer",
      data: visibleNodes.map((node) => {
        const [x, y] = positions.get(node.id) ?? [width / 2, height / 2];
        const selected = node.id === activeSelectedId;
        const highlighted = idsForOpacity.has(node.id);
        const color = categoryColor(universeNodeType(node), palette);
        return {
          id: node.id,
          name: node.label,
          nodeType: node.nodeType,
          degree: node.degree,
          x,
          y,
          value: node.degree,
          symbolSize: Math.min(30, 7 + Math.sqrt(Math.max(1, node.degree)) * 2.25) + (selected ? 7 : 0),
          itemStyle: {
            color,
            opacity: hasFocus ? (highlighted ? 1 : .1) : .92,
            shadowBlur: selected ? 18 : 0,
            shadowColor: color,
            borderColor: selected ? palette.text : palette.border,
            borderWidth: selected ? 2 : 1,
          },
          label: {
            show: selected || (!lightweight && highlighted && node.degree >= labelThreshold),
            color: palette.text,
            fontSize: selected ? 12 : 10,
            width: 150,
            overflow: "truncate",
            position: "right",
          },
          emphasis: { focus: lightweight ? "self" : "adjacency", scale: true, label: { show: true, color: palette.text, fontWeight: 600 } },
        };
      }),
      links: visibleEdges.map((edge) => {
        const connected = !hasFocus || (idsForOpacity.has(edge.source) && idsForOpacity.has(edge.target));
        const source = nodeById.get(edge.source);
        const color = source ? categoryColor(universeNodeType(source), palette) : palette.muted;
        return {
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          lineStyle: {
            color,
            width: Math.min(3.2, .5 + edge.weight * .42),
            opacity: connected ? .38 : .025,
            curveness: lightweight ? .04 : .08,
          },
        };
      }),
      edgeSymbol: ["none", "none"],
      edgeLabel: { show: false },
      force: {
        // Seed from the real cluster projection, then let the graph settle with
        // charge, springs and a generous repulsion radius so nodes do not stack.
        initLayout: "none",
        repulsion: Math.max(140, Math.min(420, 18_000 / Math.max(30, visibleNodes.length))),
        gravity: .05,
        edgeLength: [72, 150],
        friction: .78,
        layoutAnimation: !lightweight,
      },
      lineStyle: { opacity: .36 },
      emphasis: { focus: lightweight ? "none" : "adjacency", lineStyle: { width: 2, opacity: .86 } },
    }],
  };
}

export function KnowledgeUniverseCanvas({ graph, selectedId, query, typeFilter, pathDepth = 1, onSelect }: KnowledgeUniverseCanvasProps) {
  const { t } = useTranslation("pages");
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const nodeByIdRef = useRef(new Map<string, KnowledgeUniverseNode>());
  const onSelectRef = useRef(onSelect);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const [chartReady, setChartReady] = useState(false);
  const [palette, setPalette] = useState(DEFAULT_UNIVERSE_PALETTE);
  const [hovered, setHovered] = useState(false);
  const [rotation, setRotation] = useState(0);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    nodeByIdRef.current = new Map(graph.nodes.map((node) => [node.id, node]));
    onSelectRef.current = onSelect;
  }, [graph.nodes, onSelect]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    void import("echarts").then((echarts) => {
      if (cancelled || !hostRef.current) return;
      const chart = echarts.init(hostRef.current, undefined, { renderer: "canvas", devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.25) });
      chartRef.current = chart;
      chart.on("click", (params) => {
        if (params.dataType !== "node") return;
        const id = (params.data as { id?: string })?.id;
        const node = id ? nodeByIdRef.current.get(id) : undefined;
        if (node) onSelectRef.current(node);
      });
      chart.on("mouseover", (params) => setHovered(params.dataType === "node"));
      chart.on("mouseout", () => setHovered(false));
      resizeObserver = new ResizeObserver(([entry]) => {
        const width = Math.max(320, Math.round(entry.contentRect.width));
        const height = Math.max(320, Math.round(entry.contentRect.height));
        setSize((current) => current.width === width && current.height === height ? current : { width, height });
        chart.resize({ width, height });
      });
      resizeObserver.observe(hostRef.current);
      themeObserver = new MutationObserver(() => setPalette(cssPalette()));
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "data-aqua-scheme", "style"],
      });
      setPalette(cssPalette());
      setChartReady(true);
    });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartReady) return;
    chartRef.current?.setOption(universeOption(graph, selectedId, deferredQuery, typeFilter, size.width, size.height, pathDepth, rotation, palette), { notMerge: false, lazyUpdate: true });
  }, [chartReady, graph, selectedId, deferredQuery, typeFilter, pathDepth, rotation, size, palette]);

  const nodeCount = useMemo(() => graph.nodes.length, [graph.nodes.length]);
  return (
    <div
      className={styles.stage}
      data-testid="knowledge-universe-canvas"
      aria-label={t("knowledge.canvasLabel")}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={`${styles.hud} ${styles.hudTop}`}>
        {/* eslint-disable-next-line i18next/no-literal-string -- stable canvas status label */}
        <div className={styles.hudLine}><span className={styles.signal} />KNOWLEDGE UNIVERSE</div>
        <div>{hovered ? t("knowledge.trackingNode") : t("knowledge.liveTopology")}</div>
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => {
            chartRef.current?.clear();
            setRotation((value) => value + .63);
          }}
          title={t("knowledge.resetLayout")}
          aria-label={t("knowledge.resetLayout")}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div ref={hostRef} className={styles.canvas} />
      <div className={styles.legend}>
        {UNIVERSE_CATEGORIES.map((key, index) => <span key={key} className={styles.legendItem}><span className={styles.legendDot} style={{ color: palette.series[index], backgroundColor: palette.series[index] }} />{t(`knowledge.types.${key}`)}</span>)}
      </div>
      <div className={styles.hint}>{t("knowledge.interactionHint")}</div>
      <span className="sr-only">{t("knowledge.visibleNodeCount", { count: nodeCount })}</span>
    </div>
  );
}
