// BaseAgentRuntime: shared infrastructure for every AgentRuntime implementation.
//
// The listener/status machinery (getStatus / onEvent / onStatus / emit /
// setStatus) is identical across runtimes — the DSH adapter and compatibility
// had byte-for-byte copies. This base class factors it out so a new runtime
// author fills in ONLY their protocol-specific methods (connect, createSession,
// sendPrompt, ...) and inherits the plumbing.
//
// To add a new agent runtime, extend this class and implement the remaining
// AgentRuntime methods. See docs/AGENT_INTEGRATION.md for a step-by-step guide.
import type {
  RuntimeEvent,
  RuntimeStatus,
  RuntimeToolGuard,
  RuntimeMessageEvent,
  RuntimeCapabilities,
  ToolAdmissionDecision,
  ToolPostEvent,
  ToolPreEvent,
} from "./types";

/**
 * Listener + status plumbing shared by every runtime. A subclass extends this
 * and implements its protocol-specific AgentRuntime methods (connect,
 * createSession, sendPrompt, …), calling `setStatus()` as it transitions and
 * `emit()` to fan out normalized events.
 *
 * `getStatus` / `onEvent` / `onStatus` are final here — they never differ by
 * runtime, so they are intentionally NOT overridable in practice.
 */
export abstract class BaseAgentRuntime {
  private status: RuntimeStatus = "offline";
  private readonly eventListeners = new Set<(e: RuntimeMessageEvent) => void>();
  private readonly runtimeEventListeners = new Set<(e: RuntimeEvent) => void>();
  private readonly statusListeners = new Set<(s: RuntimeStatus) => void>();
  private readonly toolPreListeners = new Set<(e: ToolPreEvent) => void>();
  private readonly toolPostListeners = new Set<(e: ToolPostEvent) => void>();
  private readonly toolGuards = new Set<RuntimeToolGuard>();

  /** Current runtime status. Implements `AgentRuntime.getStatus`. */
  getStatus(): RuntimeStatus {
    return this.status;
  }

  /** Subscribe to normalized runtime events. Returns an unsubscribe. */
  onEvent(listener: (event: RuntimeMessageEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.runtimeEventListeners.add(listener);
    return () => this.runtimeEventListeners.delete(listener);
  }

  onToolPre(listener: (event: ToolPreEvent) => void): () => void {
    this.toolPreListeners.add(listener);
    return () => this.toolPreListeners.delete(listener);
  }

  onToolPost(listener: (event: ToolPostEvent) => void): () => void {
    this.toolPostListeners.add(listener);
    return () => this.toolPostListeners.delete(listener);
  }

  /** Conservative default for compatibility adapters; DSH overrides this. */
  getCapabilities(): RuntimeCapabilities {
    return {
      runtime: "compatibility",
      sessions: { create: true, archive: true, unarchive: true, delete: true, revert: true, fork: true },
      interaction: { questions: true, permissions: true, persistentRules: true },
      configuration: { providers: true, oauth: true, mcp: true },
      execution: { shell: true, commands: true, toolAdmission: "adapter" },
      surfaces: { desktop: true, web: false, readOnlyWeb: false },
    };
  }

  registerToolGuard(guard: RuntimeToolGuard): () => void {
    this.toolGuards.add(guard);
    return () => this.toolGuards.delete(guard);
  }

  /** Subscribe to status transitions. Returns an unsubscribe. */
  onStatus(listener: (status: RuntimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ---- tools for subclasses ----

  /** Fan a normalized event out to every onEvent listener. */
  protected emit(event: RuntimeEvent): void {
    this.runtimeEventListeners.forEach((l) => l(event));
    if (event.type !== "tool.pre" && event.type !== "tool.post" && event.type !== "turn.started" && event.type !== "turn.finished") {
      this.eventListeners.forEach((l) => l(event));
    }
    if (event.type === "tool.pre") this.toolPreListeners.forEach((l) => l(event));
    if (event.type === "tool.post") this.toolPostListeners.forEach((l) => l(event));
  }

  protected async admitTool(
    context: Parameters<RuntimeToolGuard>[0],
    boundary: "pre-execution" | "observed" = "pre-execution",
  ): Promise<ToolAdmissionDecision> {
    this.emit({ ...context, type: "tool.pre", decision: "pending", boundary });
    for (const guard of this.toolGuards) {
      const decision = await guard(context);
      if (decision.decision !== "allow") {
        this.emit({ ...context, type: "tool.pre", ...decision, boundary });
        return decision;
      }
    }
    this.emit({ ...context, type: "tool.pre", decision: "allow", boundary });
    return { decision: "allow" };
  }

  /** Transition status and notify onStatus listeners. A no-op if unchanged. */
  protected setStatus(status: RuntimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
