---
name: verify
description: Verify apps/desktop frontend changes visually without launching the Tauri app or a live model
---

# Verifying desktop frontend changes

Full-app runs need an OpenCode session + live model turn. For pure frontend
component changes, mount the component in a throwaway vite page instead:

1. Create `apps/desktop/verify-<x>.html` (plain html, `<div id="root">`,
   `<script type="module" src="/src/verify-<x>.tsx">`) and
   `apps/desktop/src/verify-<x>.tsx` (ReactDOM.createRoot, import
   `./index.css` for Tailwind, import the component via `@/`). Vite serves
   any .html under `apps/desktop/` automatically.
2. `cd apps/desktop && npx vite --port 5199 --strictPort` (background).
   The npx wrapper may double-spawn and report "port in use" failure while
   the first instance is fine — check `lsof -iTCP:5199` before retrying.
3. Drive with the browser-control skill (Chrome HTTP API, port 9528):
   `createWindow` → `waitForSelector` → `readDom` → `screenshotTab`
   (screenshots land in `~/Downloads/`).
   Gotchas: `evalScript` is blocked by CSP on the extension — use
   `readDom`/`scrollTab` instead; `readDom` requires an explicit
   `"attributes": []` or it errors with "Value is unserializable".
4. Clean up: `closeTab`, kill the vite pid, delete both harness files,
   confirm `git status` is clean.
