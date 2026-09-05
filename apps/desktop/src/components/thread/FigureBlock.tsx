import { memo, useState, type MouseEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FigureAnnotation, FigureBlock as FigureBlockT } from "@ai4s/shared";
import { saveTextWithFeedback } from "@/lib/download";

/**
 * A figure the agent produced. Click anywhere on the image to drop a numbered
 * pin and leave a note; `onComment` (when a live session backs it) forwards the
 * note to the agent. Existing pins open a popover showing their note.
 */
export const FigureBlock = memo(function FigureBlock({
  block,
  onComment,
}: {
  block: FigureBlockT;
  onComment?: (annotation: FigureAnnotation, figureTitle: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [pins, setPins] = useState<FigureAnnotation[]>(block.annotations ?? []);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");

  const onImageClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.width ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
    const y = rect.height ? ((e.clientY - rect.top) / rect.height) * 100 : 50;
    setDraft({ x: clamp(x), y: clamp(y) });
    setNote("");
  };

  const send = () => {
    if (!draft || !note.trim()) return;
    const annotation: FigureAnnotation = {
      index: pins.length + 1,
      note: note.trim(),
      x: draft.x,
      y: draft.y,
    };
    setPins((p) => [...p, annotation]);
    onComment?.(annotation, block.title);
    setDraft(null);
    setNote("");
  };

  return (
    <figure className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-text">{block.title}</span>
        <button
          className="ml-auto text-muted hover:text-text"
          aria-label={t("figure.downloadAria")}
          onClick={() => void saveTextWithFeedback(`${block.title}.svg`, imageToText(block.src), "image/svg+xml")}
        >
          <Download size={15} />
        </button>
      </div>
      <div className="relative bg-white p-4">
        {block.caption && (
          <div className="mb-2 text-center text-xs text-muted">{block.caption}</div>
        )}
        <div
          className="relative cursor-crosshair"
          onClick={onImageClick}
          role="button"
          tabIndex={0}
          aria-label={t("figure.addAnnotationAria")}
        >
          <img src={block.src} alt={block.title} className="mx-auto block max-w-full" />
        </div>

        {pins.map((a) => (
          <Popover.Root key={a.index}>
            <Popover.Trigger asChild>
              <button
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg shadow-pop ring-2 ring-white"
                style={{ left: `${a.x}%`, top: `${a.y}%` }}
                aria-label={t("figure.annotationAria", { index: a.index, note: a.note })}
              >
                {a.index}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={8}
                className="z-50 max-w-[260px] rounded-card border border-border bg-surface px-3 py-2 text-sm text-text shadow-pop"
              >
                {a.note}
                <Popover.Arrow className="fill-[var(--surface)]" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ))}

        {draft && (
          <div
            className="absolute z-50 -translate-x-1/2 translate-y-2"
            style={{ left: `${draft.x}%`, top: `${draft.y}%` }}
          >
            <div className="flex items-center gap-2 rounded-card border border-border bg-surface px-3 py-2 shadow-pop">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
                {pins.length + 1}
              </span>
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                  if (e.key === "Escape") setDraft(null);
                }}
                placeholder={t("figure.notePlaceholder")}
                className="w-44 bg-transparent text-sm text-text outline-none placeholder:text-muted"
                aria-label={t("figure.noteAria")}
              />
              <button
                className="rounded-input bg-text px-3 py-1 text-xs font-medium text-bg disabled:opacity-40"
                onClick={send}
                disabled={!note.trim()}
              >
                {t("figure.send")}
              </button>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
});

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Best-effort text for a figure download: inline SVG data URIs decode to their markup. */
function imageToText(src: string): string {
  const m = /^data:image\/svg\+xml(;base64)?,(.*)$/s.exec(src);
  if (m) return m[1] ? atob(m[2]) : decodeURIComponent(m[2]);
  return src;
}
