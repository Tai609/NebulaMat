import { describe, expect, it, vi } from "vitest";
import { DeepSeekHarnessClient, isPublicProgressText, summarizeProgressText } from "./DeepSeekHarnessClient";

describe("summarizeProgressText", () => {
  it("keeps one concise action in the user's language", () => {
    expect(summarizeProgressText("I'll inspect the MatterGen environment."))
      .toBe("Inspecting the MatterGen environment…");
    expect(summarizeProgressText("我正在检查 MatterGen 环境。"))
      .toBe("正在检查 MatterGen 环境…");
    expect(summarizeProgressText("我会验证检查点。"))
      .toBe("正在验证检查点…");
    expect(summarizeProgressText("再补充几组针对核心机理的检索（d 带中心/火山水解协同）。"))
      .toBe("正在补充几组针对核心机理的检索（d 带中心/火山水解协同）…");
    expect(summarizeProgressText("核心文献已就位，再核实两篇奠基性理论文献。"))
      .toBe("正在核实两篇奠基性理论文献…");
  });

  it("identifies a standalone action update so it does not enter the thought lane", () => {
    expect(isPublicProgressText("我来分析 NiPt 催化剂的 HER 机理。" )).toBe(true);
    expect(isPublicProgressText("private deliberation about the answer")).toBe(false);
    expect(isPublicProgressText("I need to decide whether the result is reliable.")).toBe(false);
  });

  it("does not expose private tags, internal asides, or completed-result prose", () => {
    expect(summarizeProgressText("<think>I should inspect every branch</think>"))
      .toBeUndefined();
    expect(summarizeProgressText("Actually, I need to inspect another possibility."))
      .toBeUndefined();
    expect(summarizeProgressText("To decide this, I need to inspect another branch."))
      .toBeUndefined();
    expect(summarizeProgressText("我其实需要分析另一种可能。"))
      .toBeUndefined();
    expect(summarizeProgressText("已修复流式输出问题。"))
      .toBeUndefined();
  });
});

type Listener = (event: Event | MessageEvent) => void;

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 3;
    this.dispatch("close", new Event("close"));
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open", new Event("open"));
  }

  message(value: unknown): void {
    this.dispatch("message", new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  private dispatch(type: string, event: Event | MessageEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const costMeterState = {
  today: { date: "2026-08-17", input: 10, output: 5, cacheRead: 2, cacheWrite: 1, calls: 1, cost: 0.001, sessions: [] },
  month: { date: "2026-08", input: 10, output: 5, cacheRead: 2, cacheWrite: 1, calls: 1, cost: 0.001, sessions: [] },
  total: { date: "total", input: 10, output: 5, cacheRead: 2, cacheWrite: 1, calls: 1, cost: 0.001, sessions: [] },
  budgetUsed: 0.001,
  balance: { status: "off", message: "", fetchedAt: 0, currency: "", totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 },
  goQuota: { status: "off", message: "", fetchedAt: 0, rolling: null, weekly: null, monthly: null },
  history: [],
  priceCatalog: { fetchedAt: null, modelCount: 0, ignoredTiered: 0, used: [] },
  config: {
    locale: "auto", position: "off", sidebar: false, currency: "USD", symbol: "$", decimals: 6, exchangeRate: 1,
    peakEnabled: false, peakEffectiveAt: "", peakWindows: [],
    prices: { models: {}, default: { cacheHit: 0, cacheMiss: 0, output: 0 } },
    budget: { enabled: false, amount: 100, period: "month", customStart: null, customEnd: null, detail: true },
    balance: { display: "settings", refreshMinutes: 5 },
    goQuota: { enabled: false, display: "settings", refreshMinutes: 15, apiKey: "", main: "rolling", detail: true },
    corner: { enabled: false, goRolling: true, goWeekly: true, goMonthly: true, budget: true },
    historyDays: 180, fetchedAt: null, priceSource: "bundled",
  },
  meta: { now: 1, timezoneOffsetMinutes: 0, dayKey: "2026-08-17", monthKey: "2026-08" },
};

function rpcFetch(
  historyEvents?: unknown[],
  sessionRows: unknown[] = [{
    sessionId: "session-1",
    updatedAt: 20,
    running: false,
    blank: false,
    cwd: "C:/work",
    projections: { asOfSeq: 4, values: { title: "Projected title" } },
  }],
) {
  const calls: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url, init, body });
    if (url.endsWith("/api/respond")) return Response.json({ accepted: true });
    const method = String(body.method ?? "");
    const values: Record<string, unknown> = {
      "host.describe": { version: "0.1.0", cwd: "C:/work", provider: "deepseek-official", model: "deepseek-v4-flash", attachedSessions: 0, canOpenPath: true },
      "session.create": { sessionId: "session-1" },
      "session.models": {
        current: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
        routable: true,
        groups: [],
        failures: [],
      },
      "session.selectModel": {
        selected: { provider: "opencode-go", model: "qwen3.7-max", reasoningEffort: "high" },
      },
      "session.fork": { sessionId: "child-1" },
      "subagent.list": {
        entries: [
          { kind: "child", id: "child-1", mode: "continuable", activity: "running", label: "Review the data", hasChildren: false },
          { kind: "diagnostic", id: "ignored" },
        ],
      },
      "session.rename": { title: "Renamed", seq: 1 },
      "agentPreset.list": { presets: [{ id: "standard", trust: "system", isDefault: true, description: "Standard" }] },
      "agentPreset.read": { agentPreset: "standard", trust: "system", content: "- name: '@deepseek-ai/dsh-plan-mode'" },
      "skill.list": {
        skills: [
          { name: "aris-paper-write", description: "Write a paper", modelInvocable: true },
          { name: "materials-design", description: "Design materials", modelInvocable: true },
        ],
      },
      "session.list": {
        items: sessionRows,
      },
      "session.history": {
        hasMore: false,
        projections: { asOfSeq: 4, values: { plan: { active: true, pending: false } } },
        events: historyEvents ?? [
          { event: { type: "user/message", seq: 0, data: { id: "system-1", content: [{ type: "text", text: "<system-reminder>\nThe following workspace instructions may be relevant to your work.\n</system-reminder>" }], source: { kind: "system" } } } },
          { event: { type: "user/message", seq: 1, data: { id: "u1", content: [{ type: "text", text: "hello" }], source: { kind: "user" } } } },
          { event: { type: "assistant/message", seq: 2, data: { message: { id: "a1", content: [{ type: "text", text: "world" }] } } } },
          { event: { type: "tool/call", seq: 3, data: { callId: "history-call", name: "bash", arguments: '{"command":"pwd"}' } } },
          { event: { type: "tool/result", seq: 4, data: { message: { source: { kind: "tool", callId: "history-call" }, content: [{ type: "tool-result", toolCallId: "history-call", content: [{ type: "text", text: "C:/work" }], isError: false }] } } } },
          { event: { type: "turn/end", seq: 5, data: { reason: { kind: "completed" } } } },
        ],
      },
      "costMeter/getState": costMeterState,
      "costMeter/updateConfig": costMeterState,
      "costMeter/fetchPrices": { ok: true, message: "synced", state: costMeterState },
      "costMeter/refreshBalance": { ok: true, message: "refreshed", state: costMeterState },
      "costMeter/refreshGoQuota": { ok: true, message: "refreshed", state: costMeterState },
      "costMeter/resetHistory": costMeterState,
    };
    return Response.json({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value: values[method] ?? {} } });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function makeClient(fetchImpl: typeof fetch, password = "gateway-token") {
  FakeWebSocket.instances.length = 0;
  return new DeepSeekHarnessClient({
    baseUrl: "http://127.0.0.1:4098",
    directory: "C:/work",
    password,
    fetchImpl,
    webSocketFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket,
  });
}

describe("DeepSeekHarnessClient", () => {
  it("discovers skills before the first visible session exists", async () => {
    const { calls, fetchImpl } = rpcFetch(undefined, []);
    const client = makeClient(fetchImpl);

    await expect(client.listSkills()).resolves.toEqual([
      { name: "aris-paper-write", description: "Write a paper" },
      { name: "materials-design", description: "Design materials" },
    ]);
    expect(calls.map((call) => call.body.method)).toEqual(["session.list", "session.create", "skill.list"]);
    expect(calls[2]?.body.payload).toEqual({ sessionId: "session-1" });
  });

  it("reuses an existing blank carrier instead of creating another empty session", async () => {
    const { calls, fetchImpl } = rpcFetch(undefined, [
      { sessionId: "carrier-1", blank: true, cwd: "C:/work" },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.listSkills()).resolves.toHaveLength(2);
    expect(calls.map((call) => call.body.method)).toEqual(["session.list", "skill.list"]);
    expect(calls[1]?.body.payload).toEqual({ sessionId: "carrier-1" });
  });

  it("uses an existing real session for skill discovery without creating a carrier", async () => {
    const { calls, fetchImpl } = rpcFetch(undefined, [
      { sessionId: "session-1", blank: false, cwd: "C:/work", projections: { values: { title: "Existing work" } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.listSkills()).resolves.toHaveLength(2);
    expect(calls.map((call) => call.body.method)).toEqual(["session.list", "skill.list"]);
    expect(calls[1]?.body.payload).toEqual({ sessionId: "session-1" });
  });

  it("reads DSH token-meter projections as estimated context usage", async () => {
    const { fetchImpl: baseFetch } = rpcFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (body.method === "session.history") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              events: [],
              hasMore: false,
              projections: {
                asOfSeq: 42,
                values: {
                  contextPressure: { pressureTokens: 1200, projectedTokens: 1500, contextWindow: 8000 },
                  contextBreakdown: { systemTokens: 120, toolsTokens: 340, messageTokens: 1040 },
                  tokenUsage: { uncachedInputTokens: 900, outputTokens: 250, cacheReadTokens: 300, cacheWriteTokens: 0 },
                },
              },
            },
          },
        });
      }
      return baseFetch(input, init);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.getContextUsage("session-1")).resolves.toEqual({
      usedTokens: 1500,
      contextWindow: 8000,
      pressureTokens: 1200,
      projectedTokens: 1500,
      systemTokens: 120,
      toolsTokens: 340,
      messageTokens: 1040,
      tokenUsage: { uncachedInputTokens: 900, outputTokens: 250, cacheReadTokens: 300, cacheWriteTokens: 0 },
      estimated: true,
      asOfSeq: 42,
    });
  });

  it("uses the DSH command Remote for discovery and execution", async () => {
    const { calls, fetchImpl: baseFetch } = rpcFetch();
    const remoteCalls: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (body.method === "commands/list") {
        remoteCalls.push({ url: String(input), init, body });
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: [{ name: "compact", description: "Compact context", input: { hint: "" } }] },
        });
      }
      if (body.method === "commands/execute") {
        remoteCalls.push({ url: String(input), init, body });
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: { commandId: "command-1", result: { kind: "success", sourceEventSeq: 9 } } },
        });
      }
      return baseFetch(input, init);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const connecting = client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances.forEach((socket) => socket.open());
    await connecting;

    await expect(client.listCommands()).resolves.toEqual([
      { name: "compact", description: "Compact context", source: "command", template: "" },
    ]);
    await expect(client.runCommand("session-1", "compact")).resolves.toBeUndefined();
    expect(remoteCalls.map((call) => call.body)).toEqual([
      expect.objectContaining({ method: "commands/list", payload: { args: { agentId: "session-1" } } }),
      expect.objectContaining({ method: "commands/execute", payload: { args: { agentId: "session-1", line: "/compact" } } }),
    ]);
    expect(calls.some((call) => call.body.method === "session.prompt")).toBe(false);
    client.close();
  });

  it("coalesces concurrent catalog discovery onto one carrier session", async () => {
    const { calls, fetchImpl } = rpcFetch(undefined, []);
    const client = makeClient(fetchImpl);

    await Promise.all([client.listSkills(), client.listSkills(), client.listSkills()]);
    expect(calls.filter((call) => call.body.method === "session.list")).toHaveLength(1);
    expect(calls.filter((call) => call.body.method === "session.create")).toHaveLength(1);
    expect(calls.filter((call) => call.body.method === "skill.list")).toHaveLength(3);
  });

  it("omits blank carrier sessions from the user-facing history", async () => {
    const { fetchImpl } = rpcFetch(undefined, [
      { sessionId: "carrier-1", blank: true, cwd: "C:/work" },
      { sessionId: "session-1", blank: false, cwd: "C:/work", projections: { values: { title: "Real work" } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "session-1", title: "Real work" }),
    ]);
  });

  it("applies a history limit after excluding child sessions", async () => {
    const { fetchImpl } = rpcFetch(undefined, [
      { sessionId: "child-1", parentSessionId: "root-1", blank: false, updatedAt: 60, projections: { values: { title: "Child 1" } } },
      { sessionId: "child-2", parentSessionId: "root-1", blank: false, updatedAt: 50, projections: { values: { title: "Child 2" } } },
      { sessionId: "root-1", blank: false, updatedAt: 40, projections: { values: { title: "Root 1" } } },
      { sessionId: "root-2", blank: false, updatedAt: 30, projections: { values: { title: "Root 2" } } },
      { sessionId: "root-3", blank: false, updatedAt: 20, projections: { values: { title: "Root 3" } } },
    ]);
    const client = makeClient(fetchImpl);

    const page = await client.querySessions({ limit: 2, topLevelOnly: true });

    expect(page.sessions.map((session) => session.id)).toEqual(["root-1", "root-2"]);
  });

  it("keeps a just-created user session visible while DSH still marks it blank", async () => {
    const { fetchImpl } = rpcFetch(undefined, [
      { sessionId: "session-1", blank: true, cwd: "C:/work" },
    ]);
    const client = makeClient(fetchImpl);

    // The first prompt can race session.list: DSH has created the row but has
    // not persisted the user message yet. It must not be mistaken for the
    // internal discovery carrier and pruned from the desktop layout.
    await expect(client.createSession()).resolves.toBe("session-1");
    await expect(client.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "session-1", title: "Untitled" }),
    ]);
  });

  it("sends DSH RPC envelopes with Bearer authentication and validates rpcId", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.createSession("Renamed")).resolves.toBe("session-1");

    expect(calls[0]?.body).toMatchObject({
      type: "client-request",
      method: "session.create",
      payload: { cwd: "C:/work" },
    });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer gateway-token");
    expect(calls[1]?.body).toMatchObject({ method: "session.rename", payload: { sessionId: "session-1", title: "Renamed" } });
  });

  it("maps DSH session projections and wrapped history entries", async () => {
    const { fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "session-1", title: "Projected title", directory: "C:/work" }),
    ]);
    await expect(client.getMessages("session-1")).resolves.toEqual([
      expect.objectContaining({ role: "user", id: "u1", agent: "plan", parts: [{ type: "text", text: "hello" }] }),
      expect.objectContaining({
        role: "assistant",
        id: "a1",
        completed: expect.any(Number),
        parts: [
          { type: "reasoning", text: "world" },
          { type: "tool", tool: "bash", state: { status: "completed", input: { command: "pwd" }, output: "C:/work" } },
        ],
      }),
    ]);
  });

  it("forks before the selected user turn when reverting a DSH session", async () => {
    const { calls, fetchImpl } = rpcFetch([
      { event: { type: "turn/start", seq: 0, data: {} } },
      { event: { type: "user/message", seq: 1, data: { id: "u1", content: [{ type: "text", text: "first" }], source: { kind: "user" } } } },
      { event: { type: "turn/end", seq: 2, data: { reason: { kind: "completed" } } } },
      { event: { type: "turn/start", seq: 3, data: {} } },
      { event: { type: "user/message", seq: 4, data: { id: "u2", content: [{ type: "text", text: "second" }], source: { kind: "user" } } } },
      { event: { type: "turn/end", seq: 5, data: { reason: { kind: "completed" } } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.revert("session-1", "u2")).resolves.toBe("child-1");
    expect(calls.map((call) => call.body.method)).toEqual(["session.history", "session.fork"]);
    expect(calls[1]?.body.payload).toEqual({ sessionId: "session-1", atSeq: 1 });
  });

  it("creates a fresh session when reverting the first user turn", async () => {
    const { calls, fetchImpl } = rpcFetch([
      { event: { type: "user/message", seq: 1, data: { id: "u1", content: [{ type: "text", text: "first" }], source: { kind: "user" } } } },
      { event: { type: "turn/end", seq: 2, data: { reason: { kind: "completed" } } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.revert("session-1", "u1")).resolves.toBe("session-1");
    expect(calls.map((call) => call.body.method)).toEqual(["session.history", "session.create"]);
    expect(calls[1]?.body.payload).toEqual({ cwd: "C:/work" });
  });

  it("uses a sequence stored on the history row wrapper", async () => {
    const { calls, fetchImpl } = rpcFetch([
      { seq: 11, event: { type: "user/message", data: { id: "u1", content: [{ type: "text", text: "first" }], source: { kind: "user" } } } },
      { event: { type: "turn/end", seq: 12, data: { reason: { kind: "completed" } } } },
      { seq: 21, event: { type: "user/message", data: { id: "u2", content: [{ type: "text", text: "second" }], source: { kind: "user" } } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.revert("session-1", "u2")).resolves.toBe("child-1");
    expect(calls.at(-1)?.body.payload).toEqual({ sessionId: "session-1", atSeq: 11 });
  });

  it("refuses to guess a fork anchor when an earlier user message has no sequence", async () => {
    const { calls, fetchImpl } = rpcFetch([
      { event: { type: "user/message", data: { id: "u1", content: [{ type: "text", text: "first" }], source: { kind: "user" } } } },
      { event: { type: "user/message", seq: 21, data: { id: "u2", content: [{ type: "text", text: "second" }], source: { kind: "user" } } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.revert("session-1", "u2")).rejects.toThrow("no sequence anchor");
    expect(calls.map((call) => call.body.method)).toEqual(["session.history"]);
  });

  it("hides runtime-context snapshots from restored conversation history", async () => {
    const { fetchImpl } = rpcFetch([
      {
        event: {
          type: "user/message",
          seq: 1,
          data: {
            id: "runtime-context",
            content: [{ type: "text", text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: danger-full-access." }],
            source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "snapshot" },
          },
        },
      },
      { event: { type: "user/message", seq: 2, data: { id: "u1", content: [{ type: "text", text: "我的问题" }], source: { kind: "user" } } } },
      { event: { type: "assistant/message", seq: 3, data: { message: { id: "a1", content: [{ type: "text", text: "回答" }] } } } },
    ]);
    const client = makeClient(fetchImpl);

    await expect(client.getMessages("session-1")).resolves.toEqual([
      expect.objectContaining({ role: "user", id: "u1", parts: [{ type: "text", text: "我的问题" }] }),
      expect.objectContaining({ role: "assistant", id: "a1" }),
    ]);
  });

  it("hides the compaction checkpoint while retaining its auditable marker", async () => {
    const { fetchImpl } = rpcFetch([
      { event: { type: "user/message", seq: 1, data: { id: "u1", content: [{ type: "text", text: "hello" }], source: { kind: "user" } } } },
      { event: { type: "assistant/message", seq: 2, data: { message: { id: "a1", content: [{ type: "text", text: "answer" }] } } } },
      { event: { type: "turn/end", seq: 3, data: { reason: { kind: "completed" } } } },
      { event: { type: "compaction/summary", seq: 4, data: { compactionId: "compact-1", summary: [{ type: "text", text: "summary" }], shadowedTokenCount: 900 } } },
      { event: { type: "user/message", seq: 5, data: { id: "checkpoint-1", content: [{ type: "text", text: "This is an automatically generated checkpoint." }], source: { kind: "plugin", plugin: "compact", compactionId: "compact-1" } } } },
    ]);
    const client = makeClient(fetchImpl);

    const messages = await client.getMessages("session-1");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(expect.objectContaining({ role: "user", id: "u1" }));
    expect(messages[1]).toEqual(expect.objectContaining({
      role: "assistant",
      id: "a1",
      parts: [
        { type: "text", text: "answer" },
        { type: "compaction", compactionId: "compact-1", auto: true, shadowedTokenCount: 900 },
      ],
    }));
  });

  it("keeps an assistant message incomplete when history has no terminal event", async () => {
    const { fetchImpl } = rpcFetch([
      { event: { type: "user/message", seq: 1, data: { id: "u1", content: [{ type: "text", text: "hello" }], source: { kind: "user" } } } },
      { event: { type: "assistant/message", seq: 2, data: { message: { id: "a1", content: [{ type: "text", text: "still working" }] } } } },
    ]);
    const client = makeClient(fetchImpl);

    const messages = await client.getMessages("session-1");
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", id: "u1" }),
      expect.objectContaining({ role: "assistant", id: "a1", parts: [{ type: "text", text: "still working" }] }),
    ]);
    expect(messages[1]).not.toHaveProperty("completed");
  });

  it("restores persisted reasoning and folds tool-preface text into the reasoning lane", async () => {
    const { fetchImpl } = rpcFetch([
      { event: { type: "assistant/message", seq: 1, data: { message: { id: "a1", content: [
        { type: "reasoning", text: "private analysis" },
        { type: "text", text: "public answer" },
        { type: "tool-call", id: "call-1", name: "read", arguments: "{\"path\":\"README.md\"}" },
      ] } } } },
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.getMessages("session-1")).resolves.toEqual([
      expect.objectContaining({ parts: [
        { type: "reasoning", text: "private analysis" },
        { type: "reasoning", text: "public answer" },
        expect.objectContaining({ type: "tool", tool: "read" }),
      ] }),
    ]);
  });

  it("lists only durable child entries from the DSH subagent catalog", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);
    await expect(client.listSubagents("session-1")).resolves.toEqual([
      { id: "child-1", mode: "continuable", activity: "running", label: "Review the data", hasChildren: false },
    ]);
    expect(calls.at(-1)?.body).toMatchObject({ method: "subagent.list", payload: { parentSessionId: "session-1" } });
  });

  it("uses the cost-meter Typert RPC surface without exposing its ledger file", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.getCostMeterState()).resolves.toMatchObject({ today: { calls: 1 } });
    await client.updateCostMeterConfig({ budget: { enabled: true } });
    await client.fetchCostMeterPrices();
    await client.refreshCostMeterBalance();
    await client.refreshCostMeterGoQuota();
    await client.resetCostMeterHistory();

    expect(calls.slice(-6).map(({ body }) => ({ method: body.method, payload: body.payload }))).toEqual([
      { method: "costMeter/getState", payload: { args: {} } },
      {
        method: "costMeter/updateConfig",
        payload: { args: { patch: { budget: { enabled: true } } } },
      },
      { method: "costMeter/fetchPrices", payload: { args: {} } },
      { method: "costMeter/refreshBalance", payload: { args: {} } },
      { method: "costMeter/refreshGoQuota", payload: { args: {} } },
      { method: "costMeter/resetHistory", payload: { args: {} } },
    ]);
  });

  it("forks a DSH session for delegated work and preserves the requested title", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.createSession("Review", "session-1")).resolves.toBe("child-1");
    expect(calls[0]?.body).toMatchObject({ method: "session.fork", payload: { sessionId: "session-1" } });
    expect(calls[1]?.body).toMatchObject({ method: "session.rename", payload: { sessionId: "child-1", title: "Review" } });
  });

  it("exposes the bundled DeepSeek default from the public host description", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.getDefaultModel()).resolves.toBe("deepseek-official/deepseek-v4-flash");
    expect(calls[calls.length - 1]?.body).toMatchObject({ method: "host.describe", payload: {} });
    expect(calls.some((call) => call.body.method === "settings.describe")).toBe(false);
  });

  it("keeps the bundled DeepSeek route in the model catalog", async () => {
    const { fetchImpl } = rpcFetch();
    const client = makeClient(async (input, init) => {
      const response = await fetchImpl(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (body.method === "llm.models") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: { groups: [
            { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }] },
            { id: "openai", name: "OpenAI", models: [{ id: "gpt-5", name: "GPT-5" }] },
          ] } },
        });
      }
      return response;
    });

    await expect(client.listProviders()).resolves.toEqual([
      { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", variants: [] }] },
      { id: "openai", name: "OpenAI", models: [{ id: "gpt-5", name: "GPT-5", variants: [] }] },
    ]);
  });

  it("only returns provider models whose configured credential is present", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(async (input, init) => {
      const response = await fetchImpl(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const value = body.method === "llm.models"
        ? {
            groups: [
              { id: "opencode-go", name: "OpenCode Go", models: [{ id: "qwen3.7-max", name: "Qwen3.7 Max" }] },
              { id: "openai", name: "OpenAI", models: [{ id: "gpt-5", name: "GPT-5" }] },
            ],
          }
        : body.method === "llm.providers"
          ? {
              providers: [
                {
                  provider: "opencode-go",
                  displayName: "OpenCode Go",
                  settingsNs: "llm-pi-ai",
                  settingsPath: ["providers", "opencode-go"],
                  active: true,
                },
                {
                  provider: "openai",
                  displayName: "OpenAI",
                  settingsNs: "llm-pi-ai",
                  settingsPath: ["providers", "openai"],
                  active: true,
                },
              ],
            }
          : body.method === "settings.describe"
            ? {
                namespaces: [{
                  ns: "llm-pi-ai",
                  value: {
                    providers: {
                      "opencode-go": { apiKeyEnv: "OPENCODE_GO_API_KEY" },
                      openai: { apiKeyEnv: "OPENAI_API_KEY" },
                    },
                  },
                }],
              }
            : body.method === "credentials.describe"
              ? {
                  credentials: {
                    OPENCODE_GO_API_KEY: { configured: true, writable: true },
                    OPENAI_API_KEY: { configured: false, writable: true },
                  },
                }
              : undefined;
      if (value !== undefined) {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value },
        });
      }
      return response;
    });

    await expect(client.listConfiguredProviders()).resolves.toEqual([
      {
        id: "opencode-go",
        name: "OpenCode Go",
        models: [{ id: "qwen3.7-max", name: "Qwen3.7 Max", variants: [] }],
      },
    ]);
    expect(calls.map((call) => call.body.method)).toContain("credentials.describe");
  });

  it("removes a catalog provider profile as well as its credential", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(async (input, init) => {
      const response = await fetchImpl(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (body.method === "llm.providers") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              providers: [{
                provider: "opencode-go",
                displayName: "OpenCode Go",
                settingsNs: "llm-pi-ai",
                settingsPath: ["providers", "opencode-go"],
                active: true,
                declared: false,
              }],
            },
          },
        });
      }
      if (body.method === "settings.describe") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              namespaces: [{
                ns: "llm-pi-ai",
                value: { providers: { "opencode-go": { apiKeyEnv: "NEBULAMAT_OPENCODE_GO_API_KEY" } } },
              }],
            },
          },
        });
      }
      return response;
    });

    await expect(client.removeProviderAuth("opencode-go")).resolves.toBeUndefined();
    expect(calls.map((call) => call.body.method)).toEqual([
      "llm.providers",
      "settings.describe",
      "credentials.unset",
      "settings.describe",
      "settings.mutate",
    ]);
    expect(calls.at(-1)?.body).toMatchObject({
      method: "settings.mutate",
      payload: {
        ns: "llm-pi-ai",
        ops: [{ op: "unset", path: ["providers", "opencode-go"] }],
      },
    });
  });

  it("keeps a credential write successful while the settings namespace is unavailable", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(async (input, init) => {
      const response = await fetchImpl(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (body.method === "llm.providers") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              providers: [{
                provider: "opencode-go",
                displayName: "OpenCode Go",
                settingsNs: "llm-pi-ai",
                settingsPath: ["providers", "opencode-go"],
              }],
            },
          },
        });
      }
      if (body.method === "settings.describe") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: { namespaces: [] } },
        });
      }
      return response;
    });

    await expect(client.setProviderApiKey("opencode-go", "sk-test")).resolves.toBeUndefined();
    expect(calls.map((call) => call.body.method)).toEqual([
      "llm.providers",
      "settings.describe",
      "credentials.set",
      "settings.describe",
    ]);
    expect(calls.some((call) => call.body.method === "settings.mutate")).toBe(false);
  });

  it("writes credentials for the bundled DeepSeek provider", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(async (input, init) => {
      const response = await fetchImpl(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (body.method === "llm.providers") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              providers: [{
                provider: "deepseek-official",
                displayName: "DeepSeek",
                settingsNs: "llm-deepseek",
                settingsPath: [],
                active: true,
              }],
            },
          },
        });
      }
      if (body.method === "settings.describe") {
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              namespaces: [{
                ns: "llm-deepseek",
                value: { apiKeyEnv: "DEEPSEEK_API_KEY" },
              }],
            },
          },
        });
      }
      return response;
    });

    await expect(client.setProviderApiKey("deepseek-official", "sk-test")).resolves.toBeUndefined();
    expect(calls.map((call) => call.body.method)).toEqual([
      "llm.providers",
      "settings.describe",
      "credentials.set",
      "settings.describe",
    ]);
    expect(calls[2]?.body).toMatchObject({
      method: "credentials.set",
      payload: { ref: "DEEPSEEK_API_KEY", value: "sk-test" },
    });
  });

  it("allows selecting the bundled DeepSeek route", async () => {
    const { fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);
    await expect(client.setDefaultModel("deepseek-official/deepseek-v4-flash"))
      .resolves.toBeUndefined();
  });

  it("sets the default model through DSH session.selectModel", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.setDefaultModel("opencode-go/qwen3.7-max")).resolves.toBeUndefined();
    expect(calls.map((call) => call.body.method)).toEqual(["session.list", "session.create", "session.selectModel"]);
    expect(calls[2]?.body).toMatchObject({
      method: "session.selectModel",
      payload: { sessionId: "session-1", provider: "opencode-go", model: "qwen3.7-max" },
    });
    expect(calls.some((call) => call.body.method === "settings.mutate")).toBe(false);
    await expect(client.getDefaultModel()).resolves.toBe("opencode-go/qwen3.7-max");
  });

  it("exposes plan mode only when a mounted preset contains the DSH plan module", async () => {
    const { fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);

    await expect(client.listAgents()).resolves.toEqual([
      { name: "standard", description: "Standard", mode: "primary" },
      { name: "plan", description: "DSH plan mode", mode: "primary" },
    ]);
  });

  it("opens the two official WebSocket downlinks and responds to questions", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));

    const connecting = client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances.forEach((socket) => socket.open());
    await connecting;

    expect(FakeWebSocket.instances.map((socket) => new URL(socket.url).pathname).sort()).toEqual([
      "/api/events.host",
      "/api/events.mux",
    ]);
    expect(FakeWebSocket.instances.every((socket) => new URL(socket.url).searchParams.get("token") === "gateway-token")).toBe(true);

    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "question-rpc",
      method: "question/requested",
      payload: { type: "question/requested", sessionId: "session-1", questions: [{ id: "choice", question: "Continue?", options: [{ label: "Yes" }] }] },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "question.asked", requestId: "question-rpc" }));

    const mux = FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"));
    mux?.message({
      type: "server-request",
      rpcId: "projection-rpc",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "session/projection",
          seq: 10,
          key: "contextPressure",
          value: { pressureTokens: 700, projectedTokens: 760, contextWindow: 4096 },
        },
      },
    });
    mux?.message({
      type: "server-request",
      rpcId: "breakdown-rpc",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "session/projection",
          seq: 11,
          key: "contextBreakdown",
          value: { systemTokens: 100, toolsTokens: 200, messageTokens: 460 },
        },
      },
    });
    // The real DSH mux emits projection changes as a top-level payload frame,
    // rather than wrapping them in session/event.
    mux?.message({
      type: "server-request",
      rpcId: "direct-projection-rpc",
      method: "session/projection",
      payload: {
        type: "session/projection",
        sessionId: "session-1",
        key: "tokenUsage",
        value: { uncachedInputTokens: 900, outputTokens: 120 },
        seq: 12,
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "context.updated",
      sessionId: "session-1",
      usage: expect.objectContaining({ usedTokens: 760, contextWindow: 4096, asOfSeq: 10 }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "context.updated",
      sessionId: "session-1",
      usage: expect.objectContaining({ systemTokens: 100, toolsTokens: 200, messageTokens: 460, asOfSeq: 11 }),
    }));

    const compactionFrame = {
      type: "server-request",
      rpcId: "compaction-rpc",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "compaction/summary",
          seq: 12,
          data: { compactionId: "compact-1", shadowedTokenCount: 500 },
        },
      },
    };
    mux?.message(compactionFrame);
    mux?.message({ ...compactionFrame, rpcId: "compaction-rpc-duplicate" });
    expect(events.filter((event) => (event as { type?: string }).type === "session.compacted")).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "session.compacted",
      sessionId: "session-1",
      auto: true,
      compactionId: "compact-1",
      shadowedTokenCount: 500,
    }));

    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "user-message",
      method: "session/event",
      payload: { type: "session/event", sessionId: "session-1", event: { type: "user/message", seq: 1, data: { id: "live-user-1", content: [{ type: "text", text: "hello" }], source: { kind: "user" } } } },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "message.agent",
      sessionId: "session-1",
      messageID: "live-user-1",
    }));

    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "event-rpc",
      method: "session/event",
      payload: { type: "session/event", sessionId: "session-1", event: { type: "tool/call", seq: 3, data: { callId: "call-1", name: "bash", arguments: '{"command":"pwd"}' } } },
    });
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "event-rpc-2",
      method: "session/event",
      payload: { type: "session/event", sessionId: "session-1", event: { type: "tool/result", seq: 4, data: { message: { source: { kind: "tool", callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "C:/work" }], isError: false }] } } } },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.updated",
      tool: "bash",
      callId: "call-1",
      status: "success",
      output: "C:/work",
      executionBoundary: "observed",
      eventId: expect.stringMatching(/^dsh-tool_/),
    }));

    for (const [rpcId, text] of [["chunk-1", "I'll inspect "], ["chunk-2", "the MatterGen environment."]]) {
      FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
        type: "server-request",
        rpcId,
        method: "session/event",
        payload: { type: "session/event", sessionId: "session-1", event: { type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "text-delta", index: 0, text } } } },
      });
    }
    expect(events).toContainEqual(expect.objectContaining({
      type: "progress.updated",
      partId: "dsh-1-2-0-text",
      text: "Inspecting the MatterGen environment…",
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "reasoning.updated",
      partId: "dsh-1-2-0-text",
    }));
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "private-reasoning",
      method: "session/event",
      payload: { type: "session/event", sessionId: "session-1", event: { type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 0, text: "private analysis" } } } },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "reasoning.updated",
      partId: "dsh-1-2-0-reasoning",
      text: "private analysis",
    }));
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "visible-reasoning",
      method: "session/event",
      payload: { type: "session/event", sessionId: "session-1", event: { type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 0, text: " I am checking the workspace" } } } },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "progress.updated",
      partId: "dsh-1-2-0-reasoning",
      text: "Checking the workspace…",
    }));
    for (const [rpcId, text] of [["progress-chunk-1", "我来分析"], ["progress-chunk-2", " NiPt 催化剂的 HER 机理。"]]) {
      FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
        type: "server-request",
        rpcId,
        method: "session/event",
        payload: { type: "session/event", sessionId: "session-1", event: { type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 1, text } } } },
      });
    }
    expect(events).toContainEqual(expect.objectContaining({
      type: "progress.updated",
      partId: "dsh-1-2-1-reasoning",
      text: "正在分析…",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "progress.updated",
      partId: "dsh-1-2-1-reasoning",
      text: "正在分析 NiPt 催化剂的 HER 机理…",
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "reasoning.updated",
      partId: "dsh-1-2-1-reasoning",
    }));
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "final-answer",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "assistant/message",
          seq: 6,
          data: { turn: 1, step: 3, message: { id: "answer-1", content: [{ type: "text", text: "Final answer" }] } },
        },
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "text.updated",
      partId: "dsh-1-3-0-text",
      text: "Final answer",
    }));
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "legacy-preface",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "assistant/message",
          seq: 7,
          data: { turn: 1, step: 4, message: { id: "preface-1", content: [{ type: "text", text: "Let me inspect the file" }] } },
        },
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "text.updated",
      partId: "dsh-1-4-0-text",
      text: "Let me inspect the file",
    }));
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "legacy-tool-call",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "tool/call",
          seq: 8,
          data: { turn: 1, step: 4, callId: "legacy-call", name: "read", arguments: "{\"path\":\"README.md\"}" },
        },
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "progress.updated",
      partId: "dsh-1-4-0-text",
      text: "Inspecting the file…",
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "reasoning.updated",
      partId: "dsh-1-4-0-text",
    }));

    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "plan-mode",
      method: "session/event",
      payload: { type: "session/event", sessionId: "session-1", event: { type: "plan/mode", data: { active: true } } },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "message.agent", sessionId: "session-1", agent: "plan" }));

    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "task-rpc",
      method: "session/event",
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          type: "tool/call",
          seq: 5,
          data: {
            callId: "task-1",
            name: "task",
            arguments: '{"description":"inspect candidates"}',
            metadata: { sessionId: "child-1" },
          },
        },
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.updated",
      tool: "task",
      callId: "task-1",
      childSessionId: "child-1",
    }));

    await client.answerQuestion("question-rpc", [["Yes"]]);
    const response = calls.find((call) => call.url.endsWith("/api/respond"));
    expect(response?.body).toEqual({
      type: "client-response",
      rpcId: "question-rpc",
      result: { ok: true, value: { sessionId: "session-1", answer: { answers: [{ id: "choice", selected: ["Yes"] }] } } },
    });
    await client.sendPrompt("session-1", "inspect the workspace", "plan");
    const planPrompt = calls.find((call) => call.body.method === "session.prompt");
    expect(planPrompt?.body).toMatchObject({
      payload: { sessionId: "session-1", content: [{ type: "text", text: expect.stringContaining("/plan inspect the workspace") }] },
    });
    expect((planPrompt?.body.payload as { content: [{ text: string }] }).content[0].text)
      .toContain("mcp__browser-control__agent_browser_open");
    await client.runShell("session-1", "pwd");
    const shellPrompt = calls.filter((call) => call.body.method === "session.prompt").at(-1);
    expect((shellPrompt?.body.payload as { content: [{ text: string }] }).content[0].text).toBe("! pwd");
    client.close();
  });

  it("reopens both event streams after one established stream closes", async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl } = rpcFetch();
      const client = makeClient(fetchImpl);
      const statuses: string[] = [];
      client.onStatus((status) => statuses.push(status));

      const connecting = client.connect();
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
      FakeWebSocket.instances.forEach((socket) => socket.open());
      await connecting;

      FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.close();
      await vi.waitFor(() => expect(client.getStatus()).toBe("connecting"));
      await vi.advanceTimersByTimeAsync(250);
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(4));
      FakeWebSocket.instances.slice(2).forEach((socket) => socket.open());
      await vi.waitFor(() => expect(client.getStatus()).toBe("ready"));

      expect(statuses).toEqual(["connecting", "ready", "connecting", "ready"]);
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reconnect a stream that was explicitly closed", async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl } = rpcFetch();
      const client = makeClient(fetchImpl);
      const connecting = client.connect();
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
      FakeWebSocket.instances.forEach((socket) => socket.open());
      await connecting;

      FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.close();
      await vi.waitFor(() => expect(client.getStatus()).toBe("connecting"));
      client.close();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(client.getStatus()).toBe("offline");
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the requested locale to model-visible output and hides the policy on reload", async () => {
    const { calls, fetchImpl } = rpcFetch([
      { event: { type: "user/message", seq: 1, data: { id: "u1", content: [{ type: "text", text: "请检查工作区\n\n[NEBULAMAT_INTERNAL_RESEARCH_CONTEXT]\nresearchId: research-1\ngraphHash: abc123\n[/NEBULAMAT_INTERNAL_RESEARCH_CONTEXT]\n\n[NEBULAMAT_INTERNAL_LANGUAGE_POLICY]\nLanguage policy (highest priority):\n- Use Simplified Chinese (zh-Hans) for all user-visible natural-language output in this turn.\n[/NEBULAMAT_INTERNAL_LANGUAGE_POLICY]" }], source: { kind: "user" } } } },
    ]);
    const client = makeClient(fetchImpl);
    const connecting = client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances.forEach((socket) => socket.open());
    await connecting;

    await client.sendPrompt("session-1", "请检查工作区", undefined, undefined, undefined, "zh-Hans");
    const prompt = calls.find((call) => call.body.method === "session.prompt");
    expect(prompt?.body).toMatchObject({
      payload: {
        sessionId: "session-1",
        content: [{ type: "text", text: expect.stringContaining("Use Simplified Chinese (zh-Hans)") }],
      },
    });
    expect((prompt?.body.payload as { content: [{ text: string }] }).content[0].text).toContain("请检查工作区");
    expect((prompt?.body.payload as { content: [{ text: string }] }).content[0].text).toContain("Never reveal private chain-of-thought");
    expect((prompt?.body.payload as { content: [{ text: string }] }).content[0].text).toContain("about every 15 seconds");
    expect((prompt?.body.payload as { content: [{ text: string }] }).content[0].text)
      .toContain("Never call the built-in web_search or web_fetch tools");

    await client.runCommand("session-1", "materials-run", "生成 NiFePt 结构", "zh-CN");
    const commandPrompt = calls.filter((call) => call.body.method === "session.prompt").at(-1);
    expect(commandPrompt?.body).toMatchObject({
      payload: {
        sessionId: "session-1",
        content: [{ type: "text", text: expect.stringContaining("Use Simplified Chinese (zh-Hans)") }],
      },
    });
    expect((commandPrompt?.body.payload as { content: [{ text: string }] }).content[0].text)
      .toContain('pass response_language="zh-Hans" to create_materials_workflow');
    expect((commandPrompt?.body.payload as { content: [{ text: string }] }).content[0].text)
      .toContain("Materials skill text, tool descriptions, filenames, and scientific source material");

    await expect(client.getMessages("session-1")).resolves.toEqual([
      expect.objectContaining({ role: "user", id: "u1", parts: [{ type: "text", text: "请检查工作区" }] }),
    ]);
    client.close();
  });

  it("sends steering through the next-step inbox without starting a turn", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));
    const connecting = client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances.forEach((socket) => socket.open());
    await connecting;

    await client.steerSession("session-1", "优先检查吸附能不确定性", "zh-Hans");
    const steer = calls.find((call) => call.body.method === "session.prompt");
    expect(steer?.body).toMatchObject({
      method: "session.prompt",
      payload: {
        sessionId: "session-1",
        mode: "steer",
        content: [{ type: "text", text: expect.stringContaining("优先检查吸附能不确定性") }],
      },
    });
    expect(events.some((event) => (event as { type?: string }).type === "turn.started")).toBe(false);
    client.close();
  });

  it("rejects governed DSH work at approval/requested before execution", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);
    const runtimeEvents: unknown[] = [];
    const messageEvents: unknown[] = [];
    client.onRuntimeEvent((event) => runtimeEvents.push(event));
    client.onEvent((event) => messageEvents.push(event));
    client.registerToolGuard(() => ({
      decision: "require-human-approval",
      reason: "DFT submission manifest is not approved",
    }));

    const connecting = client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances.forEach((socket) => socket.open());
    await connecting;

    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "approval-rpc",
      method: "approval/requested",
      payload: {
        type: "approval/requested",
        sessionId: "session-1",
        approvalId: "approval-1",
        toolName: "bash",
        input: { command: "sbatch run.slurm" },
      },
    });

    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/respond"))).toBe(true));
    expect(runtimeEvents).toContainEqual(expect.objectContaining({
      type: "tool.pre",
      decision: "require-human-approval",
      boundary: "pre-execution",
    }));
    expect(messageEvents).not.toContainEqual(expect.objectContaining({ type: "permission.asked" }));
    expect(calls.find((call) => call.url.endsWith("/api/respond"))?.body).toMatchObject({
      result: { value: { approvalId: "approval-1", outcome: "rejected" } },
    });
    client.close();
  });

  it("evaluates the DSH approval frame before exposing a tool request", async () => {
    const { calls, fetchImpl } = rpcFetch();
    const client = makeClient(fetchImpl);
    const events: unknown[] = [];
    client.onRuntimeEvent((event) => events.push(event));
    client.registerToolGuard(() => ({ decision: "block", reason: "DFT manifest missing" }));

    const connecting = client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances.forEach((socket) => socket.open());
    await connecting;
    FakeWebSocket.instances.find((socket) => socket.url.includes("events.mux"))?.message({
      type: "server-request",
      rpcId: "approval-rpc",
      method: "approval/requested",
      payload: { type: "approval/requested", sessionId: "session-1", approvalId: "approval-1", toolName: "bash", input: { command: "sbatch run.slurm" } },
    });

    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/respond"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/api/respond"))?.body).toMatchObject({
      result: { value: { outcome: "rejected", reason: "DFT manifest missing" } },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.pre", decision: "block", boundary: "pre-execution" }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: "permission.asked" }));
    client.close();
  });
});
