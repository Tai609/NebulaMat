import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, MessageSquare, Package, RotateCcw, Terminal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ProvenanceRecord, RunRecord } from "@ai4s/shared";
import { listProvenance, readEnvLockfile } from "@/lib/provenance";
import { listRuns, reproduceRunPrompt } from "@/lib/runs";
import { useUiStore } from "@/lib/store";
import { CodeViewer } from "@/components/code-viewer/CodeViewer";
import { DiffView } from "@/components/code-viewer/DiffView";
import { cn } from "@/lib/cn";
import i18n from "@/i18n";

/** The prompt the Reproduce action drafts — prefilled, reviewed, user-sent. */
export function reproducePrompt(r: ProvenanceRecord): string {
  const pkgs = r.env?.packages;
  const pkgNote = pkgs
    ? ` The environment had ${pkgs.count} installed Python packages, listed in \`.openscience/env/${pkgs.hash}.txt\` — if the regenerated result differs, install matching versions from that lockfile and re-run.`
    : "";
  const env = r.env
    ? ` It was produced with${r.env.python ? ` Python ${r.env.python} on` : ""} ${r.env.platform}.${pkgNote}`
    : "";
  const content = r.content ?? "";
  // A fence longer than any backtick run in the content, so embedded ``` in
  // the recorded code (e.g. a generated report.md) cannot close it early.
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  // Records are capped at 100 KB (provenance.rs cap_content) — a truncated
  // record is not runnable, so tell the agent where the full code lives.
  const truncNote = content.endsWith("[truncated]")
    ? " NOTE: the recorded code below is truncated at the store's size cap — read the full " +
      `record for \`${r.path}\` from \`.openscience/provenance.jsonl\` before re-running.`
    : "";
  return (
    `Reproduce \`${r.path}\` (provenance v${r.version}).${env} ` +
    `Re-run its recorded generating code below, then compare the regenerated file ` +
    `with the current \`${r.path}\` and report whether they match — and what changed if not.` +
    `${truncNote}\n\n${fence}\n${content}\n${fence}`
  );
}

function longestBacktickRun(text: string): number {
  let max = 0;
  for (const run of text.match(/`+/g) ?? []) max = Math.max(max, run.length);
  return max;
}

/**
 * The provenance History of one artifact: every recorded version with the code
 * that produced it, the tool, the model, and a link back to the originating
 * conversation. Data comes from `.openscience/provenance.jsonl` (P0-3).
 */
export function ProvenancePanel({ path, language }: { path: string; language?: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const [records, setRecords] = useState<ProvenanceRecord[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Runs a version can be produced by, keyed by runId — links a file to its recipe.
  const [runsById, setRunsById] = useState<Map<string, RunRecord>>(new Map());
  // The package lockfile currently shown, keyed by its content hash.
  const [lockfile, setLockfile] = useState<{ hash: string; text: string | null } | null>(null);
  const navigate = useNavigate();
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);

  // Toggle the pip-freeze lockfile for a snapshot hash; loads it lazily on open.
  const toggleLockfile = (hash: string) => {
    if (lockfile?.hash === hash) {
      setLockfile(null);
      return;
    }
    setLockfile({ hash, text: null });
    void readEnvLockfile(hash).then((text) =>
      setLockfile((cur) => (cur?.hash === hash ? { hash, text: text ?? "(lockfile unavailable)" } : cur)),
    );
  };

  // Draft a reproduce prompt into the conversation the version came from — the
  // user reviews and sends it (human in the loop, never auto-run). For a file
  // produced by a run, reproduce the RUN (re-run its command, compare outputs);
  // for an authored file, reproduce its recorded code.
  const reproduce = (r: ProvenanceRecord) => {
    const run = r.runId ? runsById.get(r.runId) : undefined;
    setComposerDraft(run ? reproduceRunPrompt(run) : reproducePrompt(r));
    navigate(r.sessionId ? `/live/${r.sessionId}` : "/live");
  };

  useEffect(() => {
    let cancelled = false;
    setRecords(null);
    void listProvenance(path).then((r) => {
      if (cancelled) return;
      setRecords([...r].reverse()); // newest first
      setExpanded(r.length > 0 ? r[r.length - 1].version : null);
      // Load the runs any of these versions were produced by, for the recipe.
      if (r.some((rec) => rec.runId)) {
        void listRuns().then((runs) => {
          if (cancelled) return;
          setRunsById(new Map(runs.map((run) => [run.runId, run])));
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (records === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> {t("provenance.loadingHistory")}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="p-4 text-sm text-muted">
        {t("provenance.emptyPrefix")}{" "}
        <span className="font-mono text-text">{path}</span>
        {t("provenance.emptySuffix")}
      </div>
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {records.map((r) => {
        const open = expanded === r.version;
        return (
          <li key={r.version} className="rounded-input border border-border bg-surface">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              onClick={() => setExpanded(open ? null : r.version)}
              aria-expanded={open}
            >
              {open ? (
                <ChevronDown size={14} className="shrink-0 text-muted" />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-muted" />
              )}
              {/* eslint-disable-next-line i18next/no-literal-string -- "v" version-number prefix, not prose */}
              <span className="rounded bg-surface-2 px-1.5 text-xs font-medium text-text">
                v{r.version}
              </span>
              <span className="font-mono text-xs text-muted">{r.tool}</span>
              <span className="flex-1" />
              <span className="text-xs text-muted">{formatTs(r.ts)}</span>
            </button>
            {open && (
              <div className="space-y-2 border-t border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {r.model && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{r.model}</span>
                  )}
                  {r.env && (
                    <span
                      className="rounded bg-surface-2 px-1.5 py-0.5 font-mono"
                      title={t("provenance.envTitle")}
                    >
                      {[r.env.python && `py ${r.env.python}`, r.env.platform, `app ${r.env.app}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {r.env?.packages && (
                    <button
                      className={cn(
                        "flex items-center gap-1 rounded px-1.5 py-0.5 font-mono hover:bg-surface-2 hover:text-text",
                        lockfile?.hash === r.env.packages.hash && "bg-surface-2 text-text",
                      )}
                      onClick={() => toggleLockfile(r.env!.packages!.hash)}
                      title={t("provenance.lockfileTitle")}
                      aria-pressed={lockfile?.hash === r.env.packages.hash}
                    >
                      <Package size={11} /> {t("provenance.packageCount", { count: r.env.packages.count })}
                    </button>
                  )}
                  {r.log && <span className="truncate">{r.log}</span>}
                  <span className="flex-1" />
                  {(r.content || (r.runId && runsById.has(r.runId))) && (
                    <button
                      className="flex items-center gap-1 text-link hover:underline"
                      onClick={() => reproduce(r)}
                      title={
                        r.runId
                          ? t("provenance.reproduceRunTitle")
                          : t("provenance.reproduceVersionTitle")
                      }
                    >
                      <RotateCcw size={12} /> {t("provenance.reproduce")}
                    </button>
                  )}
                  {r.sessionId && (
                    <button
                      className="flex items-center gap-1 text-link hover:underline"
                      onClick={() => navigate(`/live/${r.sessionId}`)}
                      title={t("provenance.openConversationTitle")}
                    >
                      <MessageSquare size={12} /> {t("provenance.openConversation")}
                    </button>
                  )}
                </div>
                {r.env?.packages && lockfile?.hash === r.env.packages.hash && (
                  <div className="rounded-input border border-border bg-surface-2">
                    <div className="border-b border-border px-2.5 py-1 text-[11px] text-muted">
                      {t("provenance.pipFreezePrefix")}{t("provenance.packageCount", { count: r.env.packages.count })}
                    </div>
                    {lockfile.text === null ? (
                      <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted">
                        <Loader2 size={12} className="animate-spin" /> {t("provenance.loadingLockfile")}
                      </div>
                    ) : (
                      <pre className="max-h-48 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text">
                        {lockfile.text}
                      </pre>
                    )}
                  </div>
                )}
                {r.content ? (
                  <CodeViewer code={r.content} language={language} />
                ) : r.diff ? (
                  <DiffView diff={r.diff} className="max-h-80 overflow-y-auto" />
                ) : r.runId ? (
                  <div className="flex items-start gap-2 rounded-input border border-border bg-surface-2 px-2.5 py-2 text-xs text-muted">
                    <Terminal size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {t("provenance.producedByRunPrefix")}{" "}
                      <button
                        className="font-mono text-link hover:underline"
                        onClick={() => navigate(`/runs?run=${r.runId}`)}
                        title={t("provenance.openRunTitle")}
                      >
                        {r.runId}
                      </button>
                      {runsById.get(r.runId) && (
                        <>
                          {t("provenance.commandSeparator")}
                          <span className="font-mono text-text">{runsById.get(r.runId)!.command}</span>
                        </>
                      )}
                      {t("provenance.producedByRunSuffix")}
                    </span>
                  </div>
                ) : (
                  <div className={cn("text-xs text-muted")}>
                    {t("provenance.contentNotCaptured")}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString(i18n.language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
