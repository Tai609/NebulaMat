# apps/desktop/src-tauri

The Rust side of the Tauri app.

Responsibilities:

- Native commands exposed to the frontend (filesystem within the workspace, OS keychain
  access for API keys, etc.).
- Spawning and supervising the bundled Node.js + `dsh --profile web` runtime on
  Windows, plus app-managed connector sidecars.
- Packaging configuration — local targets include `dmg` / `app` (macOS) and
  `nsis` / `msi` (Windows); the public release workflow publishes Windows and
  Linux installers only.
- Auto-update wiring (Tauri updater, GitHub Releases + signed `latest.json`) — later.

Keep this thin: system capabilities only, no heavy computation. DeepSeek Harness
owns the agent loop; scientific and product capabilities remain replaceable
modules declared under `runtime/harness/`.
