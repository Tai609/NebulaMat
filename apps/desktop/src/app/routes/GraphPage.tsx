import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ExternalLink,
  FileCode2,
  FolderTree,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { cn } from "@/lib/cn";
import {
  activeGraphPath,
  conversationGraphInput,
  graphifyMcpConfig,
  graphNeighbors,
} from "@/lib/graphify";
import { getClient, useRuntimeStore } from "@/lib/runtime";
import {
  getGraphifyStatus,
  indexGraphifyConversation,
  indexGraphifyProject,
  listGraphifyScopes,
  openGraphifySource,
  readGraphifyGraph,
  setupGraphify,
  listDshMcpServers,
  setDshMcpServer,
  watchSetupProgress,
  type GraphDocument,
  type GraphNode,
  type GraphScopeInfo,
  type GraphScopeKind,
  type GraphifyStatus,
} from "@/lib/tauri";
import { isGatewayWeb } from "@/lib/webMode";

interface Candidate {
  id: string;
  kind: GraphScopeKind;
  title: string;
  updated?: number;
  indexed?: GraphScopeInfo;
}

const keyOf = (scope: Pick<Candidate, "kind" | "id">) => `${scope.kind}:${scope.id}`;
const SCOPE_KINDS: GraphScopeKind[] = ["project", "conversation"];

export function GraphPage() {
  const { t } = useTranslation("graph");
  const navigate = useNavigate();
  const projects = useRuntimeStore((state) => state.projects);
  const sessions = useRuntimeStore((state) => state.sessions);
  const loadCatalog = useRuntimeStore((state) => state.loadCatalog);
  const [tab, setTab] = useState<GraphScopeKind>("project");
  const [scopeSearch, setScopeSearch] = useState("");
  const [graphSearch, setGraphSearch] = useState("");
  const [scopes, setScopes] = useState<GraphScopeInfo[]>([]);
  const [status, setStatus] = useState<GraphifyStatus | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphDocument | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextStatus, nextScopes, servers] = await Promise.all([
      getGraphifyStatus(),
      listGraphifyScopes(),
      listDshMcpServers().catch(() => []),
    ]);
    setStatus(nextStatus);
    setScopes(nextScopes);
    const server = servers.find((item) => item.name === "graphify");
    setActivePath(activeGraphPath(server?.config));
  }, []);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void watchSetupProgress((event) => {
      if (event.task === "graphify") setProgress(event.line);
    }).then((dispose) => {
      if (cancelled) dispose();
      else unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refresh]);

  const indexedByKey = useMemo(
    () => new Map(scopes.map((scope) => [keyOf(scope), scope])),
    [scopes],
  );
  const candidates = useMemo<Candidate[]>(() => {
    const projectRows = projects.map((project) => ({
      id: project.id,
      kind: "project" as const,
      title: project.name,
      updated: project.createdAt,
      indexed: indexedByKey.get(`project:${project.id}`),
    }));
    const conversationRows = sessions
      .filter((session) => !session.parentId)
      .map((session) => ({
        id: session.id,
        kind: "conversation" as const,
        title: session.title,
        updated: session.updated,
        indexed: indexedByKey.get(`conversation:${session.id}`),
      }));
    return [...projectRows, ...conversationRows];
  }, [indexedByKey, projects, sessions]);

  const visibleCandidates = candidates
    .filter((candidate) => candidate.kind === tab)
    .filter((candidate) => candidate.title.toLocaleLowerCase().includes(scopeSearch.trim().toLocaleLowerCase()))
    .sort((a, b) => (b.indexed?.indexedAt ?? b.updated ?? 0) - (a.indexed?.indexedAt ?? a.updated ?? 0));

  useEffect(() => {
    if (selectedKey && candidates.some((candidate) => keyOf(candidate) === selectedKey)) return;
    const first = candidates.find((candidate) => candidate.kind === tab && candidate.indexed)
      ?? candidates.find((candidate) => candidate.kind === tab);
    setSelectedKey(first ? keyOf(first) : null);
  }, [candidates, selectedKey, tab]);

  const selected = candidates.find((candidate) => keyOf(candidate) === selectedKey) ?? null;

  useEffect(() => {
    setSelectedNode(null);
    setGraphSearch("");
    setError(null);
    if (!selected?.indexed) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    setBusyKey(keyOf(selected));
    void readGraphifyGraph(selected.kind, selected.id)
      .then((document) => {
        if (!cancelled) setGraph(document);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setBusyKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const ensureInstalled = async (): Promise<GraphifyStatus> => {
    if (status?.installed && status.mcpCommand) return status;
    const next = await setupGraphify();
    setStatus(next);
    return next;
  };

  const activate = async (scope: GraphScopeInfo, currentStatus?: GraphifyStatus) => {
    const installed = currentStatus ?? (await ensureInstalled());
    if (!installed.mcpCommand) throw new Error(t("errors.missingCommand"));
    await setDshMcpServer("graphify", graphifyMcpConfig(installed.mcpCommand, scope.graphPath));
    setActivePath(scope.graphPath);
    await loadCatalog();
  };

  const build = async () => {
    if (!selected || busyKey) return;
    const key = keyOf(selected);
    setBusyKey(key);
    setProgress(null);
    setError(null);
    try {
      const installed = await ensureInstalled();
      const scope = selected.kind === "project"
        ? await indexGraphifyProject(selected.id)
        : await (async () => {
            const client = getClient();
            if (!client) throw new Error(t("errors.runtimeUnavailable"));
            const messages = await client.getMessages(selected.id);
            return indexGraphifyConversation(
              selected.id,
              selected.title,
              conversationGraphInput(messages),
            );
          })();
      await activate(scope, installed);
      const document = await readGraphifyGraph(scope.kind, scope.id);
      setScopes((current) => [scope, ...current.filter((item) => keyOf(item) !== key)]);
      setGraph(document);
      setSelectedNode(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(null);
      setProgress(null);
      void refresh();
    }
  };

  const activateForChat = async () => {
    if (!selected?.indexed || busyKey) return;
    setBusyKey(keyOf(selected));
    setError(null);
    try {
      await activate(selected.indexed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const neighbors = graph && selectedNode ? graphNeighbors(graph, selectedNode.id) : [];
  const matches = graphSearch.trim()
    ? graph?.nodes.filter((node) =>
        [node.label, node.sourceFile, node.communityName]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(graphSearch.trim().toLocaleLowerCase())),
      ).slice(0, 8) ?? []
    : [];
  const isActive = !!selected?.indexed && activePath === selected.indexed.graphPath;

  if (isGatewayWeb) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <Network size={28} className="mx-auto mb-3 text-muted" />
          <h1 className="text-base font-semibold text-text">{t("desktopOnly.title")}</h1>
          <p className="mt-1 text-sm leading-6 text-muted">{t("desktopOnly.body")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex max-h-[240px] shrink-0 flex-col border-b border-border bg-surface md:max-h-none md:w-[286px] md:border-b-0 md:border-r">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <Network size={17} className="text-accent" />
          <h1 className="text-sm font-semibold text-text">{t("title")}</h1>
          {status?.installed && (
            <span className="ml-auto font-mono text-[10px] text-muted">{status.version}</span>
          )}
        </div>
        <div className="p-3 pb-2">
          <div className="grid grid-cols-2 rounded-input bg-surface-2 p-0.5">
            {SCOPE_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => {
                  setTab(kind);
                  setSelectedKey(null);
                }}
                className={cn(
                  "flex min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-colors",
                  tab === kind ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
                )}
              >
                {kind === "project" ? <FolderTree size={13} /> : <MessageSquare size={13} />}
                {t(`tabs.${kind}`)}
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-input border border-border bg-bg px-2.5 py-1.5 focus-within:border-accent">
            <Search size={13} className="shrink-0 text-muted" />
            <input
              value={scopeSearch}
              onChange={(event) => setScopeSearch(event.target.value)}
              placeholder={t("scopeSearch")}
              className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {visibleCandidates.map((candidate) => {
            const active = selectedKey === keyOf(candidate);
            return (
              <button
                key={keyOf(candidate)}
                onClick={() => setSelectedKey(keyOf(candidate))}
                className={cn(
                  "mb-0.5 flex w-full items-start gap-2 rounded-input px-2.5 py-2 text-left transition-colors",
                  active ? "bg-surface-2 text-text" : "text-text hover:bg-surface-2/70",
                )}
              >
                {candidate.kind === "project" ? (
                  <FolderTree size={14} className="mt-0.5 shrink-0 text-muted" />
                ) : (
                  <MessageSquare size={14} className="mt-0.5 shrink-0 text-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{candidate.title}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted">
                    {candidate.indexed
                      ? t("scopeMeta", { nodes: candidate.indexed.nodeCount, edges: candidate.indexed.edgeCount })
                      : t("notIndexed")}
                  </span>
                </span>
                {candidate.indexed && activePath === candidate.indexed.graphPath && (
                  <Check size={12} className="mt-0.5 shrink-0 text-ok" aria-label={t("activeForChat")} />
                )}
              </button>
            );
          })}
          {visibleCandidates.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted">
              {scopeSearch ? t("noScopeResults") : t(`empty.${tab}`)}
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-text">{selected?.title ?? t("noSelection")}</h2>
              {isActive && (
                <span className="shrink-0 rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">
                  {t("activeForChat")}
                </span>
              )}
            </div>
            {selected?.indexed && (
              <p className="mt-0.5 text-[10px] text-muted">
                {t("indexedMeta", {
                  nodes: selected.indexed.nodeCount,
                  edges: selected.indexed.edgeCount,
                  date: new Date(selected.indexed.indexedAt).toLocaleString(),
                })}
              </p>
            )}
          </div>
          {selected?.indexed && (
            <label className="relative flex h-8 w-full items-center rounded-input border border-border bg-surface px-2.5 sm:w-[210px] focus-within:border-accent">
              <Search size={13} className="mr-2 shrink-0 text-muted" />
              <input
                value={graphSearch}
                onChange={(event) => setGraphSearch(event.target.value)}
                placeholder={t("graphSearch")}
                className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted"
              />
              {matches.length > 0 && (
                <div className="absolute left-0 right-0 top-[35px] z-20 max-h-64 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-pop">
                  {matches.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => {
                        setSelectedNode(node);
                        setGraphSearch(node.label);
                      }}
                      className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-xs text-text hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate">{node.label}</span>
                      <span className="shrink-0 text-[10px] text-muted">{node.nodeType}</span>
                    </button>
                  ))}
                </div>
              )}
            </label>
          )}
          {selected?.indexed && !isActive && (
            <button
              onClick={() => void activateForChat()}
              disabled={!!busyKey}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 text-xs font-medium text-text hover:bg-surface-2 disabled:opacity-50"
            >
              <Sparkles size={13} />
              {t("useForChat")}
            </button>
          )}
          {selected && (
            <button
              onClick={() => void build()}
              disabled={!!busyKey}
              title={selected.indexed ? t("refresh") : t("build")}
              aria-label={selected.indexed ? t("refresh") : t("build")}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-input px-2.5 text-xs font-medium disabled:opacity-50",
                selected.indexed
                  ? "border border-border bg-surface text-text hover:bg-surface-2"
                  : "bg-accent text-accent-fg hover:opacity-90",
              )}
            >
              {busyKey ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {!selected.indexed && t("build")}
            </button>
          )}
        </header>

        {error && (
          <div className="flex shrink-0 items-start gap-2 border-b border-error/20 bg-error/10 px-4 py-2 text-xs text-error">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{error}</span>
          </div>
        )}
        {busyKey && progress && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-4 py-1.5 text-[11px] text-muted">
            <Loader2 size={12} className="animate-spin" />
            <span className="truncate font-mono">{progress}</span>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {!selected ? (
            <CenteredState icon={<Network size={28} />} title={t("noSelection")} body={t("noSelectionBody")} />
          ) : !selected.indexed && !busyKey ? (
            <CenteredState
              icon={selected.kind === "project" ? <FileCode2 size={28} /> : <MessageSquare size={28} />}
              title={t(`unindexed.${selected.kind}.title`)}
              body={t(`unindexed.${selected.kind}.body`)}
              action={
                <button
                  onClick={() => void build()}
                  className="mt-4 inline-flex items-center gap-2 rounded-input bg-accent px-3 py-2 text-xs font-semibold text-accent-fg hover:opacity-90"
                >
                  <Sparkles size={14} />
                  {status?.installed ? t("build") : t("installAndBuild")}
                </button>
              }
            />
          ) : busyKey && !graph ? (
            <GraphSkeleton />
          ) : graph ? (
            <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="relative min-h-[360px] overflow-hidden bg-surface/40">
                <GraphCanvas
                  graph={graph}
                  selectedId={selectedNode?.id ?? null}
                  query={graphSearch}
                  onSelect={setSelectedNode}
                />
                <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5">
                  {[...new Set(graph.nodes.map((node) => node.communityName ?? node.nodeType))].slice(0, 6).map((name) => (
                    <span key={name} className="rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-muted shadow-sm">
                      {name}
                    </span>
                  ))}
                </div>
                {graph.truncated && (
                  <div className="absolute right-3 top-3 rounded bg-surface/95 px-2 py-1 text-[10px] text-muted shadow-sm">
                    {t("truncated", { nodes: graph.totalNodes, edges: graph.totalEdges })}
                  </div>
                )}
              </div>
              <aside className="min-h-0 overflow-y-auto border-t border-border bg-surface lg:border-l lg:border-t-0">
                {selectedNode ? (
                  <NodeDetails
                    node={selectedNode}
                    neighbors={neighbors}
                    scope={graph.scope}
                    onSelect={setSelectedNode}
                    onOpenSource={() => {
                      if (graph.scope.kind === "conversation") navigate(`/live/${graph.scope.id}`);
                      else if (selectedNode.sourceFile) void openGraphifySource(graph.scope.id, selectedNode.sourceFile);
                    }}
                  />
                ) : (
                  <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center text-xs leading-5 text-muted">
                    <Network size={20} className="mb-2 opacity-60" />
                    {t("selectNode")}
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <CenteredState icon={<TriangleAlert size={28} />} title={t("loadFailed")} body={error ?? t("loadFailedBody")} />
          )}
        </div>
      </section>
    </div>
  );
}

function CenteredState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-card border border-border bg-surface text-muted">
          {icon}
        </div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
        {action}
      </div>
    </div>
  );
}

function GraphSkeleton() {
  return (
    <div className="relative h-full min-h-[320px] overflow-hidden bg-surface/40" aria-busy="true">
      {Array.from({ length: 18 }, (_, index) => (
        <div
          key={index}
          className="absolute h-3 w-3 animate-pulse rounded-full bg-border"
          style={{ left: `${8 + ((index * 29) % 84)}%`, top: `${12 + ((index * 41) % 74)}%` }}
        />
      ))}
    </div>
  );
}

function NodeDetails({
  node,
  neighbors,
  scope,
  onSelect,
  onOpenSource,
}: {
  node: GraphNode;
  neighbors: ReturnType<typeof graphNeighbors>;
  scope: GraphScopeInfo;
  onSelect: (node: GraphNode) => void;
  onOpenSource: () => void;
}) {
  const { t } = useTranslation("graph");
  return (
    <div className="p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase text-muted">{node.nodeType}</p>
          <h3 className="mt-1 break-words text-sm font-semibold leading-5 text-text">{node.label}</h3>
        </div>
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
          {t("degree", { count: node.degree })}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-[86px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        {node.communityName && (
          <>
            <dt className="text-muted">{t("fields.community")}</dt>
            <dd className="truncate text-text">{node.communityName}</dd>
          </>
        )}
        {node.sourceLocation && (
          <>
            <dt className="text-muted">{t("fields.location")}</dt>
            <dd className="truncate font-mono text-[11px] text-text">{node.sourceLocation}</dd>
          </>
        )}
        {node.sourceFile && (
          <>
            <dt className="text-muted">{t("fields.source")}</dt>
            <dd className="break-all font-mono text-[11px] leading-4 text-text">{node.sourceFile}</dd>
          </>
        )}
      </dl>
      {(node.sourceFile || scope.kind === "conversation") && (
        <button
          onClick={onOpenSource}
          className="mt-4 inline-flex items-center gap-1.5 rounded-input border border-border bg-bg px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-2"
        >
          <ExternalLink size={13} />
          {scope.kind === "conversation" ? t("openConversation") : t("openSource")}
        </button>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <h4 className="text-xs font-semibold text-text">{t("relations", { count: neighbors.length })}</h4>
        <div className="mt-2 space-y-1">
          {neighbors.slice(0, 30).map(({ node: related, edge, direction }) => (
            <button
              key={`${edge.source}:${edge.target}:${edge.relation}`}
              onClick={() => onSelect(related)}
              className="group flex w-full items-start gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <ArrowRight
                size={12}
                className={cn("mt-0.5 shrink-0 text-muted", direction === "in" && "rotate-180")}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-text">{related.label}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                  <span>{edge.relation}</span>
                  {edge.confidence && <span>{edge.confidence}</span>}
                </span>
              </span>
            </button>
          ))}
          {neighbors.length === 0 && <p className="px-2 py-3 text-xs text-muted">{t("noRelations")}</p>}
        </div>
      </div>
    </div>
  );
}
