# packages/sdk

`DeepSeekHarnessClient` — the single boundary between the app and the agent runtime.

The UI never calls DSH directly. This package wraps the transport so the runtime
can change without touching the frontend:

- Talks to a running `dsh --profile web` over its HTTP + WebSocket RPC API:
  - `POST /api/<rpc-method>` for request/response operations such as
    `session.create`, `session.fork`, `session.prompt`, and `session.history`.
  - `WS /api/events.mux` and `WS /api/events.host` for session, tool,
    approval, question, and host-status downlinks.
- Normalizes DSH events into a small app-facing event union
  (`text.updated`, `tool.updated`, `session.idle`, `error`) so the UI upserts by part/call id.
- Pins the supported DSH protocol version (`DSH_VERSION`).
- Reports `toolAdmission: "server"` because remote/DFT execution is governed
  by the mounted DSH Cordis plugin; adapter guards remain an audit/UI mirror.

`mockServer.ts` remains a legacy OpenCode-protocol compatibility fixture for
third-party adapter tests; production runtime construction uses DSH only. New
code should consume `RuntimeMessageEvent` and `RuntimeCapabilities`, not the
deprecated OpenCode aliases.
