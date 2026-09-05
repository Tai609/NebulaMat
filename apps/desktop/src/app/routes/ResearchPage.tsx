import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  Database,
  Download,
  GitBranch,
  MessageCircle,
  Merge,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  addResearchEdge,
  addResearchEvidence,
  addResearchNode,
  buildInnoClawContextArchive,
  compileResearchReport,
  updateResearchClaim,
  type ResearchActionType,
  type ResearchEdge,
  type ResearchEvidenceRelation,
  type ResearchGraph,
  type ResearchNodeKind,
  type ResearchNode,
  type ResearchRole,
} from "@ai4s/shared";
import type { InnoClawLiteratureProviderId, ResearchRuntime } from "@ai4s/sdk";
import { ResearchGraphCanvas } from "@/components/research/ResearchGraphCanvas";
import { cn } from "@/lib/cn";
import { initializeResearchWorkspace, researchWorkspaceKey } from "@/lib/researchWorkspace";
import { getActiveResearchId, requestResearchAutopilot, setActiveResearchId } from "@/lib/researchConversation";
import { prepareModelPrompt } from "@/lib/modelPromptPreparation";
import { isGatewayWeb } from "@/lib/webMode";
import { getClient, useRuntimeStore } from "@/lib/runtime";
import { draftKeyFor } from "@/lib/runtime";
import { useLayoutStore } from "@/lib/layout";
import { saveTextWithFeedback } from "@/lib/download";
import { writeWorkspaceFile } from "@/lib/artifactFile";

const INNOCLAW_ROLES: ResearchRole[] = ["researcher", "skeptic", "librarian", "reproducer", "scribe"];

function nodeDescription(node: ResearchNode): string {
  switch (node.kind) {
    case "claim": return node.statement;
    case "hypothesis": return node.statement;
    case "action": return node.objective;
    case "evidence": return node.summary;
    case "artifact": return node.locator;
    case "counterfactual": return node.predictedObservation;
  }
}

function nodeHeading(node: ResearchNode): string {
  return node.label || node.id;
}

export function ResearchPage() {
  const { t } = useTranslation("graph");
  const navigate = useNavigate();
  const [graphs, setGraphs] = useState<ResearchGraph[]>([]);
  const [runtime, setRuntime] = useState<ResearchRuntime | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveResearchId());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [nodeKind, setNodeKind] = useState<Exclude<ResearchNodeKind, "claim">>("hypothesis");
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeDetails, setNodeDetails] = useState("");
  const [evidenceRelation, setEvidenceRelation] = useState<ResearchEvidenceRelation>("inconclusive");
  const [claimDraft, setClaimDraft] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [showInnoClaw, setShowInnoClaw] = useState(false);
  const [literatureQuery, setLiteratureQuery] = useState("");
  const [literatureProvider, setLiteratureProvider] = useState<InnoClawLiteratureProviderId>("arxiv");
  const [innoclawBusy, setInnoClawBusy] = useState(false);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const runtime = await initializeResearchWorkspace();
      const next = runtime.listResearch();
      setRuntime(runtime);
      setGraphs(next);
      setSelectedId((current) => current && next.some((graph) => graph.researchId === current)
        ? current
        : next[0]?.researchId ?? null);
      setSelectedNodeId((current) => current && next.some((graph) => graph.nodes.some((node) => node.id === current))
        ? current
        : next[0]?.rootClaimId ?? null);
      setActiveId((current) => {
        const persisted = current && next.some((graph) => graph.researchId === current) ? current : next[0]?.researchId ?? null;
        if (persisted !== current) setActiveResearchId(persisted, researchWorkspaceKey());
        return persisted;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("research.errors.load"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedGraph = graphs.find((graph) => graph.researchId === selectedId) ?? null;
  const selectedNode = selectedGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const report = selectedGraph ? compileResearchReport(selectedGraph) : null;
  const readiness = selectedNode?.kind === "claim"
    ? report?.claims.find((claim) => claim.claimId === selectedNode.id)?.readiness ?? null
    : null;
  const activeRoleBranches = selectedGraph?.branches.filter((branch) => branch.status === "active" && branch.role) ?? [];
  const checkpointActions = selectedGraph?.nodes.filter((node): node is Extract<ResearchNode, { kind: "action" }> => (
    node.kind === "action" && (node.status === "proposed" || node.status === "approved")
  )) ?? [];

  const selectedClaimStatement = selectedNode?.kind === "claim" ? selectedNode.statement : undefined;
  useEffect(() => {
    if (selectedClaimStatement !== undefined) setClaimDraft(selectedClaimStatement);
  }, [selectedNode?.id, selectedClaimStatement]);
  const related = useMemo<Array<{ node: ResearchNode; edge: ResearchEdge; direction: "in" | "out" }>>(() => {
    if (!selectedGraph || !selectedNode) return [];
    const byId = new Map(selectedGraph.nodes.map((node) => [node.id, node]));
    const result: Array<{ node: ResearchNode; edge: ResearchEdge; direction: "in" | "out" }> = [];
    for (const edge of selectedGraph.edges) {
      if (edge.source === selectedNode.id) {
        const node = byId.get(edge.target);
        if (node) result.push({ node, edge, direction: "out" });
        continue;
      }
      if (edge.target === selectedNode.id) {
        const node = byId.get(edge.source);
        if (node) result.push({ node, edge, direction: "in" });
      }
    }
    return result;
  }, [selectedGraph, selectedNode]);

  const createResearch = () => {
    const nextTitle = title.trim();
    const nextObjective = objective.trim();
    if (!nextTitle || !nextObjective) return;
    const researchId = `research-${Date.now()}`;
    const initialized = initializeResearchWorkspace();
    void initialized.then((current) => {
      const created = current.createResearch({
        researchId,
        title: nextTitle,
        objective: nextObjective,
        modes: ["hybrid"],
        now: Date.now(),
      });
      setGraphs(current.listResearch());
      setRuntime(current);
      setSelectedId(researchId);
      setActiveId(researchId);
      setActiveResearchId(researchId, researchWorkspaceKey());
      setSelectedNodeId(created.rootClaimId);
      setTitle("");
      setObjective("");
      setShowCreate(false);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const refreshFromRuntime = (current: ResearchRuntime) => {
    const next = current.listResearch();
    setGraphs(next);
    setRuntime(current);
  };

  const selectAsActive = (researchId: string) => {
    setActiveId(researchId);
    setActiveResearchId(researchId, researchWorkspaceKey());
  };

  const startAutonomousResearch = async (researchId: string) => {
    // Resolve the graph runtime first. The path returned here is the owner of
    // the graph snapshot; every following selection, request and draft must
    // use this exact path or the first prompt can hydrate a different graph.
    await initializeResearchWorkspace();
    const workspace = researchWorkspaceKey();
    if (!workspace) {
      setError("Research workspace is not initialized.");
      return;
    }
    setActiveResearchId(researchId, workspace);
    requestResearchAutopilot(researchId, workspace);

    // reset() creates the pane that LiveSessionPage will actually render. It
    // has its own draft slot, so bind that slot explicitly before navigation;
    // binding only the legacy global draft is insufficient for tiled panes.
    useLayoutStore.getState().reset(null);
    const leafId = useLayoutStore.getState().focusedLeafId;
    if (!leafId) {
      setError("Unable to create an autonomous research conversation pane.");
      return;
    }
    await useRuntimeStore.getState().startDraftInWorkspace(workspace, draftKeyFor(leafId));
    navigate("/live");
  };

  const saveClaim = () => {
    if (!runtime || !selectedGraph || selectedNode?.kind !== "claim" || !claimDraft.trim()) return;
    try {
      runtime.replaceResearch(updateResearchClaim(selectedGraph, selectedNode.id, { statement: claimDraft.trim() }, { actor: "desktop:research-ui" }));
      refreshFromRuntime(runtime);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addNode = () => {
    if (!runtime || !selectedGraph || !nodeLabel.trim() || !nodeDetails.trim()) return;
    const now = Date.now();
    const branchId = "branch:main";
    const id = `ui:${nodeKind}:${selectedGraph.researchId}:${now}`;
    try {
      let next = selectedGraph;
      if (nodeKind === "action") {
        runtime.proposeAction(selectedGraph.researchId, {
          id,
          actionType: "challenge" satisfies ResearchActionType,
          objective: nodeDetails.trim(),
          expectedInformationGain: 0.6,
          expectedConfidenceGain: 0.3,
          cost: { normalized: 0.3 },
          risk: 0,
          reversibility: 1,
          testsClaimIds: [selectedGraph.rootClaimId],
          branchId,
        });
        next = runtime.getResearch(selectedGraph.researchId);
        if (selectedNode && selectedNode.kind === "claim") {
          next = addResearchEdge(next, { source: id, target: selectedNode.id, kind: "tests", branchId }, { actor: "desktop:research-ui" });
          runtime.replaceResearch(next);
        }
      } else if (nodeKind === "evidence") {
        const evidence = {
          id,
          kind: "evidence" as const,
          label: nodeLabel.trim(),
          branchId,
          createdAt: now,
          evidenceKind: "argument" as const,
          summary: nodeDetails.trim(),
          relation: evidenceRelation,
          strength: 0.5,
          sourceRefs: ["desktop:research-ui"],
          artifactIds: [],
          independent: false,
        };
        next = addResearchEvidence(selectedGraph, {
          evidence,
          claimId: selectedNode?.kind === "claim" && selectedNode.branchId === branchId
            ? selectedNode.id
            : selectedGraph.rootClaimId,
          relation: evidenceRelation,
          actor: "desktop:research-ui",
          at: now,
        });
        runtime.replaceResearch(next);
      } else {
        const node: ResearchNode = nodeKind === "hypothesis"
          ? { id, kind: "hypothesis", label: nodeLabel.trim(), branchId, createdAt: now, statement: nodeDetails.trim(), status: "open" }
          : nodeKind === "artifact"
            ? { id, kind: "artifact", label: nodeLabel.trim(), branchId, createdAt: now, artifactType: "report", locator: nodeDetails.trim(), contentHash: `manual:${now}` }
            : { id, kind: "counterfactual", label: nodeLabel.trim(), branchId, createdAt: now, premise: nodeDetails.trim(), predictedObservation: nodeDetails.trim(), falsifier: "A contrary observation", status: "proposed" };
        next = addResearchNode(selectedGraph, node, { actor: "desktop:research-ui", at: now });
        if (selectedNode && selectedNode.branchId === branchId) {
          const edgeKind = nodeKind === "hypothesis" ? "challenges" : nodeKind === "counterfactual" ? "tests" : "derived-from";
          next = addResearchEdge(next, { source: id, target: selectedNode.id, kind: edgeKind, branchId }, { actor: "desktop:research-ui" });
        }
        runtime.replaceResearch(next);
      }
      refreshFromRuntime(runtime);
      setSelectedNodeId(id);
      setNodeLabel("");
      setNodeDetails("");
      setShowAddNode(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runPaperStudy = async () => {
    if (!runtime || !selectedGraph || !literatureQuery.trim() || innoclawBusy) return;
    setInnoClawBusy(true);
    setError(null);
    setOperationMessage(null);
    try {
      const action = runtime.proposeAction(selectedGraph.researchId, {
        id: `action:paper-study:${literatureProvider}:${Date.now()}`,
        actionType: "retrieve",
        objective: `Paper Study: ${literatureQuery.trim()}`,
        expectedInformationGain: 0.65,
        expectedConfidenceGain: 0.3,
        cost: { normalized: 0.2 },
        risk: 0,
        reversibility: 1,
        testsClaimIds: [selectedGraph.rootClaimId],
        branchId: "branch:main",
        adapter: "innoclaw:literature-provider",
        metadata: {
          literatureQuery: literatureQuery.trim(),
          literatureProvider,
          maxResults: 10,
          evidenceRelation: "qualifies",
        },
      });
      const result = await runtime.executeAction(selectedGraph.researchId, action.id);
      refreshFromRuntime(runtime);
      const completedAction = result.research.nodes.find((node) => node.id === action.id && node.kind === "action");
      const evidenceId = result.research.nodes.find((node) => (
        node.kind === "evidence" && completedAction?.kind === "action" && completedAction.producedNodeIds.includes(node.id)
      ))?.id;
      if (evidenceId) setSelectedNodeId(evidenceId);
      setOperationMessage(result.execution.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInnoClawBusy(false);
    }
  };

  const createRoleTeam = () => {
    if (!runtime || !selectedGraph) return;
    setError(null);
    setOperationMessage(null);
    try {
      const activeRoles = new Set(activeRoleBranches.map((branch) => branch.role));
      const roles = INNOCLAW_ROLES.filter((role) => !activeRoles.has(role));
      const result = runtime.createInnoClawRoleTeam(selectedGraph.researchId, {
        roles,
        query: literatureQuery.trim() || selectedGraph.objective,
      });
      refreshFromRuntime(runtime);
      setOperationMessage(t("research.innoclaw.roleTeamCreated", { count: result.plans.length }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const mergeRoleOutputs = (branchId: string) => {
    if (!runtime || !selectedGraph) return;
    setError(null);
    setOperationMessage(null);
    try {
      const before = runtime.getResearch(selectedGraph.researchId);
      const sourceEvidenceCount = before.nodes.filter((node) => node.branchId === branchId && node.kind === "evidence").length;
      const next = runtime.mergeRoleBranchOutputs(selectedGraph.researchId, branchId, {
        targetClaimId: selectedGraph.rootClaimId,
        note: "Reviewed role outputs promoted from the InnoClaw workbench.",
      });
      refreshFromRuntime(runtime);
      const promoted = [...next.nodes].reverse().find((node) => (
        node.kind === "evidence" && node.metadata?.mergedFromBranchId === branchId
      ));
      if (promoted) setSelectedNodeId(promoted.id);
      setOperationMessage(t("research.innoclaw.branchMerged", { count: sourceEvidenceCount }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const approveCheckpoint = (actionId: string) => {
    if (!runtime || !selectedGraph) return;
    try {
      runtime.approveAction(selectedGraph.researchId, actionId, "human:desktop");
      refreshFromRuntime(runtime);
      setOperationMessage(t("research.innoclaw.actionApproved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runApprovedAction = async (actionId: string) => {
    if (!runtime || !selectedGraph || innoclawBusy) return;
    setInnoClawBusy(true);
    try {
      const action = runtime.getResearch(selectedGraph.researchId).nodes.find((node) => node.kind === "action" && node.id === actionId);
      const role = action?.kind === "action" && typeof action.metadata?.innoclawRole === "string"
        ? action.metadata.innoclawRole
        : null;
      if (role) {
        const client = getClient();
        if (!client) throw new Error(t("research.innoclaw.runtimeUnavailable"));
        const sessionId = await client.createSession(`${role}: ${selectedGraph.title}`);
        await runtime.dispatchRoleAction(
          selectedGraph.researchId,
          actionId,
          sessionId,
          async (prompt) => client.sendPrompt(sessionId, await prepareModelPrompt(prompt, { query: prompt })),
        );
        await useRuntimeStore.getState().refreshSessions();
        refreshFromRuntime(runtime);
        setOperationMessage(t("research.innoclaw.roleDispatched", { role }));
      } else {
        const result = await runtime.executeAction(selectedGraph.researchId, actionId);
        refreshFromRuntime(runtime);
        setOperationMessage(result.execution.summary);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInnoClawBusy(false);
    }
  };

  const exportInnoClawReport = async () => {
    if (!runtime || !selectedGraph) return;
    const markdown = runtime.compileInnoClawReport(selectedGraph.researchId, "desktop:cebro-innoclaw");
    await saveTextWithFeedback(`${selectedGraph.researchId}-innoclaw-report.md`, markdown, "text/markdown");
  };

  const persistContextArchive = async () => {
    if (!runtime || !selectedGraph || innoclawBusy) return;
    setInnoClawBusy(true);
    setError(null);
    try {
      const archive = buildInnoClawContextArchive(selectedGraph);
      const safeId = selectedGraph.researchId.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `research/${safeId}/innoclaw-context.json`;
      await writeWorkspaceFile(path, JSON.stringify(archive, null, 2));
      runtime.attachInnoClawContextArchive(selectedGraph.researchId, {
        locator: path,
        contentHash: archive.hash,
        sourceArtifactIds: archive.sourceArtifactIds,
        summary: `Derived retrieval index for graph ${archive.graphHash}`,
      });
      refreshFromRuntime(runtime);
      setOperationMessage(t("research.innoclaw.archiveSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInnoClawBusy(false);
    }
  };

  if (isGatewayWeb) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <GitBranch size={28} className="mx-auto mb-3 text-muted" />
          <h1 className="text-base font-semibold text-text">{t("research.title")}</h1>
          <p className="mt-1 text-sm leading-6 text-muted">{t("research.stored")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex max-h-[250px] shrink-0 flex-col border-b border-border bg-surface md:max-h-none md:w-[292px] md:border-b-0 md:border-r">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <GitBranch size={17} className="text-accent" />
          <h1 className="text-sm font-semibold text-text">{t("research.title")}</h1>
          <button
            onClick={() => setShowCreate((current) => !current)}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-input bg-accent px-2 text-[11px] font-semibold text-accent-fg hover:opacity-90"
          >
            <Plus size={13} />
            {t("research.new")}
          </button>
        </div>
        <div className="border-b border-border px-3 py-2 text-[10px] text-muted">{t("research.stored")}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {graphs.map((graph) => (
            <button
              key={graph.researchId}
              onClick={() => {
                setSelectedId(graph.researchId);
                setSelectedNodeId(graph.rootClaimId);
              }}
              className={cn(
                "mb-1 flex w-full items-start gap-2 rounded-input px-2.5 py-2 text-left transition-colors",
                graph.researchId === selectedId ? "bg-surface-2 text-text" : "text-text hover:bg-surface-2/70",
              )}
            >
              <GitBranch size={14} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{graph.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted">
                  {t("research.nodes", { count: graph.nodes.length })} · {new Date(graph.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {graph.researchId === activeId && <MessageCircle size={12} className="mt-0.5 text-ok" />}
                {graph.researchId === selectedId && <Check size={13} className="mt-0.5 text-accent" />}
              </span>
            </button>
          ))}
          {!busy && graphs.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted">{t("research.empty")}</div>
          )}
          {busy && <div className="px-3 py-8 text-center text-xs text-muted">{t("research.loading")}</div>}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2 sm:px-4">
          <div className="min-w-[180px] flex-[1_1_220px]">
            <h2 className="truncate text-sm font-semibold text-text">{selectedGraph?.title ?? t("research.select")}</h2>
            {selectedGraph && <p className="mt-0.5 truncate text-[10px] text-muted">{selectedGraph.objective}</p>}
          </div>
          {selectedGraph && (
            <label className="relative flex h-8 w-full items-center rounded-input border border-border bg-surface px-2.5 sm:w-[190px] focus-within:border-accent">
              <Search size={13} className="mr-2 shrink-0 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("research.search")}
                className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted"
              />
              {query && <button aria-label={t("research.clearSearch")} onClick={() => setQuery("")}><X size={13} className="text-muted" /></button>}
            </label>
          )}
          {selectedGraph && (
            <button
              onClick={() => selectAsActive(selectedGraph.researchId)}
              disabled={activeId === selectedGraph.researchId}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-input border px-2.5 text-xs font-medium",
                activeId === selectedGraph.researchId ? "border-ok/30 bg-ok/10 text-ok" : "border-border bg-surface text-text hover:bg-surface-2",
              )}
              title={t("research.useForChat")}
            >
              <MessageCircle size={13} />
              <span className="hidden sm:inline">{activeId === selectedGraph.researchId ? t("research.active") : t("research.useForChat")}</span>
            </button>
          )}
          {selectedGraph && (
            <button
              onClick={() => navigate("/live")}
              className="inline-flex h-8 items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 text-xs font-medium text-text hover:bg-surface-2"
              title={t("research.openChat")}
              aria-label={t("research.openChat")}
            >
              <MessageCircle size={13} />
              <span className="hidden sm:inline">{t("research.openChat")}</span>
            </button>
          )}
          {selectedGraph && (
            <button
              onClick={() => void startAutonomousResearch(selectedGraph.researchId)}
              className="inline-flex h-8 items-center gap-1.5 rounded-input bg-accent px-2.5 text-xs font-semibold text-accent-fg hover:opacity-90"
              title={t("research.startAutopilot")}
              aria-label={t("research.startAutopilot")}
            >
              <Play size={13} />
              <span className="hidden sm:inline">{t("research.autopilot")}</span>
            </button>
          )}
          {selectedGraph && (
            <button
              onClick={() => setShowInnoClaw((current) => !current)}
              aria-expanded={showInnoClaw}
              title={t("research.innoclaw.operations")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-input border px-2.5 text-xs font-medium",
                showInnoClaw ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-surface text-text hover:bg-surface-2",
              )}
            >
              <BookOpen size={13} />
              <span className="hidden sm:inline">InnoClaw</span>
            </button>
          )}
          <button
            onClick={() => void load()}
            disabled={busy}
            title={t("research.refresh")}
            aria-label={t("research.refresh")}
            className="inline-flex h-8 items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 text-xs font-medium text-text hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{t("research.refresh")}</span>
          </button>
        </header>

        {error && (
          <div className="flex shrink-0 items-start gap-2 border-b border-error/20 bg-error/10 px-4 py-2 text-xs text-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {showInnoClaw && selectedGraph && (
          <div className="shrink-0 border-b border-border bg-surface">
            <div className="grid gap-px bg-border 2xl:grid-cols-[minmax(330px,1.35fr)_minmax(260px,1fr)_minmax(260px,1fr)]">
              <section className="bg-surface px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-text">
                  <Search size={13} className="text-accent" />
                  {t("research.innoclaw.paperStudy")}
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                  <select
                    aria-label={t("research.innoclaw.provider")}
                    value={literatureProvider}
                    onChange={(event) => setLiteratureProvider(event.target.value as InnoClawLiteratureProviderId)}
                    className="h-8 rounded-input border border-border bg-bg px-2 text-[11px] text-text outline-none focus:border-accent"
                  >
                    <option value="arxiv">arXiv</option>
                    <option value="pubmed">PubMed</option>
                    <option value="semantic-scholar">Semantic Scholar</option>
                  </select>
                  <input
                    value={literatureQuery}
                    onChange={(event) => setLiteratureQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void runPaperStudy(); }}
                    placeholder={t("research.innoclaw.queryPlaceholder")}
                    className="h-8 min-w-[160px] flex-1 rounded-input border border-border bg-bg px-2.5 text-xs text-text outline-none placeholder:text-muted focus:border-accent"
                  />
                  <button
                    onClick={() => void runPaperStudy()}
                    disabled={!literatureQuery.trim() || innoclawBusy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-input bg-accent px-2.5 text-[11px] font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
                  >
                    {innoclawBusy ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
                    {t("research.innoclaw.search")}
                  </button>
                </div>
              </section>

              <section className="bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-text">
                    <Users size={13} className="text-accent" />
                    {t("research.innoclaw.roleTeam")}
                  </div>
                  <button
                    onClick={createRoleTeam}
                    disabled={INNOCLAW_ROLES.every((role) => activeRoleBranches.some((branch) => branch.role === role))}
                    title={t("research.innoclaw.createRoleTeam")}
                    className="inline-flex h-7 items-center gap-1 rounded-input border border-border bg-bg px-2 text-[10px] font-medium text-text hover:bg-surface-2 disabled:opacity-40"
                  >
                    <Plus size={11} />
                    {t("research.innoclaw.createRoleTeam")}
                  </button>
                </div>
                <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                  {activeRoleBranches.map((branch) => (
                    <div key={branch.id} className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-input border border-border bg-bg pl-2 text-[10px] text-text">
                      <GitBranch size={11} className="shrink-0 text-muted" />
                      <span className="max-w-[92px] truncate">{branch.role}</span>
                      <button
                        onClick={() => mergeRoleOutputs(branch.id)}
                        title={t("research.innoclaw.mergeToMain")}
                        aria-label={`${t("research.innoclaw.mergeToMain")}: ${branch.role}`}
                        className="inline-flex h-full w-7 shrink-0 items-center justify-center border-l border-border text-muted hover:bg-surface-2 hover:text-text"
                      >
                        <Merge size={11} />
                      </button>
                    </div>
                  ))}
                  {!activeRoleBranches.length && <span className="text-[10px] text-muted">{t("research.innoclaw.noRoleBranches")}</span>}
                </div>
              </section>

              <section className="bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-text">
                    <ShieldCheck size={13} className="text-accent" />
                    {t("research.innoclaw.checkpoints")}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void persistContextArchive()}
                      disabled={innoclawBusy}
                      title={t("research.innoclaw.archive")}
                      aria-label={t("research.innoclaw.archive")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-input border border-border bg-bg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
                    >
                      <Database size={11} />
                    </button>
                    <button
                      onClick={() => void exportInnoClawReport()}
                      title={t("research.innoclaw.exportReport")}
                      className="inline-flex h-7 items-center gap-1 rounded-input border border-border bg-bg px-2 text-[10px] font-medium text-text hover:bg-surface-2"
                    >
                      <Download size={11} />
                      {t("research.innoclaw.report")}
                    </button>
                  </div>
                </div>
                <div className="mt-2 max-h-20 space-y-1 overflow-y-auto">
                  {checkpointActions.map((action) => (
                    <div key={action.id} className="flex min-w-0 items-center gap-2 text-[10px]">
                      <span className="min-w-0 flex-1 truncate text-text" title={action.objective}>{action.objective}</span>
                      <span className="shrink-0 text-muted">{action.status}</span>
                      {action.status === "proposed" ? (
                        <button onClick={() => approveCheckpoint(action.id)} className="h-6 shrink-0 rounded-input border border-border bg-bg px-2 font-medium text-text hover:bg-surface-2">{t("research.innoclaw.approve")}</button>
                      ) : (
                        <button onClick={() => void runApprovedAction(action.id)} disabled={innoclawBusy} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-input border border-border bg-bg px-2 font-medium text-text hover:bg-surface-2 disabled:opacity-50"><Play size={10} />{t("research.innoclaw.run")}</button>
                      )}
                    </div>
                  ))}
                  {!checkpointActions.length && <span className="text-[10px] text-muted">{t("research.innoclaw.noCheckpoints")}</span>}
                </div>
              </section>
            </div>
            {operationMessage && (
              <div className="border-t border-border px-4 py-1.5 text-[10px] text-muted" role="status">{operationMessage}</div>
            )}
          </div>
        )}

        {showCreate && (
          <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
            <div className="mx-auto max-w-3xl">
              <h3 className="text-sm font-semibold text-text">{t("research.createTitle")}</h3>
              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] md:items-end">
                <label className="text-[11px] text-muted">
                  {t("research.titleLabel")}
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("research.titlePlaceholder")} className="mt-1 h-9 w-full rounded-input border border-border bg-bg px-2.5 text-xs text-text outline-none focus:border-accent" />
                </label>
                <label className="text-[11px] text-muted">
                  {t("research.objectiveLabel")}
                  <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder={t("research.objectivePlaceholder")} className="mt-1 h-9 w-full rounded-input border border-border bg-bg px-2.5 text-xs text-text outline-none focus:border-accent" />
                </label>
                <button onClick={createResearch} disabled={!title.trim() || !objective.trim()} className="h-9 rounded-input bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">{t("research.create")}</button>
              </div>
            </div>
          </div>
        )}

        {!selectedGraph ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-md">
              <GitBranch size={30} className="mx-auto mb-3 text-muted" />
              <h3 className="text-base font-semibold text-text">{graphs.length ? t("research.select") : t("research.empty")}</h3>
              <p className="mt-1 text-sm leading-6 text-muted">{graphs.length ? t("research.selectBody") : t("research.emptyBody")}</p>
              {!graphs.length && <button onClick={() => setShowCreate(true)} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-input bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90"><Plus size={14} />{t("research.new")}</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
              <Metric label={t("research.nodes", { count: selectedGraph.nodes.length })} value={String(selectedGraph.nodes.length)} />
              <Metric label={t("research.edges", { count: selectedGraph.edges.length })} value={String(selectedGraph.edges.length)} />
              <Metric label={t("research.branches", { count: selectedGraph.branches.length })} value={String(selectedGraph.branches.length)} />
              <Metric label={t("research.unresolved", { count: report?.unresolvedHypotheses.length ?? 0 })} value={String(report?.unresolvedHypotheses.length ?? 0)} />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px]">
              <div className="relative min-h-[380px] overflow-hidden bg-surface/40">
                <ResearchGraphCanvas graph={selectedGraph} selectedId={selectedNode?.id ?? null} query={query} onSelect={(node) => setSelectedNodeId(node.id)} />
                <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5">
                  {[...new Set(selectedGraph.nodes.map((node) => node.kind))].map((kind) => <span key={kind} className="rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-muted shadow-sm">{t("research.nodeKind", { kind })}</span>)}
                </div>
              </div>
              <aside className="min-h-0 overflow-y-auto border-t border-border bg-surface lg:border-l lg:border-t-0">
                <div className="border-b border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-text">{t("research.workbench")}</div>
                      <div className="mt-0.5 text-[10px] text-muted">{activeId === selectedGraph.researchId ? t("research.activeForChat") : t("research.notActive")}</div>
                    </div>
                    <button
                      onClick={() => setShowAddNode((current) => !current)}
                      className="inline-flex h-7 items-center gap-1 rounded-input bg-accent px-2 text-[11px] font-semibold text-accent-fg hover:opacity-90"
                    >
                      <Plus size={12} />
                      {t("research.addNode")}
                    </button>
                  </div>
                  {showAddNode && (
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      <label className="block text-[10px] text-muted">
                        {t("research.nodeType")}
                        <select value={nodeKind} onChange={(event) => setNodeKind(event.target.value as Exclude<ResearchNodeKind, "claim">)} className="mt-1 h-8 w-full rounded-input border border-border bg-bg px-2 text-xs text-text outline-none focus:border-accent">
                          <option value="hypothesis">{t("research.nodeKinds.hypothesis")}</option>
                          <option value="action">{t("research.nodeKinds.action")}</option>
                          <option value="evidence">{t("research.nodeKinds.evidence")}</option>
                          <option value="artifact">{t("research.nodeKinds.artifact")}</option>
                          <option value="counterfactual">{t("research.nodeKinds.counterfactual")}</option>
                        </select>
                      </label>
                      <input value={nodeLabel} onChange={(event) => setNodeLabel(event.target.value)} placeholder={t("research.nodeLabelPlaceholder")} className="h-8 w-full rounded-input border border-border bg-bg px-2 text-xs text-text outline-none focus:border-accent" />
                      <textarea value={nodeDetails} onChange={(event) => setNodeDetails(event.target.value)} placeholder={t("research.nodeDetailsPlaceholder")} rows={3} className="w-full resize-y rounded-input border border-border bg-bg px-2 py-1.5 text-xs leading-5 text-text outline-none focus:border-accent" />
                      {nodeKind === "evidence" && (
                        <select value={evidenceRelation} onChange={(event) => setEvidenceRelation(event.target.value as ResearchEvidenceRelation)} className="h-8 w-full rounded-input border border-border bg-bg px-2 text-xs text-text outline-none focus:border-accent">
                          <option value="supports">{t("research.relations.supports")}</option>
                          <option value="refutes">{t("research.relations.refutes")}</option>
                          <option value="qualifies">{t("research.relations.qualifies")}</option>
                          <option value="inconclusive">{t("research.relations.inconclusive")}</option>
                        </select>
                      )}
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setShowAddNode(false)} className="h-8 rounded-input border border-border px-2.5 text-xs text-muted hover:bg-surface-2">{t("research.cancel")}</button>
                        <button onClick={addNode} disabled={!nodeLabel.trim() || !nodeDetails.trim()} className="inline-flex h-8 items-center gap-1 rounded-input bg-accent px-2.5 text-xs font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"><Save size={12} />{t("research.save")}</button>
                      </div>
                    </div>
                  )}
                </div>
                {selectedNode ? (
                  <div className="p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted">{t("research.nodeKind", { kind: selectedNode.kind })}</div>
                        <h3 className="mt-1 break-words text-sm font-semibold text-text">{nodeHeading(selectedNode)}</h3>
                      </div>
                      {selectedNode.kind === "claim" && (readiness?.ready ? <CircleCheck size={18} className="shrink-0 text-ok" /> : <CircleAlert size={18} className="shrink-0 text-warning" />)}
                    </div>
                    <div className="mt-4 space-y-3 text-xs">
                      {selectedNode.kind === "claim" ? (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted">{t("research.statement")}</div>
                          <textarea value={claimDraft} onChange={(event) => setClaimDraft(event.target.value)} rows={4} className="mt-1 w-full resize-y rounded-input border border-border bg-bg px-2 py-1.5 text-xs leading-5 text-text outline-none focus:border-accent" />
                          <button onClick={saveClaim} disabled={!claimDraft.trim() || claimDraft.trim() === selectedNode.statement} className="mt-2 inline-flex h-7 items-center gap-1 rounded-input border border-border px-2 text-[11px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"><Pencil size={12} />{t("research.saveClaim")}</button>
                        </div>
                      ) : (
                        <Detail label={selectedNode.kind === "action" ? t("research.objective") : selectedNode.kind === "evidence" ? t("research.summary") : t("research.statement")} value={nodeDescription(selectedNode)} />
                      )}
                      <Detail label={t("research.branch")} value={selectedNode.branchId} />
                      {selectedNode.kind === "claim" && readiness && (
                        <div className="border-t border-border pt-3">
                          <div className="flex items-center justify-between text-[11px] font-medium text-text"><span>{t("research.claimReadiness")}</span><span className={readiness.ready ? "text-ok" : "text-warning"}>{readiness.ready ? t("research.ready") : t("research.blocked")}</span></div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full", readiness.ready ? "bg-ok" : "bg-warning")} style={{ width: `${Math.min(100, readiness.coverage * 100)}%` }} /></div>
                          <div className="mt-2 space-y-1 text-[10px] text-muted"><div>{t("research.coverage", { value: readiness.coverage.toFixed(2) })}</div><div>{t("research.groups", { count: readiness.independence.independentGroups })}</div></div>
                          <div className="mt-2 space-y-1">{(readiness.blockers.length ? readiness.blockers : [t("research.noBlockers")]).map((blocker) => <div key={blocker} className={cn("flex gap-1.5 text-[10px]", readiness.blockers.length ? "text-warning" : "text-muted")}><span>·</span><span>{blocker}</span></div>)}</div>
                        </div>
                      )}
                      {selectedNode.kind === "hypothesis" && selectedNode.belief && (
                        <div className="border-t border-border pt-3"><div className="text-[11px] font-medium text-text">{t("research.belief")}</div><div className="mt-1 text-muted">{t("research.posterior", { value: selectedNode.belief.posterior.toFixed(3) })}</div><div className="mt-1 text-muted">{t("research.updates", { count: selectedNode.belief.updateCount })}</div></div>
                      )}
                      <div className="border-t border-border pt-3">
                        <button
                          onClick={() => {
                            selectAsActive(selectedGraph.researchId);
                            navigate("/live");
                          }}
                          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-input bg-accent px-2.5 text-xs font-semibold text-accent-fg hover:opacity-90"
                        >
                          <MessageCircle size={13} />
                          {t("research.continueInChat")}
                        </button>
                      </div>
                      <div className="border-t border-border pt-3"><div className="text-[11px] font-medium text-text">{t("research.related")}</div>{related.length ? <div className="mt-2 space-y-1">{related.map(({ node, edge, direction }) => <button key={`${edge.id}-${node.id}`} onClick={() => setSelectedNodeId(node.id)} className="flex w-full items-center gap-1.5 rounded-input px-1.5 py-1 text-left hover:bg-surface-2"><span className="shrink-0 text-[10px] text-muted">{direction === "in" ? "←" : "→"}</span><span className="min-w-0 flex-1 truncate text-[11px] text-text">{node.label}</span><span className="shrink-0 text-[9px] text-muted">{edge.kind}</span></button>)}</div> : <div className="mt-1 text-[10px] text-muted">{t("research.noRelated")}</div>}</div>
                    </div>
                  </div>
                ) : <div className="p-4 text-center text-xs leading-5 text-muted">{t("research.selectNode")}</div>}
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-surface px-3 py-2"><div className="text-lg font-semibold text-text">{value}</div><div className="truncate text-[10px] text-muted">{label}</div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-muted">{label}</div><p className="mt-1 whitespace-pre-wrap break-words leading-5 text-text">{value}</p></div>;
}
