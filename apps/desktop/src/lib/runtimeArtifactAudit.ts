import type { ToolUpdatedEvent } from "@ai4s/sdk";
import { provenanceInputsFromEvent, recordProvenance } from "./provenance";
import { recordRun, runInputFromEvent } from "./runs";
import { isTauri, logDebug } from "./tauri";

const DEDUP_CAP = 4000;
const OUTBOX_KEY = "openscience.runtime-audit-outbox.v1";

type PendingOperation = {
  id: string;
  kind: "provenance" | "run";
  payload: unknown;
  sessionId?: string;
  model: string | null;
  attempts: number;
  nextAt: number;
};

const pending = new Map<string, PendingOperation>();
let flushPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function loadOutbox(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const value = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const row = item as Partial<PendingOperation>;
      if (
        typeof row.id !== "string" ||
        (row.kind !== "provenance" && row.kind !== "run") ||
        typeof row.attempts !== "number" ||
        typeof row.nextAt !== "number"
      ) continue;
      pending.set(row.id, {
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        ...(typeof row.sessionId === "string" ? { sessionId: row.sessionId } : {}),
        model: typeof row.model === "string" ? row.model : null,
        attempts: row.attempts,
        nextAt: row.nextAt,
      });
    }
  } catch {
    /* A corrupt browser outbox is isolated; the Rust ledgers remain readable. */
  }
}

function persistOutbox(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([...pending.values()].slice(-DEDUP_CAP)));
  } catch {
    // Storage quota/private mode must not interrupt the active turn. In-memory
    // retries still cover transient IPC failures during this process.
  }
}

loadOutbox();

function scheduleRetry(): void {
  if (retryTimer !== null || pending.size === 0) return;
  const nextAt = Math.min(...[...pending.values()].map((item) => item.nextAt));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushOutbox();
  }, Math.max(50, nextAt - Date.now()));
  // Node/Vitest should not be held open by an audit retry timer.
  (retryTimer as unknown as { unref?: () => void }).unref?.();
}

async function flushOutbox(): Promise<void> {
  if (!isTauri || flushPromise || pending.size === 0) return;
  flushPromise = (async () => {
    for (const [id, operation] of [...pending]) {
      if (operation.nextAt > Date.now()) continue;
      const ok = operation.kind === "provenance"
        ? await recordProvenance(
            operation.payload as Parameters<typeof recordProvenance>[0],
            operation.sessionId,
            operation.model,
          )
        : await recordRun(
            operation.payload as Parameters<typeof recordRun>[0],
            operation.sessionId,
            operation.model,
          );
      if (ok) {
        pending.delete(id);
        continue;
      }
      operation.attempts += 1;
      // Back off but keep the record durable in localStorage. The Rust side
      // deduplicates source_event_id, so retries cannot create extra versions.
      operation.nextAt = Date.now() + Math.min(60_000, 250 * 2 ** Math.min(operation.attempts, 8));
    }
    persistOutbox();
    scheduleRetry();
  })().catch((error) => {
    void logDebug(`runtime audit outbox failed: ${error instanceof Error ? error.message : String(error)}`);
  }).finally(() => {
    flushPromise = null;
  });
  await flushPromise;
}

function enqueue(operation: Omit<PendingOperation, "attempts" | "nextAt">): void {
  pending.set(operation.id, { ...operation, attempts: 0, nextAt: Date.now() });
  persistOutbox();
  void flushOutbox();
}

// Resume records left by a prior WebView/process crash before accepting new
// runtime events. Stable source ids make this replay safe.
void flushOutbox();

/** Durable side effects for completed tool events. The SDK event carries a
 * stable identity, while Rust appenders enforce the same identity again. */
export function recordRuntimeToolArtifacts(
  event: ToolUpdatedEvent,
  sessionId: string | undefined,
  model: string | null,
): void {
  if (!isTauri) return;
  for (const input of provenanceInputsFromEvent(event)) {
    const key = input.eventId ?? `${event.callId}:${input.path}`;
    enqueue({ id: `provenance:${key}`, kind: "provenance", payload: input, sessionId, model });
  }

  const run = runInputFromEvent(event);
  if (!run) return;
  enqueue({ id: `run:${run.eventId ?? event.callId}`, kind: "run", payload: run, sessionId, model });
}
