import { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseQCode, segmentsFor, type QCodeParsed } from "@/lib/qcode";
import { cn } from "@/lib/cn";

/**
 * Qualitative-coding two-way traceback viewer (P1-3, social science). Renders
 * source documents with coded spans highlighted, alongside the codebook; click
 * a code to isolate its spans, hover a span to see its codes. Every highlight is
 * an exact character span sliced from the source — a code can never surface an
 * invented quote (the decisive social-science integrity property, see P1-6).
 */

const SERIES = 8; // --series-1..8

function colorFor(doc: QCodeParsed, name: string): string {
  const c = doc.codes.find((x) => x.name === name);
  if (c?.color) return c.color;
  const i = doc.codes.findIndex((x) => x.name === name);
  return `var(--series-${(Math.max(0, i) % SERIES) + 1})`;
}

export function QCodeView({ filename, text }: { filename: string; text: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const parsed = useMemo<{ doc: QCodeParsed | null; error: string | null }>(() => {
    try {
      return { doc: parseQCode(text), error: null };
    } catch (e) {
      return { doc: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  const [active, setActive] = useState<string | null>(null); // selected code
  const [hoverSeg, setHoverSeg] = useState<{ codes: string[]; text: string } | null>(null);

  if (parsed.error || !parsed.doc) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-sm items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>{t("qcode.readError", { error: parsed.error ?? t("qcode.unknownFormat") })}</span>
        </div>
      </div>
    );
  }
  const doc = parsed.doc;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {filename} · {t("qcode.sourceCount", { count: doc.sources.length })} ·{" "}
          {t("qcode.codeCount", { count: doc.codes.length })}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-ok" title={t("qcode.exactSpansTitle")}>
          <ShieldCheck size={13} /> {t("qcode.exactSpansBadge")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Codebook */}
        <div className="w-52 shrink-0 overflow-y-auto border-r border-border p-2">
          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
            {t("qcode.codebookHeading")}
          </div>
          {doc.codes.map((c) => {
            const n = doc.countByCode[c.name] ?? 0;
            const on = active === c.name;
            return (
              <button
                key={c.name}
                onClick={() => setActive(on ? null : c.name)}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                  on ? "bg-surface-2 ring-1 ring-border" : "hover:bg-surface-2/60",
                )}
                title={c.description}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: colorFor(doc, c.name) }}
                />
                <span className="min-w-0 flex-1 truncate text-text">{c.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted">{n}</span>
              </button>
            );
          })}
          {active && (
            <button
              onClick={() => setActive(null)}
              className="mt-1 w-full rounded-md px-2 py-1 text-[11px] text-muted hover:text-text"
            >
              {t("qcode.clearFilter")}
            </button>
          )}
        </div>

        {/* Sources with highlighted spans */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {doc.warnings.length > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-card border border-warn/30 bg-warn/10 p-2 text-[12px] text-muted">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
              <div>
                {t("qcode.warningsCount", { count: doc.warnings.length })}
                <ul className="mt-1 list-inside list-disc">
                  {doc.warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {doc.sources.map((s) => (
            <div key={s.id} className="mb-5">
              <div className="mb-1.5 text-[12px] font-medium text-text">{s.title ?? s.id}</div>
              <p className="whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-text">
                {segmentsFor(doc, s.id).map((seg, i) => {
                  if (seg.codes.length === 0) return <span key={i}>{seg.text}</span>;
                  const dim = active !== null && !seg.codes.includes(active);
                  const paint = active && seg.codes.includes(active) ? active : seg.codes[0];
                  return (
                    <mark
                      key={i}
                      onMouseEnter={() => setHoverSeg({ codes: seg.codes, text: seg.text })}
                      onMouseLeave={() => setHoverSeg(null)}
                      className="rounded-[3px] px-0.5 transition-opacity"
                      style={{
                        backgroundColor: colorFor(doc, paint),
                        color: "#fff",
                        opacity: dim ? 0.2 : 0.9,
                      }}
                    >
                      {seg.text}
                    </mark>
                  );
                })}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-3 py-2 font-mono text-[11px] text-muted">
        {hoverSeg ? (
          <span>
            <span className="text-text">“{hoverSeg.text}”</span> → {hoverSeg.codes.join(", ")}
          </span>
        ) : (
          <span className="text-muted/50">{t("qcode.hoverDefaultHint")}</span>
        )}
      </div>
    </div>
  );
}
