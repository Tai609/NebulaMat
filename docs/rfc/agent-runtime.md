# RFC: DSH Runtime Boundary

Status: implemented for the DSH-only desktop/web runtime.

## Decision

DeepSeek Harness (DSH) is the only production bottom runtime. The desktop shell
starts `dsh --profile web`; the UI never speaks its HTTP or WebSocket protocol
directly. `packages/sdk/src/DeepSeekHarnessClient.ts` is the protocol adapter and
`packages/sdk/src/runtime.ts` is the application-facing boundary.

`OpenCodeClient`, `OpenCodeEvent`, and the OpenCode URL/version constants remain
deprecated compatibility exports for old SDK consumers and fixtures only. They
must not be used to construct the desktop runtime, define new product behavior,
or describe DSH capabilities.

## Contract Shape

The SDK exposes normalized runtime events (`RuntimeMessageEvent` and
`RuntimeEvent`) rather than DSH wire frames. The old `OpenCodeEvent` name is an
alias scheduled for removal after downstream consumers migrate.

The contract intentionally keeps optional operations optional:

- DSH core supports session creation, fork, archive, prompt, cancellation and
  rename.
- DSH core does not promise deletion, unarchive, unrevert, persistent
  permission rules, OAuth, or MCP composition. Its revert operation is
  implemented as a fork from the completed turn containing the selected
  message, leaving the source session intact.
- `RuntimeCapabilities` reports these facts at runtime. UI controls must use the
  snapshot or a gateway capability response before rendering an operation.

Provider, credential, MCP and other configuration methods remain concrete DSH
module APIs, not universal `AgentRuntime` obligations.

## Tool Admission

Tool governance has two distinct boundaries:

1. The mounted `nebulamat-tool-governance` Cordis plugin injects `tools` and
   runs at DSH's `tools/pre-execute` waterfall plus `tools.guard()` before a
   tool body can dispatch. Remote/DFT execution requires a named human
   approval bound to the exact model, parameters, audit and cost hashes.
2. The SDK adapter mirrors the same tool frames through registered
   `RuntimeToolGuard`s for UI and audit telemetry. It is a compatibility
   observer, not the authority that allows execution.

Later `tool/call` frames are marked `executionBoundary: "observed"`; they are
telemetry only. The DSH capability contract therefore advertises
`toolAdmission: "server"`; a missing governance plugin is a startup/deployment
error, not a reason to silently downgrade to adapter-only enforcement.

## Scientific Workflow Contract

`packages/shared/src/dft.ts` is the single typed contract for DFT work. It
contains schema versions, model/cost audit fields (atom/free/fixed counts, slab
policy, supercell/coverage, k-points, memory, run count and lower-cost option),
hash-bound submission manifests, named human approvals, and legal stage
transitions. Prompt text and regexes may classify an incoming request, but they
cannot advance a workflow or authorize submission.

The desktop also exposes a deterministic DFT cache key and resumable checkpoint
primitive. Cache identity is an optimization; approval identity is always based
on the frozen artifact hashes in the manifest.

## Audit Reliability

Provenance and run JSONL files remain the durable source of truth. Every frontend
tool/run side effect carries a stable source event id. The frontend deduplicates
reconnects in memory and Rust appenders deduplicate the same id on disk before
allocating a new version/run. SQLite remains a rebuildable run read index.

## Gateway Surface

The remote gateway serves all extensionless SPA roots, including `/materials`,
`/dft-review` and `/graphs`, and exposes authenticated `/v1/capabilities`. The
capability response describes DSH operations plus desktop/web/read-only
surfaces. Desktop-only routes are hidden from the web sidebar and show an
explicit unavailable state on a direct deep link.

## Ownership Rules

- `DeepSeekHarnessClient`: DSH transport, frame normalization, pre-tool
  admission and protocol capability snapshot.
- `runtime.ts`: store orchestration and UI state only. Artifact/run recording is
  isolated in `runtimeArtifactAudit.ts`.
- `packages/shared/src/dft.ts`: typed scientific workflow and hash contracts.
- Rust host: gateway policy, durable JSONL append/idempotency and local workspace
  capabilities.

Any new feature must identify its owner before adding a method to `AgentRuntime`.
If a DSH module is required, expose it as a capability and fail explicitly when
the module is absent; do not add an OpenCode-shaped stub.
