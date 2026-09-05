# apps/desktop

The Tauri 2 + React + TypeScript + Vite desktop application — the AI4S Workbench shell.

## Layout

- `src/` — the React frontend.
  - `app/` — `routes/`, `layout/`, `providers/` (routing, shell layout, context providers).
  - `components/` — reusable UI: `sidebar/`, `topbar/`, `command-palette/`, `cards/`,
    `artifact-viewer/`, `approval-dialog/`, `tool-call-card/`, `code-viewer/`, `markdown-viewer/`.
  - `features/` — feature modules: `onboarding/`, `projects/`, `chat/`, `agent-runtime/`,
    `literature/`, `artifacts/`, `provenance/`, `review/`, `skills/`, `settings/`.
  - `lib/` — `api/`, `events/` (event bus for agent streams), `store/` (Zustand), `theme/`.
- `src-tauri/` — the Rust side: native commands, sidecar orchestration, packaging config.

## State strategy

- UI state → Zustand (`lib/store`).
- Server / runtime state → TanStack Query.
- Streaming agent events → a dedicated event bus (`lib/events`).

The frontend talks to the agent runtime only through `packages/sdk` (`DeepSeekHarnessClient`).

## Depends on

`packages/ui`, `packages/shared`, `packages/sdk`; at runtime, the Windows build
starts its bundled Node.js and DSH dependency closure. `NEBULAMAT_DSH_BIN`
remains available as an explicit override.
