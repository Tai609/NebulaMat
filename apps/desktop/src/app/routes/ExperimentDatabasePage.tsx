import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Beaker,
  Bot,
  CalendarDays,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { useRuntimeStore } from "@/lib/runtime";
import { useUiStore } from "@/lib/store";
import {
  experimentDatabaseStatus,
  listExperiments,
  pickExperimentFiles,
  removeExperimentRecord,
  setExperimentArchived,
  syncExperimentInbox,
  updateExperiment,
  type ExperimentDatabaseStatus,
  type ExperimentRecord,
} from "@/lib/tauri";
import { isTauri } from "@/lib/tauri";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function csv(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function normalizationPrompt(record: ExperimentRecord) {
  const safeType = record.experimentType === "待规范化" ? "待识别" : record.experimentType;
  return [
    "请以实验记录模式规范化这条已归档的原始实验记录。",
    "",
    `实验 ID：${record.id}`,
    `原始附件目录：${record.rawDir}`,
    `当前实验类型：${safeType}`,
    `数据库回执：.openscience/experiment-inbox/${record.id}.json`,
    `标准 Markdown 目标：wiki/实验日志/${record.systemCode}/${safeType}/${record.id}.md`,
    "",
    "逐个读取原始附件，抽取样品、设备、方法、参数、观测、结果、异常和结论。原始事实、解释与待确认项必须分开；不得猜测缺失字段，不得覆盖或移动原始附件。",
    "先生成带 YAML frontmatter 的规范化 Markdown，再生成数据库回执 JSON。回执必须包含 exp_id、standardized_path、missing_fields 和 metadata，并只引用上面的原始附件目录。完成后提醒用户返回实验数据库点击同步。",
  ].join("\n");
}

export function ExperimentDatabasePage() {
  const { t } = useTranslation("pages");
  const navigate = useNavigate();
  const startDraft = useRuntimeStore((state) => state.startDraft);
  const setResearchAssistantMode = useRuntimeStore((state) => state.setResearchAssistantMode);
  const setComposerDraft = useUiStore((state) => state.setComposerDraft);
  const [records, setRecords] = useState<ExperimentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExperimentRecord | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ExperimentDatabaseStatus | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ExperimentRecord | null>(null);
  const [upload, setUpload] = useState({
    title: "",
    date: today(),
    systemCode: "EXP",
    deviceCode: "B",
  });

  const refresh = async (sync = false) => {
    setLoading(true);
    setError(null);
    try {
      if (sync) await syncExperimentInbox();
      const [next, db] = await Promise.all([
        listExperiments("", true),
        experimentDatabaseStatus(),
      ]);
      setRecords(next);
      setStatus(db);
      setSelectedId((current) =>
        current && next.some((record) => record.id === current)
          ? current
          : next.find((record) => !record.archived)?.id ?? next[0]?.id ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(true);
  }, []);

  useEffect(() => {
    const selected = records.find((record) => record.id === selectedId) ?? null;
    setDraft(selected ? structuredClone(selected) : null);
  }, [records, selectedId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter((record) => {
      if (!showArchived && record.archived) return false;
      if (!needle) return true;
      return [record.id, record.title, record.summary, record.experimentType, ...record.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [query, records, showArchived]);

  const handleUpload = async () => {
    if (!upload.date || busy) return;
    setBusy("upload");
    setError(null);
    try {
      const record = await pickExperimentFiles(upload);
      if (!record) return;
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setSelectedId(record.id);
      setUpload((current) => ({ ...current, title: "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft || busy) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await updateExperiment(draft);
      setRecords((current) => current.map((item) => item.id === saved.id ? saved : item));
      setDraft(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggleArchived = async (record: ExperimentRecord) => {
    setBusy("archive");
    try {
      const saved = await setExperimentArchived(record.id, !record.archived);
      setRecords((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const normalize = (record: ExperimentRecord) => {
    startDraft();
    setResearchAssistantMode("experiment-log");
    setComposerDraft(normalizationPrompt(record));
    navigate("/live");
  };

  const confirmDelete = async () => {
    const record = pendingDelete;
    setPendingDelete(null);
    if (!record) return;
    setBusy("delete");
    try {
      await removeExperimentRecord(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (selectedId === record.id) setSelectedId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full max-w-[1580px] flex-col px-5 pb-10 pt-5 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              <Database size={14} />
              {t("experiments.eyebrow")}
            </div>
            <h1 className="mt-2 font-serif text-[30px] leading-tight text-text">{t("experiments.title")}</h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{t("experiments.description")}</p>
          </div>
          <button
            onClick={() => void refresh(true)}
            disabled={loading}
            className="flex items-center gap-2 rounded-input border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {t("experiments.sync")}
          </button>
        </header>

        {error && <div className="mt-4 rounded-input border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

        <section className="mt-5 grid gap-3 rounded-card border border-border bg-surface p-4 lg:grid-cols-[1.35fr_0.8fr_0.8fr_0.7fr_auto]">
          <label className="text-xs text-muted">
            {t("experiments.upload.title")}
            <input
              value={upload.title}
              onChange={(event) => setUpload((current) => ({ ...current, title: event.target.value }))}
              placeholder={t("experiments.upload.titlePlaceholder")}
              className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
          </label>
          <label className="text-xs text-muted">
            {t("experiments.fields.date")}
            <input type="date" value={upload.date} onChange={(event) => setUpload((current) => ({ ...current, date: event.target.value }))} className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            {t("experiments.fields.system")}
            <input value={upload.systemCode} onChange={(event) => setUpload((current) => ({ ...current, systemCode: event.target.value }))} className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            {t("experiments.fields.device")}
            <input value={upload.deviceCode} onChange={(event) => setUpload((current) => ({ ...current, deviceCode: event.target.value }))} className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent" />
          </label>
          <button
            onClick={() => void handleUpload()}
            disabled={!isTauri || busy === "upload"}
            title={!isTauri ? t("experiments.desktopOnly") : undefined}
            className="mt-5 flex h-9 items-center justify-center gap-2 rounded-input bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {t("experiments.upload.action")}
          </button>
        </section>

        <div className="mt-4 grid min-h-[560px] flex-1 gap-4 lg:grid-cols-[minmax(300px,0.78fr)_minmax(460px,1.55fr)]">
          <section className="flex min-h-0 flex-col rounded-card border border-border bg-surface">
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-2.5 text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("experiments.search")} className="w-full rounded-input border border-border bg-bg py-2 pl-9 pr-3 text-sm text-text outline-none focus:border-accent" />
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                {t("experiments.showArchived")}
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="flex justify-center py-16 text-muted"><Loader2 className="animate-spin" /></div>
              ) : visible.length === 0 ? (
                <div className="px-5 py-16 text-center text-sm text-muted"><Beaker size={26} className="mx-auto mb-3 opacity-50" />{t("experiments.empty")}</div>
              ) : visible.map((record) => (
                <button key={record.id} onClick={() => setSelectedId(record.id)} className={cn("mb-1 w-full rounded-input border px-3 py-3 text-left transition-colors", selectedId === record.id ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-surface-2")}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="truncate text-sm font-medium text-text">{record.title}</span>
                    {record.anomaly && <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-medium text-error">{t("experiments.anomaly")}</span>}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-accent">{record.id}</div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted"><span>{record.date}</span><span>{record.experimentType}</span>{record.archived && <span>{t("experiments.archived")}</span>}</div>
                </button>
              ))}
            </div>
            <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
              {status ? t("experiments.total", { count: status.total }) : t("experiments.localFirst")}
            </div>
          </section>

          <section className="min-h-0 rounded-card border border-border bg-surface p-5">
            {!draft ? (
              <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted">{t("experiments.selectPrompt")}</div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <div className="font-mono text-xs text-accent">{draft.id}</div>
                    <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 w-full min-w-[280px] border-0 bg-transparent p-0 font-serif text-2xl text-text outline-none" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => normalize(draft)} className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"><Bot size={14} />{t("experiments.actions.normalize")}</button>
                    <button onClick={() => void save()} disabled={busy === "save"} className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"><Save size={14} />{t("experiments.actions.save")}</button>
                    <button onClick={() => void toggleArchived(draft)} className="rounded-input border border-border p-1.5 text-muted hover:bg-surface-2 hover:text-text" title={draft.archived ? t("experiments.actions.restore") : t("experiments.actions.archive")}>{draft.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
                    <button onClick={() => setPendingDelete(draft)} className="rounded-input border border-error/30 p-1.5 text-error hover:bg-error/10" title={t("experiments.actions.delete")}><Trash2 size={14} /></button>
                  </div>
                </div>

                <div className="grid gap-4 py-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label={t("experiments.fields.date")} icon={<CalendarDays size={13} />}><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                  <Field label={t("experiments.fields.system")}><input value={draft.systemCode} onChange={(event) => setDraft({ ...draft, systemCode: event.target.value })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                  <Field label={t("experiments.fields.device")}><input value={draft.deviceCode} onChange={(event) => setDraft({ ...draft, deviceCode: event.target.value })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                  <Field label={t("experiments.fields.type")}><input value={draft.experimentType} onChange={(event) => setDraft({ ...draft, experimentType: event.target.value })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                  <Field label={t("experiments.fields.batch")}><input value={draft.sampleBatch ?? ""} onChange={(event) => setDraft({ ...draft, sampleBatch: event.target.value || null })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                  <Field label={t("experiments.fields.status")}><input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                  <Field label={t("experiments.fields.tags")} className="sm:col-span-2"><input value={draft.tags.join(", ")} onChange={(event) => setDraft({ ...draft, tags: csv(event.target.value) })} className="mt-1 w-full rounded-input border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent" /></Field>
                </div>

                <div className="grid flex-1 gap-4 xl:grid-cols-2">
                  <TextArea label={t("experiments.fields.purpose")} value={draft.purpose} onChange={(value) => setDraft({ ...draft, purpose: value })} />
                  <TextArea label={t("experiments.fields.summary")} value={draft.summary} onChange={(value) => setDraft({ ...draft, summary: value })} />
                  <TextArea label={t("experiments.fields.conclusion")} value={draft.conclusion} onChange={(value) => setDraft({ ...draft, conclusion: value })} />
                  <div className="rounded-input border border-border bg-bg p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-text"><FileText size={14} />{t("experiments.attachments", { count: draft.sourceFiles.length })}</div>
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] text-muted">{draft.sourceFiles.map((path) => { const parts = path.split(/[\\/]/); return <div key={path} className="truncate" title={path}>{parts[parts.length - 1]}</div>; })}</div>
                    {draft.missingFields.length > 0 && <div className="mt-3 border-t border-border pt-2 text-xs text-warning">{t("experiments.missing", { fields: draft.missingFields.join(", ") })}</div>}
                    <label className="mt-3 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={draft.anomaly} onChange={(event) => setDraft({ ...draft, anomaly: event.target.checked })} />{t("experiments.fields.anomaly")}</label>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {pendingDelete && <ConfirmDialog title={t("experiments.delete.title")} body={t("experiments.delete.body")} confirmLabel={t("experiments.actions.delete")} onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)} />}
    </div>
  );
}

function Field({ label, icon, className, children }: { label: string; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <label className={cn("text-xs text-muted", className)}><span className="flex items-center gap-1.5">{icon}{label}</span>{children}</label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs text-muted">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="mt-1 w-full resize-y rounded-input border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-accent" /></label>;
}
