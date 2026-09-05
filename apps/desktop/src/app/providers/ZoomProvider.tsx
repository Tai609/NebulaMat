import { useEffect, type ReactNode } from "react";
import { useUiStore } from "@/lib/store";
import { isTauri, setWebviewZoom } from "@/lib/tauri";

/** Owns the webview page zoom (Cmd/Ctrl +/- to zoom, Cmd/Ctrl 0 to reset).
 *  We handle it in-app rather than via Tauri's `zoomHotkeysEnabled` so the
 *  macOS titlebar strips can counter-scale by the same factor: the native
 *  traffic lights don't zoom, so their inset must shrink/grow inversely to
 *  stay aligned (see --zoom in index.css and overlayTitlebarStyle).
 *
 *  A no-op outside the packaged desktop app — in `pnpm dev` the browser keeps
 *  its own Cmd/Ctrl +/- zoom untouched. */
export function ZoomProvider({ children }: { children: ReactNode }) {
  const zoom = useUiStore((s) => s.zoom);

  // Apply the factor to the webview and expose it to CSS as --zoom.
  useEffect(() => {
    if (!isTauri) return;
    document.documentElement.style.setProperty("--zoom", String(zoom));
    void setWebviewZoom(zoom);
  }, [zoom]);

  // Cmd/Ctrl +/- and 0, replacing the native hotkeys (zoomHotkeysEnabled: false).
  useEffect(() => {
    if (!isTauri) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const { zoomBy, resetZoom } = useUiStore.getState();
      if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
        e.preventDefault();
        zoomBy(1);
      } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") {
        e.preventDefault();
        zoomBy(-1);
      } else if (e.key === "0" || e.code === "Numpad0") {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <>{children}</>;
}
