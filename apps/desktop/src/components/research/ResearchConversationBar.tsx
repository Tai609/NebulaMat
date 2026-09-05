import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, GitBranch, MessageCircle, Pause, Play, Plus } from "lucide-react";
import { stableHash, type ThreadBlock } from "@ai4s/shared";
import {
  consumeResearchAutopilotRequest,
  getActiveResearchId,
  getResearchAutopilotState,
  applyResearchAgentProposal,
  autopilotProposalNeedsApproval,
  researchGraphNeedsApproval,
  buildResearchAutopilotPrompt,
  getActiveResearchGraph,
  latestAgentResponse,
  parseAutopilotProposal,
  recordConversationOutput,
  setResearchAutopilotState,
  setActiveResearchId,
  subscribeResearchAutopilot,
  subscribeResearchSelection,
  type ConversationOutputKind,
} from "@/lib/researchConversation";
import { initializeResearchWorkspace, researchWorkspaceKey } from "@/lib/researchWorkspace";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

export function ResearchConversationBar({
  sessionId,
  blocks,
  working,
  onContinue,
  workspaceScope,
}: {
  sessionId: string | null;
  blocks: ThreadBlock[];
  working?: boolean;
  onContinue?: (prompt: string) => void;
  workspaceScope?: string;
}) {
  const { t } = useTranslation("graph");
  const [graphs, setGraphs] = useState<Array<{ researchId: string; title: string }>>([]);
  const [researchWorkspace, setResearchWorkspace] = useState<string | null>(workspaceScope ?? null);
  const effectiveWorkspace = workspaceScope ?? researchWorkspace ?? undefined;
  const [activeId, setActiveId] = useState<string | null>(() => getActiveResearchId(effectiveWorkspace));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ConversationOutputKind | null>(null);
  const [autopilot, setAutopilot] = useState(() => {
    const id = getActiveResearchId(effectiveWorkspace);
    return id ? getResearchAutopilotState(id, effectiveWorkspace)?.status === "running" : false;
  });
  const processedResponse = useRef<string | null>(null);
  const launchRequested = useRef(false);
  const continueRef = useRef(onContinue);
  continueRef.current = onContinue;
  const latest = latestAgentResponse(blocks);

  const syncResearchSelection = useCallback(() => {
    const id = getActiveResearchId(effectiveWorkspace);
    setActiveId(id);
    if (!id) {
      setAutopilot(false);
      return;
    }
    if (consumeResearchAutopilotRequest(id, effectiveWorkspace)) launchRequested.current = true;
    setAutopilot(getResearchAutopilotState(id, effectiveWorkspace)?.status === "running");
  }, [effectiveWorkspace]);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    void initializeResearchWorkspace().then((runtime) => {
      if (cancelled) return;
      setResearchWorkspace(researchWorkspaceKey());
      setGraphs(runtime.listResearch().map((graph) => ({ researchId: graph.researchId, title: graph.title })));
      syncResearchSelection();
    }).catch(() => {
      /* The research page owns the full error surface; the composer stays usable. */
    });
    return () => { cancelled = true; };
  }, [syncResearchSelection]);

  useEffect(() => {
    syncResearchSelection();
    return subscribeResearchSelection(syncResearchSelection);
  }, [syncResearchSelection]);

  useEffect(() => subscribeResearchAutopilot(syncResearchSelection), [syncResearchSelection]);

  useEffect(() => {
    if (launchRequested.current || !autopilot || working || !latest || !activeId || !continueRef.current || processedResponse.current === latest) return;
    const responseCursor = stableHash(latest);
    if (getResearchAutopilotState(activeId, effectiveWorkspace)?.cursor === responseCursor) return;
    const proposal = parseAutopilotProposal(latest);
    if (!proposal) {
      processedResponse.current = latest;
      setResearchAutopilotState(activeId, { status: "invalid", cursor: responseCursor, awaitingResponse: false }, effectiveWorkspace);
      setAutopilot(false);
      toast.error(t("research.autopilotInvalid"));
      return;
    }
    processedResponse.current = latest;
    setResearchAutopilotState(activeId, { status: "running", cursor: responseCursor, awaitingResponse: false }, effectiveWorkspace);
    let cancelled = false;
    void applyResearchAgentProposal(activeId, proposal, sessionId ? `session:${sessionId}` : "agent:research-autopilot", effectiveWorkspace)
      .then(async (graph) => {
        if (cancelled) return;
        if (proposal.done) {
          setResearchAutopilotState(activeId, { status: "completed", cursor: responseCursor, awaitingResponse: false, stage: proposal.nextStage, graphHash: graph.hash }, effectiveWorkspace);
          setAutopilot(false);
          toast.success(t("research.autopilotComplete"));
          return;
        }
        if (autopilotProposalNeedsApproval(proposal) || researchGraphNeedsApproval(graph)) {
          const resumeStage = proposal.stage === "execute" ? "execute" : proposal.nextStage;
          setResearchAutopilotState(activeId, { status: "approval", cursor: responseCursor, awaitingResponse: false, stage: resumeStage, graphHash: graph.hash }, effectiveWorkspace);
          setAutopilot(false);
          toast.success(t("research.autopilotApproval"));
          return;
        }
        if (proposal.stage === "execute" && graph.nodes.some((node) => node.kind === "action" && node.status === "proposed")) {
          setResearchAutopilotState(activeId, { status: "paused", cursor: responseCursor, awaitingResponse: false, stage: "execute", graphHash: graph.hash }, effectiveWorkspace);
          setAutopilot(false);
          toast.error(t("research.autopilotBlocked"));
          return;
        }
        const nextPrompt = proposal.nextPrompt?.trim() || "Continue the research loop from the updated graph.";
        setResearchAutopilotState(activeId, { status: "running", cursor: responseCursor, nextPrompt, awaitingResponse: true, stage: proposal.nextStage, graphHash: graph.hash }, effectiveWorkspace);
        continueRef.current?.(`${nextPrompt}\n\n${buildResearchAutopilotPrompt(graph, proposal.nextStage)}`);
      })
      .catch((error) => {
        if (!cancelled) {
          setResearchAutopilotState(activeId, { status: "paused", cursor: responseCursor, awaitingResponse: false }, effectiveWorkspace);
          setAutopilot(false);
          toast.error(error instanceof Error ? error.message : String(error));
        }
      });
    return () => { cancelled = true; };
  }, [activeId, autopilot, effectiveWorkspace, latest, sessionId, t, working]);

  // A request may arrive from the research page before this pane mounts. It
  // therefore launches from durable state and deliberately marks any old
  // transcript response as the cursor, so a stale answer cannot be applied as
  // the first autonomous proposal.
  useEffect(() => {
    if (!autopilot || working || !activeId || !continueRef.current || !launchRequested.current) return;
    launchRequested.current = false;
    processedResponse.current = latest;
    void getActiveResearchGraph(effectiveWorkspace).then((graph) => {
      if (!graph || !continueRef.current) {
        setResearchAutopilotState(activeId, { status: "paused", awaitingResponse: false }, effectiveWorkspace);
        setAutopilot(false);
        toast.error(t("research.autopilotNoGraph"));
        return;
      }
      const savedState = getResearchAutopilotState(activeId, effectiveWorkspace);
      const stage = savedState?.graphHash ? savedState.stage : "inspect";
      setResearchAutopilotState(activeId, {
        status: "running",
        cursor: latest ? stableHash(latest) : undefined,
        awaitingResponse: true,
        stage,
        graphHash: graph.hash,
      }, effectiveWorkspace);
      continueRef.current(buildResearchAutopilotPrompt(graph, stage));
    }).catch((error) => {
      setResearchAutopilotState(activeId, { status: "paused", awaitingResponse: false }, effectiveWorkspace);
      setAutopilot(false);
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }, [activeId, autopilot, effectiveWorkspace, latest, t, working]);

  const toggleAutopilot = async () => {
    const next = !autopilot;
    setAutopilot(next);
    if (!next) {
      if (activeId) setResearchAutopilotState(activeId, { status: "paused", awaitingResponse: false }, effectiveWorkspace);
      return;
    }
    if (!onContinue) return;
    launchRequested.current = true;
    if (working) return;
    processedResponse.current = latest;
  };

  if (!isTauri) return null;
  const active = graphs.find((graph) => graph.researchId === activeId);
  const record = async (kind: ConversationOutputKind) => {
    if (!activeId || !latest || busy) return;
    setBusy(true);
    setSaved(null);
    try {
      await recordConversationOutput({ researchId: activeId, kind, text: latest, sessionId });
      setSaved(kind);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-input border border-border bg-surface/90 px-2.5 py-1.5 text-[11px] shadow-sm">
      <GitBranch size={13} className={cn("shrink-0", active ? "text-accent" : "text-muted")} />
      <select
        value={activeId ?? ""}
        onChange={(event) => setActiveResearchId(event.target.value || null, effectiveWorkspace)}
        className="min-w-0 flex-1 truncate bg-transparent text-xs text-text outline-none"
        aria-label={t("research.selectActive")}
      >
        <option value="">{t("research.noActive")}</option>
        {graphs.map((graph) => <option key={graph.researchId} value={graph.researchId}>{graph.title}</option>)}
      </select>
      {active && <span className="hidden shrink-0 text-[10px] text-ok sm:inline">{t("research.active")}</span>}
      {active && onContinue && (
        <button
          onClick={() => void toggleAutopilot()}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-input border px-2 text-[10px] font-medium",
            autopilot ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-text hover:bg-surface-2",
          )}
          title={autopilot ? t("research.pauseAutopilot") : t("research.startAutopilot")}
          aria-label={autopilot ? t("research.pauseAutopilot") : t("research.startAutopilot")}
        >
          {autopilot ? <Pause size={11} /> : <Play size={11} />}
          <span className="hidden sm:inline">{autopilot ? t("research.autopilotOn") : t("research.autopilot")}</span>
        </button>
      )}
      {latest && active && !working && (
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen((value) => !value)}
            disabled={busy}
            className="inline-flex h-6 items-center gap-1 rounded-input border border-border px-2 text-[10px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
            title={t("research.recordAnswer")}
          >
            {saved ? <Check size={11} className="text-ok" /> : <Plus size={11} />}
            <span className="hidden sm:inline">{saved ? t("research.recorded") : t("research.recordAnswer")}</span>
          </button>
          {open && (
            <div className="absolute bottom-full right-0 z-30 mb-1 min-w-[170px] rounded-card border border-border bg-surface p-1 shadow-pop">
              <div className="px-2 py-1 text-[10px] text-muted">{t("research.recordAs")}</div>
              {/* eslint-disable-next-line i18next/no-literal-string -- graph node kind identifiers */}
              {(["evidence", "hypothesis", "action", "artifact"] as ConversationOutputKind[]).map((kind) => (
                <button key={kind} onClick={() => void record(kind)} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-xs text-text hover:bg-surface-2">
                  <MessageCircle size={11} className="text-muted" />
                  {t(`research.nodeKinds.${kind}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
