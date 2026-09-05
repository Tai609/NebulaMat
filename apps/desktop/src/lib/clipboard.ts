import { isTauri } from "./tauri";

/**
 * Write text to the OS clipboard. In the desktop app this goes through Tauri's
 * native clipboard — WKWebView's `navigator.clipboard.writeText` is unreliable
 * (often rejects with NotAllowedError even inside a user gesture). Falls back to
 * the browser API in dev. Throws on failure so callers can surface an error.
 */
export async function copyText(text: string): Promise<void> {
  if (isTauri) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
