import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Database,
  FileSearch,
  Image as ImageIcon,
  Info,
  Network,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  importKnowledgeBase,
  isTauri,
  knowledgeBaseArticles,
  knowledgeBaseGraph,
  knowledgeBaseStatus,
  searchKnowledgeBase,
  type KnowledgeBaseStatus,
  type KnowledgeArticleSummary,
  type KnowledgeSearchResult,
  type KnowledgeUniverse,
  type KnowledgeUniverseNode,
} from "@/lib/tauri";
import {
  KnowledgeUniverseCanvas,
} from "@/components/knowledge/KnowledgeUniverseCanvas";
import {
  UNIVERSE_CATEGORIES,
  universeThemeColor,
  universeType,
} from "@/components/knowledge/knowledgeUniverseTypes";

const DEFAULT_SOURCE = "C:\\Users\\泰\\Desktop\\CATDA\\CATDA\\output_extract";
const TYPE_FILTERS = ["all", ...UNIVERSE_CATEGORIES] as const;

function filterThemeColor(key: (typeof TYPE_FILTERS)[number]): string {
  return key === "all" ? "var(--accent)" : universeThemeColor(key);
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function typeLabel(t: TFunction<"pages">, node: KnowledgeUniverseNode): string {
  return t(`knowledge.types.${universeType(node.nodeType, node.cluster)}`);
}

type RelatedNode = {
  node: KnowledgeUniverseNode;
  edge: KnowledgeUniverse["edges"][number];
  direction: "in" | "out";
};

function relatedNodes(graph: KnowledgeUniverse, selected: KnowledgeUniverseNode | null): RelatedNode[] {
  if (!selected) return [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const related: RelatedNode[] = [];
  for (const edge of graph.edges) {
    if (edge.source === selected.id) {
      const node = nodes.get(edge.target);
      if (node) related.push({ node, edge, direction: "out" });
    } else if (edge.target === selected.id) {
      const node = nodes.get(edge.source);
      if (node) related.push({ node, edge, direction: "in" });
    }
  }
  return related.sort((a, b) => b.edge.weight - a.edge.weight || b.node.degree - a.node.degree);
}

export function KnowledgeBasePage() {
  const { t } = useTranslation("pages");
  const [status, setStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [articles, setArticles] = useState<KnowledgeArticleSummary[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [articleQuery, setArticleQuery] = useState("");
  const [graph, setGraph] = useState<KnowledgeUniverse | null>(null);
  const [sourceDir, setSourceDir] = useState(DEFAULT_SOURCE);
  const [graphQuery, setGraphQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("all");
  const [pathDepth, setPathDepth] = useState<1 | 2>(1);
  const [selectedNode, setSelectedNode] = useState<KnowledgeUniverseNode | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [articlesBusy, setArticlesBusy] = useState(false);
  const [graphBusy, setGraphBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const graphSectionRef = useRef<HTMLElement>(null);

  const loadUniverse = useCallback(async (sourceId: string) => {
    if (!isTauri || !sourceId) return;
    setSelectedArticleId(sourceId);
    setGraph(null);
    setSelectedNode(null);
    setGraphQuery("");
    setTypeFilter("all");
    setGraphBusy(true);
    setError(null);
    try {
      const next = await knowledgeBaseGraph(sourceId);
      setGraph(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGraphBusy(false);
    }
  }, []);

  const loadArticles = useCallback(async () => {
    if (!isTauri) return;
    setArticlesBusy(true);
    try {
      setArticles(await knowledgeBaseArticles());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setArticlesBusy(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (!isTauri) return;
    try {
      const next = await knowledgeBaseStatus();
      if (next) {
        setStatus(next);
        if (next.sourceDir) setSourceDir(next.sourceDir);
        if (next.enabled) void loadArticles();
        else {
          setArticles([]);
          setGraph(null);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [loadArticles]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const importNow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await importKnowledgeBase(sourceDir);
      setStatus(next);
      setGraph(null);
      setSelectedArticleId("");
      await loadArticles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const searchNow = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchKnowledgeBase(query, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSearching(false);
    }
  };

  const loadSearchResult = async (sourceId: string) => {
    await loadUniverse(sourceId);
    graphSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  const neighbors = useMemo(() => graph ? relatedNodes(graph, selectedNode) : [], [graph, selectedNode]);
  const selectedStillVisible = selectedNode && graph?.nodes.some((node) => node.id === selectedNode.id);
  const selectedArticle = useMemo(() => articles.find((article) => article.sourceId === selectedArticleId) ?? null, [articles, selectedArticleId]);
  const articleMatches = useMemo(() => {
    const needle = articleQuery.trim().toLocaleLowerCase();
    return needle
      ? articles.filter((article) => `${article.sourceId} ${article.title}`.toLocaleLowerCase().includes(needle))
      : articles;
  }, [articleQuery, articles]);
  const matchingArticles = articleMatches.slice(0, 200);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-bg text-text">
      <header className="shrink-0 border-b border-border bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-input border border-accent/30 bg-accent/10 text-accent"><Network size={18} /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="font-serif text-xl font-semibold tracking-tight text-text sm:text-2xl">{t("knowledge.universeTitle")}</h1></div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted sm:text-sm">{t("knowledge.universeDescription")}</p>
            </div>
          </div>
          {graph && <div className="grid w-full grid-cols-2 gap-x-5 gap-y-2 text-right sm:w-auto sm:grid-cols-4"><Metric label={t("knowledge.articleNodes")} value={graph.totalNodes} /><Metric label={t("knowledge.articleEdges")} value={graph.totalEdges} /><Metric label={t("knowledge.visibleNodes")} value={graph.visibleNodes} /><Metric label={t("knowledge.visibleEdges")} value={graph.visibleEdges} /></div>}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1700px] min-w-0 flex-1 flex-col gap-4 p-3 sm:p-5">
        {!isTauri && <div className="rounded-card border border-warn/30 bg-warn/10 p-3 text-sm text-warn">{t("knowledge.desktopOnly")}</div>}

        <section className="rounded-card border border-border bg-surface p-3 shadow-card sm:p-4">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSourceExpanded((expanded) => !expanded)} aria-expanded={sourceExpanded} className="flex min-w-0 flex-1 items-center gap-2 rounded-input px-1 py-1 text-left text-xs font-semibold uppercase tracking-[.12em] text-text hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              <Database size={14} className="shrink-0 text-accent" /><span className="truncate">{t("knowledge.importTitle")}</span>
              {!sourceExpanded && status && <span className="ml-auto truncate text-[10px] font-normal normal-case tracking-normal text-muted">{status.documents.toLocaleString()} · {status.nodes.toLocaleString()} · {status.edges.toLocaleString()}</span>}
              {sourceExpanded ? <ChevronUp size={15} className="shrink-0 text-muted" /> : <ChevronDown size={15} className="shrink-0 text-muted" />}
            </button>
            <button type="button" onClick={() => void loadStatus()} className="rounded-input p-1.5 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" title={t("knowledge.refresh")} aria-label={t("knowledge.refresh")}><RefreshCw size={15} /></button>
          </div>
          {sourceExpanded && <div className="mt-3">
            <div className="flex flex-col gap-2 lg:flex-row"><input value={sourceDir} onChange={(event) => setSourceDir(event.target.value)} className="min-w-0 flex-1 rounded-input border border-border bg-bg px-3 py-2 text-xs text-text outline-none placeholder:text-muted focus:border-accent" aria-label={t("knowledge.sourceLabel")} /><button type="button" onClick={() => void importNow()} disabled={busy || !isTauri} className="inline-flex items-center justify-center gap-2 rounded-input border border-accent/35 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/15 disabled:opacity-50"><RefreshCw size={14} className={busy ? "animate-spin" : ""} />{busy ? t("knowledge.importing") : t("knowledge.import")}</button></div>
            {status && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted"><span><b className="font-semibold text-text">{status.documents.toLocaleString()}</b> {t("knowledge.documents")}</span><span><b className="font-semibold text-text">{status.nodes.toLocaleString()}</b> {t("knowledge.nodes")}</span><span><b className="font-semibold text-text">{status.edges.toLocaleString()}</b> {t("knowledge.edges")}</span><span><b className="font-semibold text-text">{formatBytes(status.indexedBytes)}</b> {t("knowledge.indexedSize")}</span><span className={status.enabled ? "text-ok" : "text-warn"}>{status.enabled ? t("knowledge.ready") : t("knowledge.notIndexed")}</span></div>}
          </div>}
        </section>

        {error && <div role="alert" className="flex items-start gap-2 rounded-card border border-error/30 bg-error/10 p-3 text-xs text-error"><Info size={14} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1 break-words">{error}</span><button type="button" onClick={() => setError(null)} className="rounded p-0.5 text-error/75 hover:bg-error/10" aria-label={t("knowledge.dismissError")}><X size={14} /></button></div>}

        <section className="rounded-card border border-border bg-surface p-3 shadow-card sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-text"><BookOpen size={14} className="text-accent" />{t("knowledge.articleLoader")}</div>
            <span className="text-[10px] text-muted">{articlesBusy ? t("knowledge.articleMetadataLoading") : t("knowledge.articleCount", { count: articles.length })}</span>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,.7fr)_minmax(320px,1.3fr)]">
            <label className="relative flex h-9 items-center rounded-input border border-border bg-bg px-2.5 focus-within:border-accent"><Search size={14} className="mr-2 shrink-0 text-muted" /><input value={articleQuery} onChange={(event) => setArticleQuery(event.target.value)} placeholder={t("knowledge.articleSearchPlaceholder")} aria-label={t("knowledge.articleSearchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted" />{articleQuery && <button type="button" onClick={() => setArticleQuery("")} className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("knowledge.clearSearch")}><X size={13} /></button>}</label>
            <select value={selectedArticleId} onChange={(event) => { const sourceId = event.target.value; if (sourceId) void loadUniverse(sourceId); else { setSelectedArticleId(""); setGraph(null); setSelectedNode(null); } }} disabled={!status?.enabled || articles.length === 0 || articlesBusy || graphBusy} className="knowledge-article-select select-chrome h-9 min-w-0 rounded-input border border-border bg-bg px-3 text-xs text-text outline-none focus:border-accent disabled:opacity-50" aria-label={t("knowledge.articleSelectLabel")}>
              <option value="">{t("knowledge.selectArticleOption")}</option>
              {selectedArticle && !matchingArticles.some((article) => article.sourceId === selectedArticle.sourceId) && <option value={selectedArticle.sourceId}>{selectedArticle.sourceId} | {selectedArticle.title}</option>}
              {matchingArticles.map((article) => <option key={article.sourceId} value={article.sourceId}>{article.sourceId} | {article.title} | {article.nodes.toLocaleString()} {t("knowledge.nodes")}</option>)}
            </select>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted"><span>{selectedArticle ? t("knowledge.selectedArticle", { id: selectedArticle.sourceId, title: selectedArticle.title }) : t("knowledge.articleLoadHint")}</span>{matchingArticles.length < articleMatches.length && <span>{t("knowledge.articleMatches", { shown: matchingArticles.length, total: articleMatches.length })}</span>}</div>
        </section>

        <section ref={graphSectionRef} className="grid min-h-0 min-w-0 scroll-mt-3 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 overflow-hidden rounded-card border border-border bg-bg shadow-card">
            {graphBusy ? <div className="flex h-[min(72vh,760px)] min-h-[500px] items-center justify-center bg-bg text-xs text-muted"><RefreshCw size={16} className="mr-2 animate-spin" />{t("knowledge.universeLoading")}</div> : graph ? <div className="h-[min(72vh,760px)] min-h-[500px]"><KnowledgeUniverseCanvas graph={graph} selectedId={selectedStillVisible ? selectedNode.id : null} query={graphQuery} typeFilter={typeFilter} pathDepth={pathDepth} onSelect={setSelectedNode} /></div> : <div className="flex h-[min(72vh,760px)] min-h-[500px] flex-col items-center justify-center bg-bg p-6 text-center"><BookOpen size={26} className="mb-3 text-accent/70" /><p className="text-sm font-semibold text-text">{t(status?.enabled ? "knowledge.selectArticle" : "knowledge.indexFirst")}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted">{t(status?.enabled ? "knowledge.selectArticleBody" : "knowledge.universeUnavailableBody")}</p></div>}
          </div>

          <aside className="min-w-0 rounded-card border border-border bg-surface p-3 shadow-card sm:p-4">
            <button type="button" onClick={() => setControlsExpanded((expanded) => !expanded)} aria-expanded={controlsExpanded} className="flex w-full items-center gap-2 rounded-input px-1 py-1 text-left text-xs font-semibold uppercase tracking-[.12em] text-text hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><SlidersHorizontal size={14} className="shrink-0 text-accent" /><span className="flex-1">{t("knowledge.controls")}</span>{controlsExpanded ? <ChevronUp size={15} className="text-muted" /> : <ChevronDown size={15} className="text-muted" />}</button>
            {controlsExpanded && <div>
              <label className="relative mt-3 flex h-9 items-center rounded-input border border-border bg-bg px-2.5 focus-within:border-accent"><Search size={14} className="mr-2 shrink-0 text-muted" /><input value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder={t("knowledge.nodeSearchPlaceholder")} aria-label={t("knowledge.nodeSearchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted" />{graphQuery && <button type="button" onClick={() => setGraphQuery("")} className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("knowledge.clearSearch")}><X size={13} /></button>}</label>
              <div className="mt-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.12em] text-muted"><SlidersHorizontal size={12} />{t("knowledge.filterByType")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">{TYPE_FILTERS.map((key) => {
                const active = typeFilter === key;
                const color = filterThemeColor(key);
                return <button key={key} type="button" onClick={() => setTypeFilter(key)} className="rounded-input border px-2 py-1.5 text-[11px] transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" style={{ borderColor: active ? color : "var(--border)", backgroundColor: active ? `color-mix(in srgb, ${color} 14%, var(--surface))` : "transparent", color: active ? "var(--text)" : "var(--muted)" }}>{key === "all" ? t("knowledge.types.all") : t(`knowledge.types.${key}`)}</button>;
              })}</div>
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[10px] font-medium uppercase tracking-[.12em] text-muted">{t("knowledge.pathDepth")}</span><div className="grid grid-cols-2 rounded-input border border-border bg-surface-2 p-0.5">{([1, 2] as const).map((depth) => <button key={depth} type="button" onClick={() => setPathDepth(depth)} className={`h-7 min-w-10 rounded px-2 text-[11px] transition-colors ${pathDepth === depth ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface hover:text-text"}`}>{t("knowledge.hops", { count: depth })}</button>)}</div></div>
              <div className="mt-4 border-t border-border pt-4">{selectedNode ? <NodeDetails node={selectedNode} neighbors={neighbors} t={t} onSelect={setSelectedNode} /> : <div className="flex min-h-40 flex-col items-center justify-center px-3 py-7 text-center text-xs leading-5 text-muted"><Network size={20} className="mb-2 text-accent/70" />{t("knowledge.selectNode")}</div>}</div>
            </div>}
          </aside>
        </section>

        {graph?.truncated && <div className="flex items-start gap-2 rounded-card border border-accent/20 bg-accent/10 px-3 py-2.5 text-[11px] leading-5 text-muted"><Info size={14} className="mt-0.5 shrink-0 text-accent" /><span>{t("knowledge.projectionNotice", { nodes: graph.visibleNodes.toLocaleString(), totalNodes: graph.totalNodes.toLocaleString(), edges: graph.visibleEdges.toLocaleString(), totalEdges: graph.totalEdges.toLocaleString() })}</span></div>}

        <section className="rounded-card border border-border bg-surface p-3 shadow-card sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-text"><FileSearch size={14} className="text-accent" />{t("knowledge.searchTitle")}</div><span className="text-[10px] text-muted">{t("knowledge.searchScope")}</span></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchNow(); }} placeholder={t("knowledge.searchPlaceholder")} aria-label={t("knowledge.searchPlaceholder")} className="w-full rounded-input border border-border bg-bg py-2.5 pl-9 pr-3 text-xs text-text outline-none placeholder:text-muted focus:border-accent" /></div><button type="button" onClick={() => void searchNow()} disabled={searching || !query.trim() || !status?.enabled} className="inline-flex items-center justify-center gap-2 rounded-input bg-accent px-4 py-2 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"><FileSearch size={14} />{searching ? t("knowledge.searching") : t("knowledge.search")}</button></div><div className="mt-4 space-y-3">{results.map((result) => <article key={result.sourceId} className="border-t border-border pt-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h3 className="text-sm font-medium text-text">{result.title}</h3><span className="mt-1 block font-mono text-[10px] text-muted">{result.sourceId}</span></div><button type="button" onClick={() => void loadSearchResult(result.sourceId)} disabled={graphBusy} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-input border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/15 disabled:opacity-50"><BookOpen size={13} />{t("knowledge.loadArticleGraph")}</button></div><p className="mt-2 text-xs leading-5 text-muted">{result.snippet}</p>{result.relatedImages.length > 0 && <div className="mt-1 flex items-center gap-1 text-[11px] text-link"><ImageIcon size={12} />{t("knowledge.visualEvidence")}: {result.relatedImages.slice(0, 4).join(", ")}</div>}</article>)}{!results.length && <p className="py-5 text-center text-xs text-muted">{t(status?.enabled ? "knowledge.noResults" : "knowledge.indexFirst")}</p>}</div></section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><div className="font-mono text-sm font-semibold tabular-nums text-text">{value.toLocaleString()}</div><div className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-muted">{label}</div></div>;
}

function NodeDetails({ node, neighbors, t, onSelect }: { node: KnowledgeUniverseNode; neighbors: RelatedNode[]; t: TFunction<"pages">; onSelect: (node: KnowledgeUniverseNode) => void }) {
  const color = universeThemeColor(node.nodeType, node.cluster);
  return <div><div className="flex items-start gap-2"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} /><div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-[.14em] text-muted">{typeLabel(t, node)}</div><h2 className="mt-1 break-words text-sm font-semibold leading-5 text-text">{node.label}</h2></div><span className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-1 font-mono text-[10px] text-muted">{t("knowledge.degree", { count: node.degree })}</span></div><dl className="mt-4 grid grid-cols-[78px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px]"><dt className="text-muted">{t("knowledge.rawType")}</dt><dd className="truncate font-mono text-[10px] text-text">{node.nodeType}</dd><dt className="text-muted">{t("knowledge.cluster")}</dt><dd className="truncate text-text">{node.cluster}</dd><dt className="text-muted">{t("knowledge.sourceArticle")}</dt><dd className="truncate font-mono text-[10px] text-muted">{node.sourceId}</dd></dl>{node.properties && <div className="mt-4"><div className="text-[10px] uppercase tracking-[.12em] text-muted">{t("knowledge.properties")}</div><p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-input border border-border bg-bg p-2 text-[11px] leading-5 text-muted">{node.properties}</p></div>}{node.relatedImages.length > 0 && <div className="mt-4"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[.12em] text-muted"><ImageIcon size={12} />{t("knowledge.relatedImages")}</div><p className="mt-1 break-words text-[11px] leading-5 text-link">{node.relatedImages.slice(0, 8).join(", ")}</p></div>}<div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-text">{t("knowledge.relations", { count: neighbors.length })}</h3><span className="text-[10px] text-muted">{t("knowledge.oneHop")}</span></div><div className="mt-2 space-y-1">{neighbors.slice(0, 24).map(({ node: related, edge, direction }) => <button key={`${edge.source}:${edge.target}:${edge.relation}`} type="button" onClick={() => onSelect(related)} className="group flex w-full items-start gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-2"><ArrowRight size={12} className={`mt-0.5 shrink-0 text-muted ${direction === "in" ? "rotate-180" : ""}`} /><span className="min-w-0 flex-1"><span className="block truncate text-xs text-text">{related.label}</span><span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted"><span className="truncate">{edge.relation}</span><span className="shrink-0">×{edge.weight.toFixed(1)}</span></span></span></button>)}{neighbors.length === 0 && <p className="px-2 py-3 text-xs text-muted">{t("knowledge.noRelations")}</p>}</div></div></div>;
}
