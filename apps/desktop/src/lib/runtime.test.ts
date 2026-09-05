import { describe, expect, it } from "vitest";
import type { RuntimeMessageEvent, HistoryMessage } from "@ai4s/sdk";
import { AUTO_REVIEW_PROMPT } from "./autoReview";
import {
  datedWorkspaceName,
  explainRuntimeError,
  foldCarriageReturns,
  foldEvent,
  historyToThread,
  humanizeCommand,
  lastAgentMode,
  redactForLog,
  subagentActivity,
  stripPrivateReasoning,
  tidyToolTitle,
  toolPresentation,
  type FoldState,
} from "./runtime";

const empty: FoldState = { blocks: [], index: {} };
const S = "ses_1";
const foldAll = (events: RuntimeMessageEvent[], from: FoldState = empty): FoldState =>
  events.reduce((s, e) => foldEvent(s, e), from);

describe("tidyToolTitle", () => {
  it("shows workspace files by their relative path", () => {
    expect(tidyToolTitle("/Users/asq/Documents/OpenScience/demo/analyze.py")).toBe("demo/analyze.py");
    expect(tidyToolTitle("mkdir -p /Users/asq/Documents/OpenScience/demo_analysis")).toBe(
      "mkdir -p demo_analysis",
    );
    // OpenCode's write-tool titles drop the leading slash — must still relativize.
    expect(tidyToolTitle("Users/asq/Documents/OpenScience/demo_analysis/analyze.py")).toBe(
      "demo_analysis/analyze.py",
    );
  });
  it("leaves non-workspace titles unchanged", () => {
    expect(tidyToolTitle("search (done)")).toBe("search (done)");
    expect(tidyToolTitle("python3 -c \"import numpy\"")).toBe('python3 -c "import numpy"');
  });
});

describe("humanizeCommand", () => {
  it("strips leading cd hops so the real command leads", () => {
    expect(
      humanizeCommand("cd output/experiment-suite/very/long/path && python train.py --mode teacher"),
    ).toBe("python train.py --mode teacher");
    expect(humanizeCommand("cd /a/b; cd c && ls -la")).toBe("ls -la");
    expect(humanizeCommand('cd "dir with spaces" && make test')).toBe("make test");
  });
  it("collapses whitespace but leaves cd-less commands intact", () => {
    expect(humanizeCommand("git  status\n  --short")).toBe("git status --short");
  });
  it("a bare cd keeps the command (nothing better to show)", () => {
    expect(humanizeCommand("cd demo")).toBe("cd demo");
  });
});

describe("foldCarriageReturns", () => {
  it("keeps only what each line last drew (tqdm-style redraws)", () => {
    expect(foldCarriageReturns("epoch 1:  10%\repoch 1:  50%\repoch 1: 100%\ndone")).toBe(
      "epoch 1: 100%\ndone",
    );
    expect(foldCarriageReturns("plain\ntext")).toBe("plain\ntext");
  });
});

describe("stripPrivateReasoning", () => {
  it("removes complete reasoning tags while preserving the answer", () => {
    expect(stripPrivateReasoning("<think>internal plan</think>Final answer")).toBe("Final answer");
    expect(stripPrivateReasoning("before <analysis>hidden</analysis> after")).toBe("before  after");
  });

  it("hides an incomplete reasoning tag until the stream closes", () => {
    expect(stripPrivateReasoning("<thinking>still private")).toBe("");
    expect(stripPrivateReasoning("Visible\n<reasoning>still private")).toBe("Visible\n");
  });
});

describe("toolPresentation", () => {
  it("bash: verb Ran + de-noised command, over the model's description", () => {
    expect(toolPresentation("bash", "install deps", { command: "cd x && pip install numpy" })).toEqual({
      verb: "Ran",
      title: "pip install numpy",
    });
  });
  it("file tools: verb + relative path", () => {
    expect(
      toolPresentation("write", "", { filePath: "/Users/asq/Documents/OpenScience/demo/train.py" }),
    ).toEqual({ verb: "Created", title: "demo/train.py" });
    expect(toolPresentation("edit", "", { filePath: "config.yaml" })).toEqual({
      verb: "Edited",
      title: "config.yaml",
    });
  });
  it("unknown tools keep the old fallback chain, no verb", () => {
    expect(toolPresentation("mcp_thing", "did something", {})).toEqual({ title: "did something" });
    expect(toolPresentation("mcp_thing", "", {})).toEqual({ title: "mcp_thing" });
  });
});

describe("datedWorkspaceName", () => {
  it("formats a zero-padded YYYY-MM-DD-HHMM folder name", () => {
    expect(datedWorkspaceName(new Date(2026, 6, 4, 16, 5))).toBe("2026-07-04-1605");
    expect(datedWorkspaceName(new Date(2026, 0, 9, 3, 40))).toBe("2026-01-09-0340");
  });
});

describe("foldEvent", () => {
  it("upserts a text part by id (idempotent full-text updates, not appends)", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "Planning" },
      { type: "text.updated", sessionId: S, partId: "p1", text: "Planning the review" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toEqual({ kind: "agent", markdown: "Planning the review" });
  });

  it("folds streamed reasoning into a dedicated block", () => {
    const s = foldAll([
      { type: "reasoning.updated", sessionId: S, partId: "r1", text: "Let me" },
      { type: "reasoning.updated", sessionId: S, partId: "r1", text: "Let me check the data" },
    ]);
    expect(s.blocks).toEqual([{ kind: "reasoning", text: "Let me check the data" }]);
  });

  it("keeps only the final answer when reasoning events precede it", () => {
    const s = foldAll([
      { type: "reasoning.updated", sessionId: S, partId: "r1", text: "Thinking…" },
      { type: "text.updated", sessionId: S, partId: "p1", text: "Here is the answer" },
    ]);
    expect(s.blocks).toEqual([
      { kind: "reasoning", text: "Thinking…" },
      { kind: "agent", markdown: "Here is the answer" },
    ]);
  });

  it("shows one concise live progress line and replaces it with the final answer", () => {
    const working = foldAll([
      { type: "reasoning.updated", sessionId: S, partId: "r1", text: "private deliberation" },
      { type: "progress.updated", sessionId: S, partId: "p1", text: "正在检查 MatterGen 环境…" },
      { type: "progress.updated", sessionId: S, partId: "p1", text: "正在验证 MatterGen 检查点…" },
    ]);
    expect(working.blocks).toEqual([
      { kind: "reasoning", text: "private deliberation" },
      { kind: "status-line", text: "正在验证 MatterGen 检查点…", tone: "running" },
    ]);

    const done = foldAll([
      { type: "text.updated", sessionId: S, partId: "answer", text: "MatterGen 环境可用。" },
    ], working);
    expect(done.blocks).toEqual([
      { kind: "reasoning", text: "private deliberation" },
      { kind: "agent", markdown: "MatterGen 环境可用。" },
    ]);
  });

  it("replaces a legacy provisional action answer instead of duplicating it", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "Let me inspect the file" },
      { type: "progress.updated", sessionId: S, partId: "p1", text: "Inspecting the file…" },
    ]);
    expect(s.blocks).toEqual([
      { kind: "status-line", text: "Inspecting the file…", tone: "running" },
    ]);
  });

  it("keeps live progress after later tools and reasoning", () => {
    const s = foldAll([
      { type: "progress.updated", sessionId: S, partId: "p1", text: "正在检查环境…" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "bash", status: "running", title: "pwd" },
      { type: "reasoning.updated", sessionId: S, partId: "r1", text: "private" },
    ]);
    expect(s.blocks.map((block) => block.kind)).toEqual(["tool-call", "reasoning", "status-line"]);
    expect(s.blocks[s.blocks.length - 1]).toEqual({ kind: "status-line", text: "正在检查环境…", tone: "running" });
  });

  it("removes a temporary progress line when the turn ends without an answer", () => {
    const s = foldAll([
      { type: "progress.updated", sessionId: S, partId: "p1", text: "正在等待外部任务…" },
      { type: "session.idle", sessionId: S },
    ]);
    expect(s.blocks).toEqual([{ kind: "status-line", text: "done", tone: "done" }]);
  });

  it("settles a tool whose final status arrives after session idle", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "running", title: "papers" },
      { type: "tool.updated", sessionId: S, callId: "c2", tool: "read", status: "pending", title: "paper.pdf" },
      { type: "session.idle", sessionId: S },
    ]);
    expect(s.blocks.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "tool-call", status: "pending", title: "papers" }),
      expect.objectContaining({ kind: "tool-call", status: "pending", title: "paper.pdf" }),
    ]);
    expect(s.blocks.some((block) => block.kind === "tool-call" && block.status === "running")).toBe(false);
  });

  it("promotes provisional tool-preface text to the final answer when no tool runs", () => {
    const s = foldAll([
      { type: "reasoning.updated", sessionId: S, partId: "p1", text: "Checking the result" },
      { type: "text.updated", sessionId: S, partId: "p1", text: "The result is ready." },
    ]);
    expect(s.blocks).toEqual([{ kind: "agent", markdown: "The result is ready." }]);
  });

  it("upserts a tool call by callId and reflects status transitions", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "running", title: "search" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "success", title: "search (done)" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", status: "success", title: "search (done)" });
  });

  it("places an inline presentation immediately after its completed tool call", () => {
    const event: RuntimeMessageEvent = {
      type: "tool.updated",
      sessionId: S,
      callId: "present-1",
      tool: "present_artifact",
      status: "success",
      input: {
        path: "figures/result.png",
        display: "inline",
        title: "Result",
      },
    };
    const once = foldEvent(empty, event);
    const twice = foldEvent(once, event);
    expect(twice.blocks).toHaveLength(2);
    expect(twice.blocks[1]).toMatchObject({
      kind: "artifact",
      path: "figures/result.png",
      presentation: { mode: "inline", title: "Result" },
    });
  });

  it("does not render interactive question/permission tools as thread rows", () => {
    // These are surfaced by InteractionPrompt (answerable), not as blank rows.
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "q1", tool: "question", status: "running", title: "" },
      { type: "tool.updated", sessionId: S, callId: "p1", tool: "permission", status: "running", title: "" },
    ]);
    expect(s.blocks).toHaveLength(0);
  });

  it("drops opaque todo tool rows from the conversation", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "t1", tool: "todowrite", status: "success", title: "4 todos" },
    ]);
    expect(s.blocks).toHaveLength(0);
  });

  it("never blanks a tool row when the completed event reports an empty title", () => {
    // Completed MCP tool parts carry title: "" — the tool name must survive.
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "jupyter_insert_cell", status: "running" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "jupyter_insert_cell", status: "success", title: "" },
    ]);
    expect(s.blocks[0]).toMatchObject({
      kind: "tool-call",
      status: "success",
      title: "jupyter_insert_cell",
    });
  });

  it("shows the file path for a file tool that has no title yet", () => {
    // OpenCode only sets a write/edit tool's title on completion — while the
    // tool runs, the file path in its input is the only thing worth showing.
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "write", status: "running", input: { filePath: "/Users/asq/Documents/OpenScience/2026-07-04/index.html", content: "<!doctype html>" } },
    ]);
    expect(s.blocks[0]).toMatchObject({
      kind: "tool-call",
      status: "running",
      title: "2026-07-04/index.html",
    });
  });

  it("surfaces a written file as an artifact block, deduped by path", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "write", status: "running", input: { filePath: "fig.py" } },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "write", status: "success", input: { filePath: "fig.py", content: "print(1)" } },
    ]);
    const artifacts = s.blocks.filter((b) => b.kind === "artifact");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "artifact", filename: "fig.py", artifact: "script", content: "print(1)" });
    // The tool-call row is still present alongside the artifact.
    expect(s.blocks.some((b) => b.kind === "tool-call")).toBe(true);
  });

  it("carries a running bash step's live output tail, \\r-folded; completion clears it", () => {
    const s1 = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "bash", status: "running", input: { command: "python train.py" }, startedAt: 1000, partialOutput: "epoch 1:  10%\repoch 1:  50%\n" },
    ]);
    expect(s1.blocks[0]).toMatchObject({
      kind: "tool-call",
      title: "python train.py",
      verb: "Ran",
      status: "running",
      partialOutput: "epoch 1:  50%\n",
      startedAt: 1000,
    });
    const s2 = foldAll(
      [{ type: "tool.updated", sessionId: S, callId: "c1", tool: "bash", status: "success", input: { command: "python train.py" }, output: "epoch 1: 100%\ndone\n", endedAt: 5000 }],
      s1,
    );
    expect(s2.blocks[0]).toMatchObject({
      kind: "tool-call",
      status: "success",
      output: "epoch 1: 100%\ndone",
      // startedAt survives from the running event; the tail is gone.
      startedAt: 1000,
      endedAt: 5000,
    });
    expect(s2.blocks[0]).not.toHaveProperty("partialOutput");
  });

  it("keeps distinct parts as separate blocks in arrival order", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "planning" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "success" },
      { type: "text.updated", sessionId: S, partId: "p2", text: "done" },
      { type: "session.idle", sessionId: S },
    ]);
    expect(s.blocks.map((b) => b.kind)).toEqual(["agent", "tool-call", "agent", "status-line"]);
  });

  it("deduplicates repeated session idle events", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "done" },
      { type: "session.idle", sessionId: S },
      { type: "session.idle", sessionId: S },
    ]);
    expect(s.blocks.filter((b) => b.kind === "status-line" && b.tone === "done")).toHaveLength(1);
  });
});

describe("subagent activity", () => {
  it("records the child session id on a task tool block", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "c1",
        tool: "task",
        status: "running",
        title: "Visual QA for slides",
        childSessionId: "ses_child",
      },
    ]);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", childSessionId: "ses_child" });
  });

  it("subagentActivity: shows the child's latest tool step", () => {
    const child = foldAll([
      { type: "tool.updated", sessionId: "ses_child", callId: "k1", tool: "bash", status: "success", title: "pdftoppm -jpeg slides.pdf" },
      { type: "tool.updated", sessionId: "ses_child", callId: "k2", tool: "bash", status: "running", title: "python3 analyze slide-03.jpg" },
    ]);
    expect(subagentActivity(child.blocks)).toBe("python3 analyze slide-03.jpg");
  });

  it("subagentActivity: 'Writing…' while the child is streaming text", () => {
    const child = foldAll([
      { type: "tool.updated", sessionId: "ses_child", callId: "k1", tool: "bash", status: "success", title: "ls" },
      { type: "text.updated", sessionId: "ses_child", partId: "p1", text: "Compiling the final report" },
    ]);
    expect(subagentActivity(child.blocks)).toBe("Writing…");
  });

  it("subagentActivity: 'Working…' when nothing is known yet", () => {
    expect(subagentActivity(undefined)).toBe("Working…");
    expect(subagentActivity([])).toBe("Working…");
  });

  it("keeps the child link when a later update omits it", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "c1",
        tool: "task",
        status: "running",
        title: "Visual QA for slides",
        childSessionId: "ses_child",
      },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "task", status: "running", title: "Visual QA for slides" },
    ]);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", childSessionId: "ses_child" });
  });
});

describe("historyToThread", () => {
  it("converts user/assistant messages (text + tool parts) into blocks", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "planning" },
          { type: "tool", tool: "search", state: { status: "completed", title: "search" } },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks.map((b) => b.kind)).toEqual(["user", "agent", "tool-call"]);
    expect(t.blocks[2]).toMatchObject({ kind: "tool-call", status: "success" });
  });

  it("restores reasoning parts on reload as folded reasoning blocks", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Let me think about this" },
          { type: "text", text: "Here it is" },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks).toEqual([
      { kind: "user", text: "hi" },
      { kind: "reasoning", text: "Let me think about this" },
      { kind: "agent", markdown: "Here it is" },
    ]);
  });

  it("restores public action parts as visible transcript updates", () => {
    const t = historyToThread([
      { role: "user", parts: [{ type: "text", text: "find the papers" }] },
      { role: "assistant", completed: 1, parts: [{ type: "progress", text: "正在核实两篇奠基性理论文献…" }] },
    ]);
    expect(t.blocks).toEqual([
      { kind: "user", text: "find the papers" },
      { kind: "agent", markdown: "正在核实两篇奠基性理论文献…" },
    ]);
  });

  it("renders a user-run '!' shell turn like the live path: '! cmd' + inline output", () => {
    // OpenCode records a "!" run as a synthetic user text + a bash tool part.
    const msgs: HistoryMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "The following tool was executed by the user", synthetic: true }],
      },
      {
        role: "assistant",
        parts: [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", title: "", input: { command: "pwd" }, output: "/ws/here\n" },
          },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks).toEqual([
      { kind: "user", text: "! pwd" },
      {
        kind: "tool-call",
        title: "pwd",
        verb: "Ran",
        tool: "bash",
        command: "pwd",
        status: "success",
        output: "/ws/here",
        outputSummary: "/ws/here",
      },
    ]);
  });

  it("shows a failed turn's error on reload instead of an unexplained empty reply", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", completed: 2, error: "no channel available for this model", parts: [] },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks).toEqual([
      { kind: "user", text: "hi" },
      { kind: "status-line", text: "no channel available for this model", tone: "error" },
    ]);
  });

  it("keeps user-interrupted turns quiet: an aborted error adds no red line", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", completed: 2, error: "The operation was aborted.", parts: [] },
    ];
    expect(historyToThread(msgs).blocks).toEqual([{ kind: "user", text: "hi" }]);
  });

  it("falls back to the bash command as the row title (agent steps too)", () => {
    const msgs: HistoryMessage[] = [
      {
        role: "assistant",
        parts: [
          { type: "tool", tool: "bash", state: { status: "completed", title: "", input: { command: "ls -la" } } },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks[0]).toMatchObject({ kind: "tool-call", title: "ls -la" });
    // An agent bash step (no synthetic marker) never shows inline output.
    expect(t.blocks[0]).not.toHaveProperty("outputSummary");
  });

  it("never spins in history: frozen running/pending steps become quiet + one interrupted line", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "explore" }] },
      {
        role: "assistant",
        parts: [
          { type: "tool", tool: "read", state: { status: "running", title: "README.md" } },
          { type: "tool", tool: "glob", state: { status: "pending", title: "*.md" } },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks[1]).toMatchObject({ kind: "tool-call", status: "pending" });
    expect(t.blocks[2]).toMatchObject({ kind: "tool-call", status: "pending" });
    const last = t.blocks[t.blocks.length - 1];
    expect(last).toMatchObject({ kind: "status-line", tone: "error" });
  });

  it("does not mark a terminal assistant message interrupted when a stale tool part is still running", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "finish the report" }] },
      {
        role: "assistant",
        completed: 42,
        parts: [{ type: "tool", tool: "write", state: { status: "running", title: "report.md" } }],
      },
    ];
    const blocks = historyToThread(msgs).blocks;
    expect(blocks.some((block) => block.kind === "status-line" && block.tone === "error")).toBe(false);
  });

  it("ignores a stale running part when a later assistant event finished the same turn", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "finish the report" }] },
      {
        role: "assistant",
        parts: [{ type: "tool", tool: "write", state: { status: "running", title: "report.md" } }],
      },
      { role: "assistant", completed: 43, parts: [{ type: "text", text: "Report complete." }] },
    ];
    const blocks = historyToThread(msgs).blocks;
    expect(blocks.some((block) => block.kind === "status-line" && block.tone === "error")).toBe(false);
  });

  it("hides persisted system-reminder messages from the conversation", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      { role: "user", parts: [{ type: "text", text: "<system-reminder>\nAGENTS.md\n</system-reminder>" }] },
      { role: "assistant", completed: 1, parts: [{ type: "text", text: "world" }] },
    ];
    expect(historyToThread(msgs).blocks).toEqual([
      { kind: "user", text: "hello" },
      { kind: "agent", markdown: "world" },
    ]);
  });

  it("hides persisted runtime-context snapshots from the conversation", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      {
        role: "user",
        parts: [{ type: "text", text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: danger-full-access." }],
      },
      { role: "assistant", completed: 1, parts: [{ type: "text", text: "world" }] },
    ];
    expect(historyToThread(msgs).blocks).toEqual([
      { kind: "user", text: "hello" },
      { kind: "agent", markdown: "world" },
    ]);
  });

  it("shows a slash command as what the user typed, not its expanded template", () => {
    // OpenCode stores the EXPANDED command/skill template as the user message,
    // with typed arguments appended — reverse-map via the known templates.
    const template = "\nThis skill guides growth for indie AI products…\n\n## Core Philosophy\n…";
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: template.trim() }] },
      { role: "assistant", parts: [{ type: "text", text: "on it" }] },
      { role: "user", parts: [{ type: "text", text: `${template.trim()}\n\n帮我设计增长方式` }] },
    ];
    const t = historyToThread(msgs, [
      { name: "growth-marketing", source: "skill", template },
    ]);
    expect(t.blocks[0]).toEqual({ kind: "user", text: "/growth-marketing" });
    expect(t.blocks[2]).toEqual({ kind: "user", text: "/growth-marketing 帮我设计增长方式" });
  });

  it("collapses a template whose $ARGUMENTS placeholder sits mid-template (goal plugin)", () => {
    // The goal plugin's command embeds the args INSIDE the template, with a
    // long instruction block after them — prefix/suffix matching around
    // $ARGUMENTS must recover the typed "/goal <args>".
    const template =
      'OpenCode goal mode command "/goal" was invoked.\n\nArguments:\n<goal_command_arguments>\n$ARGUMENTS\n</goal_command_arguments>\n\nUse the goal tools to handle this command:\n- If the arguments are empty, call get_goal…';
    const expanded = template.replace("$ARGUMENTS", "梳理项目，做一个详细剧情docx。");
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: expanded }] },
    ];
    const t = historyToThread(msgs, [{ name: "goal", source: "command", template }]);
    expect(t.blocks[0]).toEqual({ kind: "user", text: "/goal 梳理项目，做一个详细剧情docx。" });
  });

  it("leaves a long pasted user text alone when it matches no template", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "a genuinely long pasted question…" }] },
    ];
    const t = historyToThread(msgs, [{ name: "init", template: "something else" }]);
    expect(t.blocks[0]).toEqual({ kind: "user", text: "a genuinely long pasted question…" });
  });

  it("adds no interrupted line when every step finished", () => {
    const msgs: HistoryMessage[] = [
      {
        role: "assistant",
        parts: [{ type: "tool", tool: "read", state: { status: "completed", title: "README.md" } }],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks.every((b) => b.kind !== "status-line")).toBe(true);
  });

  // #72: the auto-review turn is the app's, not the user's. On reload it must
  // not appear as something the user typed — only the findings it produced.
  it("hides the auto-review prompt but keeps the reviewer's findings", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "run the analysis" }] },
      { role: "assistant", parts: [{ type: "text", text: "done" }] },
      { role: "user", agent: "reviewer", parts: [{ type: "text", text: AUTO_REVIEW_PROMPT }] },
      {
        role: "assistant",
        parts: [
          {
            type: "text",
            text:
              'Reviewed the changed files.\n\n```review\n{"findings":[{"level":"warn","title":"seed not pinned"}]}\n```',
          },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks.map((b) => b.kind)).toEqual(["user", "agent", "agent", "reviewer"]);
    expect(t.blocks[0]).toMatchObject({ text: "run the analysis" });
    expect(t.blocks[3]).toMatchObject({
      kind: "reviewer",
      findings: [{ level: "warn", title: "seed not pinned" }],
    });
  });

  it("also hides an auto-review prompt after shared preparation added context", () => {
    const prepared = `${AUTO_REVIEW_PROMPT}\n\n[NEBULAMAT_INTERNAL_KNOWLEDGE_CONTEXT]\nsource evidence\n[/NEBULAMAT_INTERNAL_KNOWLEDGE_CONTEXT]`;
    const t = historyToThread([
      { role: "user", agent: "reviewer", parts: [{ type: "text", text: prepared }] },
      { role: "assistant", parts: [{ type: "text", text: '```review\n{"findings":[{"level":"warn","title":"check"}]}\n```' }] },
    ]);
    expect(t.blocks.map((b) => b.kind)).toEqual(["reviewer"]);
  });
});

describe("lastAgentMode", () => {
  it("reads the last user message's mode", () => {
    expect(lastAgentMode([{ role: "user", agent: "plan", parts: [] }])).toBe("plan");
    expect(lastAgentMode([{ role: "user", agent: "build", parts: [] }])).toBe("build");
    expect(lastAgentMode([])).toBe("build");
  });

  // An auto-review turn runs on `reviewer`; reading that as Build would drop a
  // session out of Plan mode on reload.
  it("ignores turns that ran on another agent", () => {
    expect(
      lastAgentMode([
        { role: "user", agent: "plan", parts: [] },
        { role: "user", agent: "reviewer", parts: [] },
      ]),
    ).toBe("plan");
  });
});

describe("runtime error explanations", () => {
  it("tells the user why retrying a blocked prompt cannot work", () => {
    // Reproduced from a real report: ChatGPT-Pro (Codex OAuth) answered
    // POST /v1/responses with 400 {"code":"invalid_prompt","message":"Request
    // blocked."}, isRetryable false. "Continue" failed identically three times
    // because the Responses API resends the whole conversation, and only
    // switching provider recovered — none of which the bare message conveys.
    const out = explainRuntimeError("Request blocked.");
    expect(out).toContain("Request blocked."); // the provider's own words survive
    expect(out).toMatch(/content filter/i);
    expect(out).toMatch(/every retry resends the same history/i);
    expect(out).toMatch(/new session|another model/i);
  });

  it("keeps the dangling-model hint and passes anything else through", () => {
    expect(explainRuntimeError("model not found: openai/gone")).toContain(
      "Settings → Models",
    );
    // Not a blanket match: an error that merely mentions blocking is untouched.
    const other = "Upstream blocked the connection at the proxy";
    expect(explainRuntimeError(other)).toBe(other);
  });
});

/** Mirrors LOG_ERROR_MAX in runtime.ts — the cap is internal, the shape is not. */
const LOG_ERROR_CAP = 300;

describe("redactForLog", () => {
  it("strips credentials a provider echoed back", () => {
    expect(redactForLog("bad key sk-abcdef123456 rejected")).not.toContain("abcdef123456");
    expect(redactForLog("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6")).not.toContain("eyJhbGci");
    // Any long opaque run is treated as a secret, whatever its prefix.
    expect(redactForLog(`token ${"a1B2".repeat(12)} invalid`)).toContain("***");
  });

  it("leaves an ordinary message intact but caps a huge one", () => {
    expect(redactForLog("Request blocked.")).toBe("Request blocked.");
    // Prose, not one opaque run — a long run is redacted to "***" long before
    // the cap could apply, so the cap is only reachable with real sentences.
    const long = redactForLog("the upstream provider refused this call. ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(LOG_ERROR_CAP + 1);
    expect(long.endsWith("…")).toBe(true);
  });
});
