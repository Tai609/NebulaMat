// Inline previews for Office formats, rendered locally (no conversion service):
// docx via docx-preview (HTML), xlsx via SheetJS sheet_to_html (merged cells
// kept), pptx via pptx-preview (inline-styled slide list). Each renderer is
// dynamic-imported so the heavy libraries stay out of the main bundle.
//
// Everything renders inside a Shadow DOM: document content expects plain
// black-on-white browser defaults, and outside it the app's Tailwind preflight
// resets (lists, margins, img sizing) plus the theme's inherited font/colors
// (light text in dark mode) wreck the layout. The shadow root blocks the
// stylesheets; the base style below resets what still inherits.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useScrollMemory } from "@/lib/scrollMemory";
import type { SheetHtml } from "@/lib/xlsx";

/** Document-neutral canvas: black text, CJK-aware fonts, light gray backdrop. */
const BASE_CSS = `
  :host { display: block; height: 100%; }
  .page {
    min-height: 100%;
    background: #ececec;
    color: #000;
    font-family: -apple-system, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: normal;
  }
`;

/** One shadow-isolated container the imperative renderers can append into.
 *  Callback ref, not useRef+useEffect: some views mount the host div late
 *  (after their data loads), and an effect keyed on css would never see it. */
function useShadowPage(extraCss = "") {
  const [page, setPage] = useState<HTMLElement | null>(null);
  const hostRef = useCallback(
    (host: HTMLDivElement | null) => {
      if (!host) {
        setPage(null);
        return;
      }
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      shadow.replaceChildren();
      const style = document.createElement("style");
      style.textContent = BASE_CSS + extraCss;
      const div = document.createElement("div");
      div.className = "page";
      shadow.append(style, div);
      setPage(div);
    },
    [extraCss],
  );
  return { hostRef, page };
}

function RenderState({ error, loading }: { error: string | null; loading: boolean }) {
  const { t } = useTranslation(["inspector", "common"]);
  if (error) return <div className="p-4 text-sm text-muted">{error}</div>;
  if (loading)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> {t("office.rendering")}
      </div>
    );
  return null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DocxView({ bytes, scrollKey }: { bytes: ArrayBuffer; scrollKey: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const { hostRef, page } = useShadowPage();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Reading position, restored when the same document is reopened.
  const onScroll = useScrollMemory(wrapRef, scrollKey, !loading);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    let observer: ResizeObserver | undefined;

    // A docx page has a fixed physical width (e.g. Letter = 816px); a portrait
    // or landscape page is usually wider than the inspector pane, so it would
    // overflow with both edges cut off. Scale the whole page down to fit the
    // pane width (never up) via `zoom`, which shrinks the layout box too — so
    // there's no leftover scroll area. Re-fit when the pane resizes.
    const fit = () => {
      const wrapper = page.querySelector<HTMLElement>(".docx-wrapper");
      const section = wrapper?.querySelector<HTMLElement>("section");
      const avail = wrapRef.current?.clientWidth;
      if (!wrapper || !section || !avail) return;
      const pageWidth = section.offsetWidth + 40; // section + wrapper padding
      wrapper.style.zoom = String(Math.min(1, avail / pageWidth));
    };

    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        // Styles go to the same shadow container, so the library's own page
        // chrome (white sheet on gray) applies untouched by app CSS.
        await renderAsync(bytes, page, page, { inWrapper: true });
        if (cancelled) return;
        fit();
        if (wrapRef.current) {
          observer = new ResizeObserver(fit);
          observer.observe(wrapRef.current);
        }
      } catch (e) {
        if (!cancelled) setError(t("office.docxRenderError", { message: message(e) }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      page.replaceChildren();
    };
    // `t` intentionally excluded: this effect renders the document, not a UI
    // label; it shouldn't re-render the whole doc just because the locale changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, page]);

  return (
    <div ref={wrapRef} onScroll={onScroll} className="h-full overflow-auto">
      <RenderState error={error} loading={loading} />
      <div ref={hostRef} />
    </div>
  );
}

// Cells carry their own inline styles (fill/color/size/border) from the
// workbook; this is just the neutral scaffold — a faint default gridline (Excel
// shows one) that any real cell border overrides, plus fixed table layout so
// the <col> widths are honored.
const SHEET_CSS = `
  /* width:max-content so the page grows to the table's full width — otherwise a
     block-level .page stays viewport-wide and its white background stops mid-way,
     making cells without a fill turn a different color when scrolled right. */
  .page { padding: 12px; background: #fff; width: max-content; min-width: 100%; }
  table { border-collapse: collapse; table-layout: fixed; font-size: 12.5px; color: #1a1814; }
  td { border: 1px solid #ece7e0; padding: 3px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

export function XlsxView({ bytes, scrollKey }: { bytes: ArrayBuffer; scrollKey: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const { hostRef, page } = useShadowPage(SHEET_CSS);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<SheetHtml[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Dynamic import keeps ExcelJS in a lazy chunk, out of the main bundle.
        const { workbookSheets } = await import("@/lib/xlsx");
        const parsed = await workbookSheets(bytes);
        if (cancelled) return;
        setSheets(parsed);
        setActive(0);
      } catch (e) {
        if (!cancelled) setError(t("office.xlsxReadError", { message: message(e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` intentionally excluded, same reasoning as DocxView above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  const sheet = sheets?.[Math.min(active, sheets.length - 1)];
  // Layout effect (in this hook order): the sheet HTML must be in the DOM
  // before the scroll restore below runs, or the offset would clamp to 0.
  useLayoutEffect(() => {
    if (page && sheet) page.innerHTML = sheet.html; // cell text is escaped by SheetJS
  }, [page, sheet]);
  const onScroll = useScrollMemory(wrapRef, scrollKey, !!(page && sheet));

  if (error || !sheets) return <RenderState error={error} loading={!sheets} />;
  if (sheets.length === 0) return <div className="p-4 text-sm text-muted">{t("office.noSheets")}</div>;
  return (
    <div className="flex h-full flex-col">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActive(i)}
              className={cn(
                "rounded px-2 py-1 text-xs",
                i === active ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div ref={wrapRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        <div ref={hostRef} />
      </div>
      <div className="border-t border-border px-4 py-1.5 text-xs text-muted">
        {sheet?.truncated ? t("office.truncatedPrefix") : ""}{t("office.embeddedChartsNote")}
      </div>
    </div>
  );
}

const SLIDES_CSS = `
  .page { padding: 16px; }
  /* pptx-preview hardcodes a BLACK background on its wrapper — every gap
     between/around slides showed as black. !important beats the inline style. */
  .page > div { margin: 0 auto; background: transparent !important; }
  .page > div > div { margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
`;

export function PptxView({ bytes, scrollKey }: { bytes: ArrayBuffer; scrollKey: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const { hostRef, page } = useShadowPage(SLIDES_CSS);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Reading position, restored when the same deck is reopened.
  const onScroll = useScrollMemory(wrapRef, scrollKey, !loading);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    let previewer: { destroy(): void } | undefined;
    (async () => {
      try {
        const [{ init }, { normalizePptxForPreview }] = await Promise.all([
          import("pptx-preview"),
          import("@/lib/pptx"),
        ]);
        if (cancelled) return;
        // Decks styled via paragraph-level defRPr render unstyled (tiny black
        // text) in pptx-preview — rewrite them into explicit per-run form first.
        const normalized = await normalizePptxForPreview(bytes);
        if (cancelled) return;
        // Fit slides to the pane, with a floor so a collapsed pane stays legible.
        const width = Math.max((wrapRef.current?.clientWidth ?? 0) - 32, 480);
        previewer = init(page, { width, mode: "list" });
        await (previewer as ReturnType<typeof init>).preview(normalized);
      } catch (e) {
        if (!cancelled) setError(t("office.pptxRenderError", { message: message(e) }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      previewer?.destroy();
      page.replaceChildren();
    };
    // `t` intentionally excluded, same reasoning as DocxView above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, page]);

  return (
    <div ref={wrapRef} onScroll={onScroll} className="h-full overflow-auto">
      <RenderState error={error} loading={loading} />
      <div ref={hostRef} />
    </div>
  );
}
