import {
  type CommandInfo,
  type HistoryMessage,
  type RuntimeMessageEvent,
  type ToolCallStatus,
  isPublicProgressText,
  summarizeProgressText,
} from "@ai4s/sdk";
import type { ThreadBlock, ToolVerb } from "@ai4s/shared";
import { deriveArtifact, deriveArtifactPresentation } from "./artifacts";
import { splitReview } from "./review";
import { isAutoReviewPrompt } from "./autoReview";

export type AgentMode = "build" | "plan";

export interface FoldState {
  blocks: ThreadBlock[];
  index: Record<string, number>;
}

/** Pure reducer and history projection for the DSH message stream. */

/**
 * Tidy a tool-call title for the conversation: show workspace files by their
 * relative path (`demo/analyze.py`), not the full `/Users/.../OpenScience/...`
 * absolute path, so the thread reads like a researcher's log, not a shell trace.
 */
export function tidyToolTitle(title: string): string {
  return title.replace(/[^\s]*OpenScience\//g, "").trim() || title;
}

/** Collapse shell directory hops from a one-line command title. */
export function humanizeCommand(command: string): string {
  let c = command.replace(/\s+/g, " ").trim();
  for (;;) {
    const m = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/.exec(c);
    if (!m) break;
    c = c.slice(m[0].length);
  }
  return c || command.trim();
}

/** Keep the last write to each carriage-return progress line. */
export function foldCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n");
}

const LIVE_TAIL_MAX = 4_000;
const DETAIL_MAX = 64_000;
const capTail = (t: string, max: number) => (t.length > max ? "…" + t.slice(-max) : t);
const capHead = (t: string, max: number) => (t.length > max ? t.slice(0, max) + "\n…" : t);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const EDIT_TOOLS = new Set(["edit", "str_replace_editor", "apply_patch"]);
const SYSTEM_REMINDER = /^\s*<system-reminder\b/i;
const RUNTIME_CONTEXT_SNAPSHOT = /^\s*Current runtime context\.\s+This snapshot supersedes earlier runtime-context snapshots\./i;
const PRIVATE_REASONING_TAG = /<\s*(think|thinking|analysis|reasoning|scratchpad|chain[-_ ]of[-_ ]thought)\b[^>]*>/i;
const PRIVATE_REASONING_BLOCK = /<\s*(think|thinking|analysis|reasoning|scratchpad|chain[-_ ]of[-_ ]thought)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

function removeIndexedBlock(blocks: ThreadBlock[], index: Record<string, number>, key: string): void {
  const at = index[key];
  if (at === undefined) return;
  blocks.splice(at, 1);
  delete index[key];
  for (const indexedKey of Object.keys(index)) {
    if (index[indexedKey] > at) index[indexedKey] -= 1;
  }
}

/** Keep a live progress line as the last logical block. Tool and artifact
 * updates may arrive after it; moving the existing slot prevents the status
 * from becoming stranded above newer step groups. */
function moveIndexedBlockToEnd(blocks: ThreadBlock[], index: Record<string, number>, key: string): void {
  const at = index[key];
  if (at === undefined || at === blocks.length - 1) return;
  const [block] = blocks.splice(at, 1);
  blocks.push(block);
  for (const indexedKey of Object.keys(index)) {
    if (indexedKey === key) continue;
    if (index[indexedKey] > at) index[indexedKey] -= 1;
  }
  index[key] = blocks.length - 1;
}

/** Remove provider-emitted chain-of-thought markup from assistant text. Some
 *  providers expose reasoning as a dedicated protocol part (which is already
 *  discarded); others embed it in the text stream using `<think>`-style tags.
 *  An incomplete opening tag is hidden while the stream is still arriving. */
export function stripPrivateReasoning(text: string): string {
  let cleaned = text.replace(PRIVATE_REASONING_BLOCK, "");
  const opening = PRIVATE_REASONING_TAG.exec(cleaned);
  if (opening?.index !== undefined) cleaned = cleaned.slice(0, opening.index);
  return cleaned;
}

export function toolPresentation(
  tool: string,
  title: string | undefined,
  input?: Record<string, unknown>,
): { verb?: ToolVerb; title: string } {
  const command = str(input?.command);
  const filePath = str(input?.filePath) || str(input?.path);
  const fallback = tidyToolTitle(title?.trim() || command || filePath || tool || "tool");
  const file = filePath ? tidyToolTitle(filePath) : "";
  switch (tool) {
    case "bash":
    case "shell":
    case "exec":
    case "execute":
    case "run":
    case "run_command":
      return { verb: "Ran", title: command ? humanizeCommand(tidyToolTitle(command)) : fallback };
    case "write":
    case "create":
      return { verb: "Created", title: file || fallback };
    case "edit":
    case "str_replace_editor":
    case "apply_patch":
      return { verb: "Edited", title: file || fallback };
    case "read":
      return { verb: "Read", title: file || fallback };
    case "grep":
    case "glob":
      return { verb: "Searched", title: str(input?.pattern) || fallback };
    case "list":
      return { verb: "Listed", title: file || fallback };
    case "webfetch":
      return { verb: "Fetched", title: str(input?.url) || fallback };
    default:
      return { title: fallback };
  }
}

export function foldEvent(
  state: FoldState,
  event: RuntimeMessageEvent,
  opts?: { shellTurn?: boolean },
): FoldState {
  const blocks = [...state.blocks];
  const index = { ...state.index };
  switch (event.type) {
    case "text.updated": {
      removeIndexedBlock(blocks, index, "progress");
      const { clean: rawClean, review } = splitReview(stripPrivateReasoning(event.text));
      const clean = rawClean.trim() ? rawClean : "";
      // Text can start as a provisional thought while a step is deciding
      // whether to call a tool, then become the settled answer. Both events
      // share one slot so the answer replaces the folded thought instead of
      // leaving a duplicate visible block behind.
      const key = `assistant:${event.partId}`;
      if (key in index && clean) blocks[index[key]] = { kind: "agent", markdown: clean };
      else if (!(key in index) && clean) {
        blocks.push({ kind: "agent", markdown: clean });
        index[key] = blocks.length - 1;
      }
      if (review) {
        const rkey = `review:${event.partId}`;
        if (rkey in index) blocks[index[rkey]] = review;
        else {
          blocks.push(review);
          index[rkey] = blocks.length - 1;
        }
      }
      return { blocks, index };
    }
    case "progress.updated": {
      // A legacy DSH text candidate may already have been folded as an agent
      // block before the following tool call identifies it as progress. Remove
      // that provisional answer (or a just-classified reasoning block) before
      // keeping the concise action in the live progress slot.
      const provisionalKey = `assistant:${event.partId}`;
      const provisional = provisionalKey in index ? blocks[index[provisionalKey]] : undefined;
      if (
        provisional?.kind === "agent"
        || (provisional?.kind === "reasoning" && isPublicProgressText(provisional.text))
      ) {
        removeIndexedBlock(blocks, index, provisionalKey);
      }
      const text = stripPrivateReasoning(event.text).trim();
      if (!text) return { blocks, index };
      const key = "progress";
      const block: ThreadBlock = { kind: "status-line", text, tone: "running" };
      if (key in index) blocks[index[key]] = block;
      else {
        blocks.push(block);
        index[key] = blocks.length - 1;
      }
      moveIndexedBlockToEnd(blocks, index, key);
      return { blocks, index };
    }
    case "tool.updated": {
      if (/question|permission|^ask$|todo/i.test(event.tool)) return { blocks, index };
      const key = `tool:${event.callId}`;
      const command = str(event.input?.command);
      const filePath = str(event.input?.filePath) || str(event.input?.path);
      const content = str(event.input?.content);
      const prev = key in index ? blocks[index[key]] : undefined;
      const prevTool = prev?.kind === "tool-call" ? prev : undefined;
      const childSessionId = event.childSessionId ?? prevTool?.childSessionId;
      const startedAt = event.startedAt ?? prevTool?.startedAt;
      const endedAt = event.endedAt ?? prevTool?.endedAt;
      const diff =
        event.diff ??
        prevTool?.diff ??
        (EDIT_TOOLS.has(event.tool) && (str(event.input?.oldString) || str(event.input?.newString))
          ? [
              ...str(event.input?.oldString).split("\n").map((l) => `- ${l}`),
              ...str(event.input?.newString).split("\n").map((l) => `+ ${l}`),
            ].join("\n")
          : undefined);
      const { verb, title } = toolPresentation(event.tool, event.title, event.input);
      const block: ThreadBlock = {
        kind: "tool-call",
        title,
        status: event.status,
        tool: event.tool,
        ...(verb ? { verb } : {}),
        ...(command ? { command } : {}),
        ...(filePath ? { filePath: tidyToolTitle(filePath) } : {}),
        ...(content ? { content: capHead(content, DETAIL_MAX) } : {}),
        ...(diff ? { diff: capHead(diff, DETAIL_MAX) } : {}),
        ...(event.status === "running" && event.partialOutput
          ? { partialOutput: capTail(foldCarriageReturns(event.partialOutput), LIVE_TAIL_MAX) }
          : {}),
        ...(event.output?.trim()
          ? { output: capTail(foldCarriageReturns(event.output), DETAIL_MAX).replace(/\s+$/, "") }
          : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
        ...(childSessionId ? { childSessionId } : {}),
        ...(opts?.shellTurn && event.tool === "bash" && event.output?.trim()
          ? { outputSummary: event.output.replace(/\s+$/, "") }
          : {}),
      };
      if (key in index) blocks[index[key]] = block;
      else {
        blocks.push(block);
        index[key] = blocks.length - 1;
      }
      const artifact = deriveArtifact(event);
      if (artifact) {
        const akey = `artifact:${artifact.path}`;
        if (akey in index) blocks[index[akey]] = artifact;
        else {
          blocks.push(artifact);
          index[akey] = blocks.length - 1;
        }
      }
      const presentation = deriveArtifactPresentation(event);
      if (presentation?.display === "inline") {
        const pkey = `presentation:${event.callId}`;
        if (pkey in index) blocks[index[pkey]] = presentation.artifact;
        else {
          blocks.push(presentation.artifact);
          index[pkey] = blocks.length - 1;
        }
      }
      moveIndexedBlockToEnd(blocks, index, "progress");
      return { blocks, index };
    }
    case "reasoning.updated": {
      const key = `assistant:${event.partId}`;
      const block: ThreadBlock = { kind: "reasoning", text: event.text };
      if (key in index) blocks[index[key]] = block;
      else {
        blocks.push(block);
        index[key] = blocks.length - 1;
      }
      moveIndexedBlockToEnd(blocks, index, "progress");
      return { blocks, index };
    }
    case "session.compacted": {
      blocks.push({
        kind: "compaction",
        auto: event.auto,
        ...(event.overflow ? { overflow: true } : {}),
        at: Date.now(),
      });
      return { blocks, index };
    }
    case "session.idle": {
      removeIndexedBlock(blocks, index, "progress");
      const settled = settleRunningToolBlocks(blocks);
      const last = settled[settled.length - 1];
      if (last?.kind === "status-line" && last.tone === "done") return { blocks: settled, index };
      settled.push({ kind: "status-line", text: "done", tone: "done" });
      return { blocks: settled, index };
    }
    default:
      return state;
  }
}

/** A terminal turn can arrive before the runtime publishes the final tool
 * status. Keep the recorded step, but stop presenting an unknown outcome as
 * actively running. `pending` is intentionally neutral: terminality alone
 * does not prove that the tool succeeded or failed. */
export function settleRunningToolBlocks(blocks: ThreadBlock[]): ThreadBlock[] {
  let changed = false;
  const settled = blocks.map((block) => {
    if (block.kind !== "tool-call" || block.status !== "running") return block;
    changed = true;
    return { ...block, status: "pending" as const };
  });
  return changed ? settled : blocks;
}

export function subagentActivity(blocks?: ThreadBlock[]): string {
  for (let i = (blocks?.length ?? 0) - 1; i >= 0; i--) {
    const b = blocks![i];
    if (b.kind === "tool-call") return b.title;
    if (b.kind === "agent") return "Writing…";
  }
  return "Working…";
}

function mapToolStatus(status?: string): ToolCallStatus {
  switch (status) {
    case "running": return "running";
    case "completed": return "success";
    case "error": return "failed";
    default: return "pending";
  }
}

export function lastAgentMode(messages: HistoryMessage[]): AgentMode {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && (m.agent === "plan" || m.agent === "build")) return m.agent;
  }
  return "build";
}

export function historyToThread(messages: HistoryMessage[], commands?: CommandInfo[]): FoldState {
  const blocks: ThreadBlock[] = [];
  const templates = (commands ?? [])
    .filter((c) => c.template?.trim())
    .map((c) => ({ name: c.name, template: c.template!.trim() }))
    .sort((a, b) => b.template.length - a.template.length);
  const asTypedCommand = (text: string): string | undefined => {
    for (const t of templates) {
      const at = t.template.indexOf("$ARGUMENTS");
      if (at < 0) {
        if (!text.startsWith(t.template)) continue;
        const args = text.slice(t.template.length).trim();
        return args ? `/${t.name} ${args}` : `/${t.name}`;
      }
      const prefix = t.template.slice(0, at);
      const suffix = t.template.slice(at + "$ARGUMENTS".length).trimEnd();
      if (!text.startsWith(prefix)) continue;
      const rest = text.trimEnd();
      if (suffix && !rest.endsWith(suffix)) continue;
      const args = rest.slice(prefix.length, suffix ? rest.length - suffix.length : undefined).trim();
      return args ? `/${t.name} ${args}` : `/${t.name}`;
    }
    return undefined;
  };
  // A history response can contain more than one assistant event for a turn.
  // DSH may leave a stale running tool part on an earlier assistant event even
  // after a later event records the terminal answer. Track incompleteness per
  // user turn so that stale parts cannot leak an Interrupted banner into an
  // otherwise completed conversation.
  let turnInterrupted = false;
  let turnTerminal = false;
  const flushTurn = () => {
    if (turnInterrupted && !turnTerminal) interrupted = true;
    turnInterrupted = false;
    turnTerminal = false;
  };
  let interrupted = false;
  let shellTurn = false;
  for (const m of messages) {
    if (m.role === "user") {
      flushTurn();
      shellTurn = m.parts.some((p) => p.type === "text" && p.synthetic);
      if (shellTurn) continue;
      const text = m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("").trim();
      if (isAutoReviewPrompt(text)) continue;
      // Older DSH builds persisted startup/context injections as ordinary user
      // messages. Keep the history projection defensive so those instructions
      // cannot reappear as user bubbles even when the adapter lacks source
      // metadata.
      if (SYSTEM_REMINDER.test(text) || RUNTIME_CONTEXT_SNAPSHOT.test(text)) continue;
      const command = asTypedCommand(text);
      const id = m.id ? { messageID: m.id } : {};
      if (command) blocks.push({ kind: "user", text: command, ...id });
      else if (text) blocks.push({ kind: "user", text, ...id });
    } else {
      if (m.completed !== undefined || m.error) turnTerminal = true;
      for (const p of m.parts) {
        if (p.type === "progress" && p.text?.trim()) {
          const progress = p.text.trim();
          blocks.push({
            kind: "agent",
            markdown: /…$/.test(progress) ? progress : (summarizeProgressText(progress) ?? progress),
          });
        } else if ((p.type === "text" || p.type === "reasoning") && p.text?.trim()) {
          const { clean, review } = splitReview(stripPrivateReasoning(p.text));
          if (clean) {
            if (p.type === "reasoning" && isPublicProgressText(clean)) {
              blocks.push({ kind: "agent", markdown: summarizeProgressText(clean) ?? clean });
            } else if (p.type === "reasoning") blocks.push({ kind: "reasoning", text: clean });
            else blocks.push({ kind: "agent", markdown: clean });
          }
          if (review) blocks.push(review);
        } else if (p.type === "compaction") {
          const c = p as unknown as { auto?: boolean; overflow?: boolean };
          blocks.push({ kind: "compaction", auto: c.auto !== false, ...(c.overflow ? { overflow: true } : {}) });
        } else if (p.type === "tool") {
          if (/question|permission|^ask$|todo/i.test(p.tool ?? "")) continue;
          const status = mapToolStatus(p.state?.status);
          const frozen = status === "running" || status === "pending";
          // A terminal assistant message can retain a stale running tool part
          // in history after a reconnect. Its completed/error marker is the
          // authoritative turn state, so do not label an already-finished turn
          // as interrupted.
          if (frozen && m.completed === undefined && !m.error) turnInterrupted = true;
          const command = str(p.state?.input?.command);
          const filePath = str(p.state?.input?.filePath) || str(p.state?.input?.path);
          const content = str(p.state?.input?.content);
          const diff = str(p.state?.metadata?.diff) || (EDIT_TOOLS.has(p.tool ?? "") && (str(p.state?.input?.oldString) || str(p.state?.input?.newString))
            ? [...str(p.state?.input?.oldString).split("\n").map((l) => `- ${l}`), ...str(p.state?.input?.newString).split("\n").map((l) => `+ ${l}`)].join("\n")
            : "");
          const userShell = shellTurn && p.tool === "bash";
          if (userShell) blocks.push({ kind: "user", text: `! ${command}` });
          const { verb, title } = toolPresentation(p.tool ?? "", p.state?.title, p.state?.input);
          blocks.push({
            kind: "tool-call", title, status: frozen ? "pending" : status, tool: p.tool,
            ...(verb ? { verb } : {}), ...(command ? { command } : {}),
            ...(filePath ? { filePath: tidyToolTitle(filePath) } : {}),
            ...(content ? { content: capHead(content, DETAIL_MAX) } : {}),
            ...(diff ? { diff: capHead(diff, DETAIL_MAX) } : {}),
            ...(p.state?.output?.trim() ? { output: capTail(foldCarriageReturns(p.state.output), DETAIL_MAX).replace(/\s+$/, "") } : {}),
            ...(typeof p.state?.time?.start === "number" ? { startedAt: p.state.time.start } : {}),
            ...(typeof p.state?.time?.end === "number" ? { endedAt: p.state.time.end } : {}),
            ...(userShell && p.state?.output?.trim() ? { outputSummary: p.state.output.replace(/\s+$/, "") } : {}),
          });
          const event = { type: "tool.updated" as const, sessionId: "", callId: "", tool: p.tool ?? "", status, input: p.state?.input, output: p.state?.output };
          const artifact = deriveArtifact(event);
          if (artifact) blocks.push(artifact);
          const presentation = deriveArtifactPresentation(event);
          if (presentation?.display === "inline") blocks.push(presentation.artifact);
        }
      }
      if (m.error && !/abort/i.test(m.error)) blocks.push({ kind: "status-line", text: m.error, tone: "error" });
      shellTurn = false;
    }
  }
  flushTurn();
  if (interrupted) blocks.push({ kind: "status-line", text: "Interrupted — this turn did not finish. Send a new message to continue.", tone: "error" });
  return { blocks, index: {} };
}
