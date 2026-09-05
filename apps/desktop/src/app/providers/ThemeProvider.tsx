import { useEffect, type ReactNode } from "react";
import { useUiStore } from "@/lib/store";
import { isMacUA, isTauri, setWindowTheme } from "@/lib/tauri";

/** Applies the current theme to the document root. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  const aquaBlur = useUiStore((s) => s.aquaBlur);
  const aquaFrost = useUiStore((s) => s.aquaFrost);
  const aquaBrightness = useUiStore((s) => s.aquaBrightness);
  const aquaScheme = useUiStore((s) => s.aquaScheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.aquaScheme = aquaScheme;
    // The ported Aqua stylesheet follows the source plugin's resolved-scheme
    // hook. Keep it in sync with NebulaMat's html theme attribute.
    const dark = theme === "dark" || (theme === "aqua" && aquaScheme === "dark");
    document.body.toggleAttribute("data-ds-dark-theme", dark);
    void setWindowTheme(dark);
  }, [theme, aquaScheme]);
  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--aqua-blur", `${aquaBlur}px`);
    style.setProperty("--aqua-surface-opacity", String(0.54 + aquaFrost * 0.0036));
    style.setProperty("--aqua-surface-2-opacity", String(0.38 + aquaFrost * 0.0034));
    // Aqua follows the source plugin's dark-scheme brightness scale (0-50).
    style.setProperty("--aqua-wash-opacity", "0");
  }, [aquaBlur, aquaBrightness, aquaFrost]);
  // The macOS desktop window has a vibrancy material behind the webview
  // (tauri.macos.conf.json); flag the root so CSS can let the sidebar show it.
  useEffect(() => {
    if (isTauri && isMacUA()) document.documentElement.dataset.vibrancy = "1";
  }, []);
  return <>{children}</>;
}
