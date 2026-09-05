import { useEffect } from "react";
import { isTauri } from "@/lib/tauri";

/** Where the WebView's own menu is still the right answer:
 *
 *  - editable fields — Paste, Look Up, spelling all matter there
 *  - anything marked `data-native-menu` — read-only DOCUMENT content
 *    (a conversation, a file preview, a code listing), where Copy, Look Up and
 *    Translate are exactly what a user wants from a right-click
 *
 *  Everywhere else is chrome, and a chrome row is not a web page: offering
 *  "Open Link in New Window" or "Download Linked File" on a sidebar session is
 *  just wrong (it is an `<a>` only incidentally). Those get their own menus. */
const NATIVE_OK = 'input, textarea, [contenteditable="true"], [data-native-menu]';

/** True when the page menu should be allowed for this event target. */
export function allowsNativeMenu(target: EventTarget | null): boolean {
  const el =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return !!el?.closest(NATIVE_OK);
}

/**
 * Whether to suppress the page menu for this contextmenu event.
 *
 * `defaultPrevented` means a component already handled the right-click and is
 * opening its OWN menu — Radix's context menus do exactly that. Suppressing
 * again would be redundant, and doing it FIRST is actively harmful: Radix's
 * `composeEventHandlers` skips its own handler once `defaultPrevented` is set,
 * so pre-empting it left the user with no menu at all, native or app.
 */
export function shouldSuppressNativeMenu(event: {
  target: EventTarget | null;
  defaultPrevented: boolean;
}): boolean {
  if (event.defaultPrevented) return false;
  return !allowsNativeMenu(event.target);
}

/**
 * Suppress the WebView page menu on app chrome, in the packaged app only.
 *
 * Left alone in the browser (gateway) client: there the app really IS a web
 * page, and the browser's own menu — open in new tab, back, reload — is the
 * user's, not ours to take away.
 */
export function useNativeContextMenuGuard(): void {
  useEffect(() => {
    if (!isTauri) return;
    const onContextMenu = (event: MouseEvent) => {
      if (shouldSuppressNativeMenu(event)) event.preventDefault();
    };
    // BUBBLE phase, deliberately: every component's own handler runs first, so
    // a component that opens its own menu is seen as such (see above). Bubbling
    // still reaches us before the browser's default action.
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
}
