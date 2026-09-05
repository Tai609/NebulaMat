import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  Gauge,
  Hammer,
  Hand,
  Loader2,
  MessageSquare,
  Microscope,
  NotebookPen,
  Paperclip,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import {
  addBinaryToWorkspace,
  addFilesToWorkspace,
  addPathsToWorkspace,
  addTextToWorkspace,
  isTauri,
  logDebug,
  type ApprovalMode,
} from "@/lib/tauri";
import { DRAFT_KEY, getClient, useRuntimeStore, type AgentMode } from "@/lib/runtime";
import type { ContextUsage } from "@ai4s/sdk";
import {
  applyRef,
  condenseTranscript,
  matchPaths,
  matchSessions,
  referenceBlock,
  refTriggerAt,
  walkWorkspace,
} from "@/components/thread/references";
import { ModelPicker } from "@/components/thread/ModelPicker";
import { WorkspaceChip } from "@/components/thread/WorkspaceChip";
import { useUiStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { isGatewayWeb } from "@/lib/webMode";
import type { ResearchAssistantMode } from "@/lib/deepResearch";

/** A paste longer than this becomes a workspace file chip instead of raw text. */
const PASTE_AS_FILE_CHARS = 2000;
const PASTE_AS_FILE_LINES = 25;
/** Max composer height before it scrolls internally. */
const MAX_HEIGHT_PX = 160;

/** Extension for a clipboard image's MIME type (`image/png` → `png`,
 *  `image/svg+xml` → `svg`, `image/jpeg` → `jpg`); falls back to `png`. */
function imageExt(mime: string): string {
  const sub = mime.split("/")[1]?.split(";")[0]?.replace("+xml", "") ?? "";
  const mapped = ({ jpeg: "jpg" } as Record<string, string>)[sub];
  return mapped ?? (sub || "png");
}

/** A Blob's bytes as base64 (no data-URI prefix). FileReader handles large
 *  clipboard files without the call-stack limit that spreading into btoa hits. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Keep the OS file name when the clipboard provides one. Screenshot blobs
 *  usually have no name, so give those the same predictable image name as
 *  before; anonymous non-image blobs get a neutral binary fallback. */
function pastedFileName(blob: Blob, index: number): string {
  const supplied = (blob as File).name?.trim();
  if (supplied) return supplied;
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return blob.type.startsWith("image/")
    ? `pasted${suffix}.${imageExt(blob.type)}`
    : `pasted-file${suffix}.bin`;
}

// Terminal-style input history: every sent input (prompt, "!cmd", "/name args")
// in its typed form, shared across sessions, newest last, ↑/↓ to recall.
const HISTORY_KEY = "ai4s.inputHistory";
const HISTORY_MAX = 100;
function readHistory(): string[] {
  try {
    const arr = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function recordHistory(entry: string): void {
  if (!entry) return;
  const prev = readHistory();
  if (prev[prev.length - 1] === entry) return; // consecutive duplicate
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([...prev, entry].slice(-HISTORY_MAX)));
  } catch {
    /* full or unavailable storage never blocks a send */
  }
}

/** A "/" palette entry — the runtime's config commands, skills and MCP prompts. */
export interface ComposerCommand {
  name: string;
  description?: string;
  source?: string;
}

function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) {
    const decimals = value >= 10_000 ? 0 : 1;
    return `${Number((value / 1_000).toFixed(decimals))}k`;
  }
  return String(Math.round(value));
}

function ContextMeter({ usage, disabled, compacting, onCompact }: {
  usage: ContextUsage | null;
  disabled?: boolean;
  compacting?: boolean;
  onCompact?: () => void;
}) {
  const { t } = useTranslation("session");
  const [open, setOpen] = useState(false);
  const hasUsage = !!usage?.contextWindow && usage.usedTokens !== undefined;
  if (!hasUsage && !onCompact) return null;
  const percent = hasUsage
    ? Math.min(100, Math.max(0, (usage!.usedTokens! / usage!.contextWindow!) * 100))
    : 0;
  const breakdown = [
    [t("contextMeter.system"), usage?.systemTokens],
    [t("contextMeter.tools"), usage?.toolsTokens],
    [t("contextMeter.messages"), usage?.messageTokens],
  ] as const;
  return (
    <div className="relative shrink-0" data-context-meter>
      <button
        type="button"
        className="relative flex h-7 w-7 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-text"
        aria-label={t("contextMeter.aria", { percent: Math.round(percent) })}
        title={t("contextMeter.title", { percent: Math.round(percent) })}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${56.55 * percent / 100} 56.55`} transform="rotate(-90 12 12)" />
        </svg>
        {!hasUsage && <Gauge size={14} className="absolute inset-0 m-auto" aria-hidden="true" />}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-card border border-border bg-surface p-3 text-xs shadow-card">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-text">{t("contextMeter.heading")}</span>
            <span className="font-mono tabular-nums text-text">~{formatTokens(usage?.usedTokens)} / {formatTokens(usage?.contextWindow)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-3 space-y-1.5">
            {breakdown.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-muted">
                <span>{label}</span><span className="font-mono tabular-nums">~{formatTokens(value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-muted">{t("contextMeter.approximate")}</p>
          {onCompact && (
            <button
              type="button"
              className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-input bg-accent px-2 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
              disabled={disabled || compacting}
              onClick={() => { setOpen(false); onCompact(); }}
            >
              {compacting && <Loader2 size={12} className="animate-spin" />}
              {t("contextMeter.compact")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The two approval modes the composer can switch between (Codex-style). Copy
 *  (label/description) is translated at render time — see `approvalCopy`. */
const APPROVAL_OPTIONS: { mode: ApprovalMode; icon: typeof Hand }[] = [
  { mode: "approve", icon: Hand },
  { mode: "full", icon: Zap },
];

/** Build (default) or Plan — DeepSeek Harness's read-only planning agent. Copy is
 *  translated at render time (`agentCopy`), mirroring the approval switch. */
const AGENT_OPTIONS: { mode: AgentMode; icon: typeof Hammer }[] = [
  { mode: "build", icon: Hammer },
  { mode: "plan", icon: ClipboardList },
];

/**
 * The "Ask anything" composer. Static mock sessions pass no `onSend`; the live
 * A DeepSeek Harness session passes one to submit prompts to the runtime. Attached
 * workspace files show as removable chips above the input, not as prompt text.
 *
 * Two prefix modes (only when their handler is provided):
 *   `!`  — shell mode: the rest of the line runs directly in the session's
 *          workspace folder (terminal styling, no model turn).
 *   `/`  — command palette: pick a slash command (config command / skill /
 *          MCP prompt) with ↑/↓ + Tab/Enter, then type arguments and send.
 *          A "/name" that matches no known command stays a plain prompt.
 */
export function Composer({
  onSend,
  onSteer,
  onRunShell,
  onRunCommand,
  commands = [],
  disabled,
  working,
  onStop,
  placeholder,
  approvalMode,
  onApprovalModeChange,
  agentMode,
  onAgentModeChange,
  deepResearch,
  onDeepResearchChange,
  researchAssistantMode,
  onResearchAssistantModeChange,
  showModelPicker,
  modelSessionId,
  showWorkspaceChip = true,
  draftKey,
  sessionDir,
  currentSessionId,
  onInteract,
  contextUsage,
  onCompact,
  compacting,
}: {
  onSend?: (text: string) => void;
  /** Send a direction to the next step of an already-running model. */
  onSteer?: (text: string) => Promise<boolean>;
  onRunShell?: (command: string) => void;
  onRunCommand?: (name: string, args: string) => void;
  commands?: ComposerCommand[];
  disabled?: boolean;
  /** A turn is running: the send button becomes Stop (wired to `onStop`). */
  working?: boolean;
  onStop?: () => void;
  /** Defaults to `t("composer.placeholder.default")` ("Ask anything"). */
  placeholder?: string;
  /** The approval switch shows only when the surface provides both (the live
   *  session does; static mock sessions don't). */
  approvalMode?: ApprovalMode;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  /** The Build/Plan agent switch — same both-or-nothing contract; the live
   *  session withholds it when the runtime has no "plan" agent. */
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  /** CEBRO-inspired multi-skill literature/research orchestration switch. */
  deepResearch?: boolean;
  onDeepResearchChange?: (enabled: boolean) => void;
  /** Expanded research lane selector; null means ordinary conversation. */
  researchAssistantMode?: ResearchAssistantMode | null;
  onResearchAssistantModeChange?: (mode: ResearchAssistantMode | null) => void;
  /** Show the inline model + reasoning-effort switcher (left of send). The live
   *  session opts in; static mock sessions have no runtime to switch. */
  showModelPicker?: boolean;
  /** Bind the model picker to a session (per-pane model/effort); omit for the
   *  global default. */
  modelSessionId?: string;
  /** Show the draft workspace-folder chip. Only the draft pane opts in — in a
   *  split layout the other panes already have a bound session/folder. */
  showWorkspaceChip?: boolean;
  /** This pane's draft slot, so the folder chip names THIS draft's destination. */
  draftKey?: string;
  /** Workspace folder the `@` picker lists files from; omit to offer none. */
  sessionDir?: string;
  /** This pane's session, excluded from the `#` picker (referencing the
   *  conversation you are already in adds nothing). */
  currentSessionId?: string | null;
  /** Fired when the user edits the input — used to pin a tentative screen (#3)
   *  the moment they start typing, so it isn't reused/lost on the next click. */
  onInteract?: () => void;
  contextUsage?: ContextUsage | null;
  onCompact?: () => void;
  compacting?: boolean;
}) {
  const { t } = useTranslation(["session", "common"]);
  const resolvedPlaceholder = placeholder ?? t("composer.placeholder.default");
  // Approval-mode copy keyed by mode — APPROVAL_OPTIONS itself stays static
  // (icons only) so it can live at module scope outside the component.
  const approvalCopy: Record<ApprovalMode, { label: string; description: string }> = {
    approve: {
      label: t("composer.approval.approve.label"),
      description: t("composer.approval.approve.description"),
    },
    full: {
      label: t("composer.approval.full.label"),
      description: t("composer.approval.full.description"),
    },
  };
  // Agent-mode copy, same pattern as approvalCopy.
  const agentCopy: Record<AgentMode, { label: string; description: string }> = {
    build: {
      label: t("composer.agent.build.label"),
      description: t("composer.agent.build.description"),
    },
    plan: {
      label: t("composer.agent.plan.label"),
      description: t("composer.agent.plan.description"),
    },
  };
  const composerKey = draftKey ?? modelSessionId ?? null;
  const [value, setValue] = useState(() =>
    composerKey ? useUiStore.getState().composerInputs[composerKey] ?? "" : "",
  );
  const [files, setFiles] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const attachmentJobs = useRef(0);
  /** Attachments are written asynchronously. Keep a serialized tail so a
   *    first-send Enter cannot overtake a paste/picker write, and so two quick
   *    pastes cannot race the workspace's collision-name allocation. */
  const attachmentQueue = useRef<Promise<void>>(Promise.resolve());
  const filesRef = useRef<string[]>([]);
  const submitInFlight = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  /** Highlighted palette row; clamped to the current matches. */
  const [sel, setSel] = useState(0);
  /** Esc closed the palette for the current input; typing reopens it. */
  const [paletteClosed, setPaletteClosed] = useState(false);
  /** A committed slash command: shown as a chip, the input holds arguments. */
  const [command, setCommand] = useState<string | null>(null);
  /** ↑/↓ history navigation; `draft` is what was typed before recalling. */
  const [hist, setHist] = useState<{ index: number; draft: string } | null>(null);
  const [steerState, setSteerState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  /** The approval-mode menu is open. */
  const [approvalOpen, setApprovalOpen] = useState(false);
  const approvalRef = useRef<HTMLDivElement>(null);
  /** The agent-mode menu is open. */
  const [agentOpen, setAgentOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const researchRef = useRef<HTMLDivElement>(null);

  // Dismiss the approval menu on any outside press. (Button blur can't do
  // this: WKWebView never focuses a clicked button, so blur never fires.)
  useEffect(() => {
    if (!approvalOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!approvalRef.current?.contains(e.target as Node)) setApprovalOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [approvalOpen]);
  // Same for the agent menu.
  useEffect(() => {
    if (!agentOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!agentRef.current?.contains(e.target as Node)) setAgentOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [agentOpen]);
  useEffect(() => {
    if (!researchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!researchRef.current?.contains(e.target as Node)) setResearchOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [researchOpen]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Caret position, tracked so an "@"/"#" being typed can be recognized in
  // place — mid-sentence references matter as much as ones at the start.
  const [caret, setCaret] = useState(0);
  /** Workspace paths for the "@" picker, walked once per folder on first use. */
  const [refFiles, setRefFiles] = useState<string[] | null>(null);
  /** Conversations attached with "#": chips above the input, resolved to a
   *  quoted excerpt when the prompt is sent. */
  const [refSessions, setRefSessions] = useState<{ id: string; title: string }[]>([]);
  const [refSel, setRefSel] = useState(0);
  const [refClosed, setRefClosed] = useState(false);
  const allSessions = useRuntimeStore((s) => s.sessions);
  const composerDraft = useUiStore((s) => s.composerDraft);
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);
  const setComposerInput = useUiStore((s) => s.setComposerInput);

  // Keep unsent text outside this component. Switching screens or pane
  // layouts unmounts the composer, but the user's draft must remain intact.
  useEffect(() => {
    if (!composerKey) return;
    const persisted = command ? `/${command}${value ? ` ${value}` : ""}` : value;
    setComposerInput(composerKey, persisted);
  }, [command, composerKey, setComposerInput, value]);

  const shellMode = !!onRunShell && !command && value.startsWith("!");
  const steeringActive = working && !!onSteer && !disabled;
  const interactionDisabled = !!disabled || (working && !onSteer);
  // The palette is open while the command NAME is being typed ("/na…"); the
  // first space ends name-typing (arguments follow) and closes it.
  const slashTyping = !!onRunCommand && !steeringActive && !command && /^\/\S*$/.test(value);
  const query = slashTyping ? value.slice(1).toLowerCase() : "";
  const matches = slashTyping
    ? commands
        .filter((c) => c.name.toLowerCase().includes(query))
        .sort(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(query)) -
            Number(a.name.toLowerCase().startsWith(query)),
        )
    : [];
  const paletteOpen = matches.length > 0 && !paletteClosed && !interactionDisabled;
  const selIndex = Math.min(sel, Math.max(matches.length - 1, 0));

  // "@" a workspace file, "#" a past conversation (#63). Only in a real
  // session: a static mock has no runtime to read files or history from.
  const trigger = onSend && !steeringActive && !shellMode && !command && !refClosed
    ? refTriggerAt(value, caret)
    : null;
  const fileMatches =
    trigger?.kind === "file" ? matchPaths(refFiles ?? [], trigger.query) : [];
  const sessionMatches =
    trigger?.kind === "session"
      ? matchSessions(allSessions, currentSessionId ?? null, trigger.query)
      : [];
  const refCount = trigger?.kind === "file" ? fileMatches.length : sessionMatches.length;
  const refOpen = !!trigger && refCount > 0 && !interactionDisabled;
  const refIndex = Math.min(refSel, Math.max(refCount - 1, 0));

  // The file list is only worth walking once the user actually types "@".
  useEffect(() => {
    if (trigger?.kind !== "file" || refFiles !== null) return;
    let live = true;
    void walkWorkspace(sessionDir).then((paths) => {
      if (live) setRefFiles(paths);
    });
    return () => {
      live = false;
    };
  }, [trigger?.kind, refFiles, sessionDir]);

  // A folder switch invalidates the cached listing.
  useEffect(() => setRefFiles(null), [sessionDir]);

  /** Put the chosen reference in place of the "@…"/"#…" being typed. */
  const takeRef = (insert: string) => {
    if (!trigger) return;
    const next = applyRef(value, trigger, caret, insert);
    setValue(next.value);
    setCaret(next.caret);
    setRefSel(0);
    const el = taRef.current;
    // The caret must land after the inserted text, not where React put it.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  const pickFile = (path: string) => takeRef(`@${path}`);
  const pickSession = (s: { id: string; title: string }) => {
    setRefSessions((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    // The chip carries the reference; the typed "#…" has done its job.
    takeRef("");
  };

  // Each edit resets the palette: selection back to the top, Esc-close undone.
  useEffect(() => {
    setSel(0);
    setPaletteClosed(false);
    setRefSel(0);
    setRefClosed(false);
  }, [value]);

  // Committing a command turns it into a chip; the input then holds only the
  // arguments — the "/name" can never degrade into ordinary prompt text.
  const pick = (c: ComposerCommand) => {
    setCommand(c.name);
    setValue("");
    if (composerKey) setComposerInput(composerKey, `/${c.name}`);
    taRef.current?.focus();
  };

  const onChange = (v: string) => {
    onInteract?.(); // typing pins a tentative preview screen (#3)
    setHist(null); // an edit leaves history navigation
    if (steerState === "error") setSteerState("idle");
    // A full known command name followed by whitespace commits it, same as a
    // pick — whether typed ("/init ") or pasted whole ("/init focus\n…"); the
    // remainder becomes the arguments. Unknown names (paths) stay plain text.
    if (onRunCommand && !command) {
      const m = /^\/(\S+)\s([\s\S]*)$/.exec(v);
      if (m && commands.some((c) => c.name === m[1])) {
        setCommand(m[1]);
        setValue(m[2]);
        if (composerKey) setComposerInput(composerKey, v);
        taRef.current?.focus();
        return;
      }
    }
    setValue(v);
    // Persist in the input event itself. This covers a navigation/unmount that
    // happens before React flushes the effect which mirrors `value`.
    if (composerKey) setComposerInput(composerKey, v);
  };

  const unchip = () => {
    if (!command) return;
    const restored = value ? `/${command} ${value}` : `/${command}`;
    setValue(restored);
    setCommand(null);
    if (composerKey) setComposerInput(composerKey, restored);
    taRef.current?.focus();
  };

  // Consume a draft another surface prepared (e.g. provenance "Reproduce") —
  // prefilled, never auto-sent: the user reviews and presses send. Text the
  // user was already typing is kept, with the draft appended below it.
  useEffect(() => {
    if (composerDraft === null) return;
    setValue((v) => (v.trim() ? `${v.trimEnd()}\n\n${composerDraft}` : composerDraft));
    setComposerDraft(null);
    taRef.current?.focus();
  }, [composerDraft, setComposerDraft]);

  useEffect(() => {
    if (!working) setSteerState("idle");
  }, [working]);

  // Auto-grow with the content, scroll internally beyond the cap.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submitSteer = async () => {
    const direction = value.trim();
    if (!steeringActive || !onSteer || !direction || steerState === "sending") return;
    setSteerState("sending");
    try {
      const accepted = await onSteer(direction);
      if (accepted) {
        if (composerKey) setComposerInput(composerKey, "");
        setValue("");
        setSteerState("sent");
        window.setTimeout(() => setSteerState("idle"), 1800);
      } else {
        setSteerState("error");
      }
    } catch {
      setSteerState("error");
    }
  };

  const submit = async () => {
    if (interactionDisabled || submitInFlight.current) return;
    if (steeringActive) {
      void submitSteer();
      return;
    }
    const text = value.trim();
    // A user can press Enter before React paints the `adding` disabled state.
    // Wait for the actual workspace writes instead of sending a note for a
    // file that is not present in the session's folder yet.
    while (attachmentJobs.current > 0) {
      submitInFlight.current = true;
      try {
        await attachmentQueue.current;
      } finally {
        submitInFlight.current = false;
      }
    }
    setHist(null);
    // A chipped command runs as itself — arguments optional.
    if (command) {
      if (composerKey) setComposerInput(composerKey, "");
      onRunCommand?.(command, text);
      recordHistory(text ? `/${command} ${text}` : `/${command}`);
      setCommand(null);
      setValue("");
      return;
    }
    // "!" — run the rest of the line as a shell command (no model turn).
    if (shellMode) {
      const line = value.slice(1).trim();
      if (!line) return;
      if (composerKey) setComposerInput(composerKey, "");
      onRunShell?.(line);
      recordHistory(`!${line}`);
      setValue("");
      return;
    }
    // "/name args" — run a KNOWN slash command; unknown names stay a prompt
    // (a message can legitimately start with a path like "/etc/hosts …").
    if (onRunCommand && text.startsWith("/")) {
      const name = text.slice(1).split(/\s/, 1)[0];
      if (commands.some((c) => c.name === name)) {
        if (composerKey) setComposerInput(composerKey, "");
        onRunCommand(name, text.slice(1 + name.length).trim());
        recordHistory(text);
        setValue("");
        return;
      }
    }
    const attachedFiles = [...filesRef.current];
    if (!text && attachedFiles.length === 0 && refSessions.length === 0) return;
    if (composerKey) setComposerInput(composerKey, "");
    const fileNote =
      attachedFiles.length > 0
        ? t("composer.file.addedNote", { files: attachedFiles.join(", ") })
        : "";
    const base = text && fileNote ? `${text}\n\n${fileNote}` : text || fileNote;
    if (refSessions.length > 0) {
      // Referenced conversations are fetched and condensed before sending, so
      // the agent gets the earlier context without the user copy-pasting it.
      const attached = [...refSessions];
      setRefSessions([]);
      void buildReferences(attached).then((blocks) =>
        onSend?.(blocks ? `${blocks}\n\n${base}` : base),
      );
    } else {
      onSend?.(base);
    }
    if (text) recordHistory(text);
    setValue("");
    filesRef.current = [];
    setFiles([]);
  };

  /** Quote each referenced conversation down to its ask and its conclusion.
   *  A conversation that cannot be read is skipped rather than failing the
   *  send — the user's own message still goes through. */
  const buildReferences = async (refs: { id: string; title: string }[]): Promise<string> => {
    const client = getClient();
    if (!client) return "";
    const blocks = await Promise.all(
      refs.map(async (r) => {
        try {
          const messages = await client.getMessages(r.id);
          const excerpt = condenseTranscript(messages);
          return excerpt ? referenceBlock(r.title, excerpt) : "";
        } catch {
          return "";
        }
      }),
    );
    return blocks.filter(Boolean).join("\n\n");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // During IME composition (e.g. pinyin), Enter picks a candidate — it must
    // not send. WebKit reports the committing keydown as legacy keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // While the palette is open, the keyboard drives it, not the send.
    if (paletteOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteClosed(true);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        pick(matches[selIndex]);
        return;
      }
    }
    // The "@"/"#" picker takes the same keys as the "/" palette while it is up.
    if (refOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setRefSel((i) => Math.min(i + 1, refCount - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setRefSel((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setRefClosed(true);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (trigger?.kind === "file") pickFile(fileMatches[refIndex]!);
        else {
          const s = sessionMatches[refIndex]!;
          pickSession({ id: s.id, title: s.title });
        }
        return;
      }
    }
    // Backspace on an empty input dissolves the command chip back into text.
    if (e.key === "Backspace" && command && value === "") {
      e.preventDefault();
      unchip();
      return;
    }
    // Terminal-style history: ↑ at the very start of the input recalls the
    // previous sent input; while navigating, ↑/↓ walk older/newer and walking
    // past the newest restores the unsent draft. Any edit leaves navigation.
    if (e.key === "ArrowUp" && !command) {
      const el = taRef.current;
      const atStart = !!el && el.selectionStart === 0 && el.selectionEnd === 0;
      if (hist || atStart) {
        const entries = readHistory();
        const index = (hist ? hist.index : entries.length) - 1;
        if (index >= 0) {
          e.preventDefault();
          setHist({ index, draft: hist ? hist.draft : value });
          setValue(entries[index]);
        }
        return;
      }
    }
    if (e.key === "ArrowDown" && hist) {
      e.preventDefault();
      const entries = readHistory();
      const index = hist.index + 1;
      if (index < entries.length) {
        setHist({ ...hist, index });
        setValue(entries[index]);
      } else {
        setValue(hist.draft);
        setHist(null);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Clipboard files (including screenshots and multi-file Explorer/Finder
  // copies) become workspace chips. Very long text becomes a text-file chip.
  // Every case lands in the draft's own folder (materialized first) so the
  // session can see it through the same attachment path as picker/drop uploads.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!isTauri || !onSend) return;
    // Prefer `files`: clipboard implementations expose the same files through
    // both `files` and `items`, and reading both would upload duplicates. The
    // item fallback covers screenshots in webviews that leave `files` empty.
    const directFiles = Array.from(e.clipboardData.files ?? []);
    const clipboardFiles: Blob[] = directFiles.length > 0
      ? directFiles
      : Array.from(e.clipboardData.items ?? [])
          .map((item) => item.getAsFile?.())
          .filter((file): file is File => file !== null && file !== undefined);
    if (clipboardFiles.length > 0) {
      e.preventDefault();
      void addWorkspaceFile(async () => {
        const names: string[] = [];
        for (const [index, file] of clipboardFiles.entries()) {
          const base64 = await blobToBase64(file);
          names.push(
            await addBinaryToWorkspace(
              pastedFileName(file, index),
              base64,
              attachmentDirectory(),
            ),
          );
        }
        return names;
      });
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (text.length <= PASTE_AS_FILE_CHARS && text.split("\n").length <= PASTE_AS_FILE_LINES) {
      return; // normal paste
    }
    e.preventDefault();
    void addWorkspaceFile(() => addTextToWorkspace("pasted.txt", text, attachmentDirectory()));
  };

  const attachmentDirectory = (): string | undefined => {
    const runtime = useRuntimeStore.getState();
    // For a fresh pane, `ensureDraftWorkspace` may switch folders while this
    // render is still alive. Read the freshly pinned draft mapping first so an
    // async paste cannot write back into the stale pre-switch workspace prop.
    // Existing sessions already have an authoritative `sessionDir` and must
    // never initialize or borrow a draft folder.
    if (!currentSessionId) {
      return runtime.draftWorkspaces[draftKey ?? DRAFT_KEY] ?? sessionDir ?? runtime.workspace ?? undefined;
    }
    return sessionDir ?? runtime.workspace ?? undefined;
  };

  // Shared: materialize the draft's folder, run the write, and chip the result
  // (one file or several — paste yields one, a multi-file drop yields many).
  const addWorkspaceFile = (
    write: () => Promise<string | string[]>,
    errorKind: "paste" | "addFiles" = "paste",
  ): Promise<void> => {
    attachmentJobs.current += 1;
    setAdding(true);
    const job = attachmentQueue.current.then(async () => {
      try {
        // The folder must be pinned under this exact pane's draft key. The first
        // send later uses the same key to create the session; initializing only
        // the global draft would make send create a second folder and strand the
        // uploaded file in the first one. Existing sessions already have a
        // directory and must not switch the active workspace while attaching.
        if (!currentSessionId) {
          await useRuntimeStore.getState().ensureDraftWorkspace(draftKey);
        }
        const res = await write();
        const names = Array.isArray(res) ? res : [res];
        if (names.length > 0) {
          filesRef.current = [...filesRef.current, ...names];
          setFiles(filesRef.current);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(
          errorKind === "addFiles"
            ? t("composer.error.addFiles", { message })
            : t("composer.error.paste", { message }),
        );
      } finally {
        attachmentJobs.current = Math.max(0, attachmentJobs.current - 1);
        if (attachmentJobs.current === 0) setAdding(false);
      }
    });
    // Keep the queue usable after a failed write; the error is already shown in
    // the composer and a later attachment should still be allowed to proceed.
    attachmentQueue.current = job.catch(() => {});
    return job;
  };

  // Latest drop handler, kept in a ref so the native subscription below can run
  // exactly once yet always invoke current logic. Re-subscribing on every render
  // (the previous `[onSend]` dep — onSend is a fresh function each render) leaked
  // native listeners under render churn, so one drop copied the file ~150 times
  // into the project root (issue #44). null when drops aren't accepted.
  const onDropRef = useRef<((paths: string[]) => void) | null>(null);
  onDropRef.current =
    isTauri && onSend
      ? (paths) => {
          if (paths.length > 0)
            void addWorkspaceFile(() => addPathsToWorkspace(paths, attachmentDirectory()));
        }
      : null;

  // Drag-and-drop files onto the app → workspace chips. Tauri captures OS file
  // drops natively (the DOM `drop` event never sees them), so we subscribe to
  // its webview drag-drop event, which hands us absolute paths. Subscribed once
  // for the composer's lifetime; a drop anywhere in the window attaches here.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setDragOver(true);
          else if (p.type === "leave") setDragOver(false);
          else if (p.type === "drop") {
            setDragOver(false);
            onDropRef.current?.(p.paths);
          }
        });
        if (cancelled) un();
        else unlisten = un;
      } catch (err) {
        // The webview drag-drop API can be unavailable (partial Tauri bridge,
        // test env) — native file drops are an enhancement, so degrade quietly
        // rather than surfacing an unhandled rejection.
        void logDebug(`composer drag-drop unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Copy local files into the agent workspace; they appear as chips.
  const addFiles = async () => {
    // Same as paste: give the draft its folder before copying files in.
    await addWorkspaceFile(() => addFilesToWorkspace(attachmentDirectory()), "addFiles");
  };

  const canAttach = isTauri && !!onSend;
  const canSend =
    !adding && (steeringActive
      ? !!value.trim() && steerState !== "sending"
      : !interactionDisabled &&
        (command
          ? true // a chipped command may run without arguments
          : shellMode
            ? value.slice(1).trim().length > 0
            : !!value.trim() || files.length > 0));

  return (
    <div
      data-composer-card
      className={cn(
        "relative rounded-card border bg-surface px-2 py-2 shadow-card",
        // Plan mode gets the blue link tone — distinct from shell (warn) and
        // a chipped command (accent) — so a read-only turn is unmistakable.
        shellMode
          ? "border-warn/60"
          : command
            ? "border-accent/50"
            : steeringActive
              ? "border-accent/60"
              : agentMode === "plan"
                ? "border-link/60"
                : "border-border",
        // Dragging a file over the window: highlight the composer as the target.
        dragOver && "border-accent ring-2 ring-accent/40",
      )}
    >
      {refOpen && (
        <div
          role="listbox"
          aria-label={
            trigger?.kind === "file"
              ? t("composer.reference.filesAria")
              : t("composer.reference.sessionsAria")
          }
          className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
        >
          {trigger?.kind === "file"
            ? fileMatches.map((path, i) => (
                <button
                  key={path}
                  role="option"
                  aria-selected={i === refIndex}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-input px-2 py-1.5 text-left",
                    i === refIndex ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickFile(path);
                  }}
                >
                  <span className="shrink-0 font-mono text-xs text-text">
                    {path.split(/[\\/]/).pop()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                    {path}
                  </span>
                </button>
              ))
            : sessionMatches.map((m, i) => (
                <button
                  key={m.id}
                  role="option"
                  aria-selected={i === refIndex}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-input px-2 py-1.5 text-left",
                    i === refIndex ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSession({ id: m.id, title: m.title });
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-text">{m.title}</span>
                </button>
              ))}
          {trigger?.kind === "file" && refFiles === null && (
            <div className="px-2 py-1.5 text-xs text-muted">
              {t("composer.reference.scanning")}
            </div>
          )}
        </div>
      )}
      {paletteOpen && (
        <div
          role="listbox"
          aria-label={t("composer.commandsAria")}
          className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
        >
          {matches.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === selIndex}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-input px-2 py-1.5 text-left",
                i === selIndex ? "bg-surface-2" : "hover:bg-surface-2",
              )}
              // mousedown, not click — a click would blur the textarea first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="shrink-0 font-mono text-xs text-text">/{c.name}</span>
              {c.description && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.description}</span>
              )}
              {(c.source === "skill" || c.source === "mcp") && (
                <span className="shrink-0 rounded px-1 py-0.5 text-[10px] uppercase text-muted ring-1 ring-border">
                  {c.source === "skill" ? t("composer.source.skill") : t("composer.source.mcp")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {files.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1.5 rounded-input bg-surface-2 py-1 pl-2 pr-1 font-mono text-xs text-text ring-1 ring-border"
            >
              <Paperclip size={11} className="shrink-0 text-muted" />
              <span className="max-w-[220px] truncate">{name}</span>
              <button
                className="rounded p-0.5 text-muted hover:bg-border hover:text-text"
                aria-label={t("composer.file.removeAria", { name })}
                onClick={() => {
                  filesRef.current = filesRef.current.filter((n) => n !== name);
                  setFiles(filesRef.current);
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {refSessions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {refSessions.map((r) => (
            <span
              key={r.id}
              className="flex items-center gap-1.5 rounded-input bg-surface-2 py-1 pl-2 pr-1 text-xs text-text ring-1 ring-border"
              title={t("composer.reference.chipTitle")}
            >
              <MessageSquare size={11} className="shrink-0 text-accent" />
              <span className="max-w-[220px] truncate">{r.title}</span>
              <button
                className="rounded p-0.5 text-muted hover:bg-border hover:text-text"
                aria-label={t("composer.reference.removeAria", { title: r.title })}
                onClick={() => setRefSessions((prev) => prev.filter((x) => x.id !== r.id))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {steeringActive && (
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] font-medium text-accent">{t("live.steering.title")}</span>
          <span className="text-[10px] text-muted">{t("live.steering.nextStep")}</span>
        </div>
      )}
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => {
          setCaret(e.target.selectionStart ?? e.target.value.length);
          onChange(e.target.value);
        }}
        // Clicking or arrowing elsewhere moves the caret out of a half-typed
        // "@…", which must close the picker rather than leave it stranded.
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={
          command
            ? t("composer.placeholder.arguments")
            : shellMode
              ? t("composer.placeholder.shell")
              : steeringActive
                ? t("live.steering.placeholder")
                : resolvedPlaceholder
        }
        className={cn(
          "max-h-[160px] w-full resize-none bg-transparent px-1.5 py-0.5 text-sm leading-6 text-text outline-none placeholder:text-muted",
          (shellMode || command) && "font-mono",
        )}
        aria-label={t("composer.placeholder.default")}
      />
      {steeringActive && steerState !== "idle" && (
        <div aria-live="polite" className="min-h-3 text-[10px] text-muted">
          {steerState === "sending" && <Loader2 size={11} className="inline animate-spin" />}
          {steerState === "sent" && t("live.steering.sent")}
          {steerState === "error" && t("live.steering.error")}
        </div>
      )}
      {/* Keep the model picker and send button in the same action row as the
          mode controls. The left cell may wrap only its own controls in a
          narrow tiled pane; the model/send cell never drops below it. */}
      <div
        data-composer-actions
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 pt-1"
      >
        <div data-composer-primary-actions className="flex min-w-0 flex-wrap items-center gap-1.5">
        {command ? (
          <span
            className="flex h-7 shrink-0 items-center gap-1 rounded-input bg-accent/15 pl-2 pr-1 font-mono text-xs text-accent"
            title={t("composer.command.chipTitle")}
          >
            /{command}
            <button
              className="rounded p-0.5 hover:bg-accent/20"
              aria-label={t("composer.command.removeAria")}
              onClick={unchip}
            >
              <X size={11} />
            </button>
          </span>
        ) : shellMode ? (
          <span
            className="flex h-7 shrink-0 items-center gap-1 rounded-input bg-warn/15 px-1.5 font-mono text-xs text-warn"
            title={t("composer.shellMode.title")}
          >
            <Terminal size={13} />
            {t("composer.shellMode.badge")}
          </span>
        ) : (
          canAttach && (
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
              aria-label={t("composer.attach.addAria")}
              title={t("composer.attach.title")}
              onClick={() => void addFiles()}
              disabled={adding}
            >
              <Paperclip size={15} />
            </button>
          )
        )}
        {/* Folder picker for a fresh draft — renders nothing once the session
            exists (its folder then shows in the header's Files toggle). */}
        {showWorkspaceChip && <WorkspaceChip draftKey={draftKey} />}
        {agentMode && onAgentModeChange && (
          <div className="relative shrink-0" ref={agentRef}>
            {agentOpen && (
              <div
                role="menu"
                aria-label={t("composer.agent.menuAria")}
                className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-card border border-border bg-surface p-1 shadow-card"
              >
                <div className="px-2 pb-1 pt-1.5 text-xs text-muted">
                  {t("composer.agent.menuTitle")}
                </div>
                {AGENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.mode}
                    role="menuitemradio"
                    aria-checked={opt.mode === agentMode}
                    className="flex w-full items-start gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-2"
                    // mousedown, not click — a click would blur the textarea first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setAgentOpen(false);
                      if (opt.mode !== agentMode) onAgentModeChange(opt.mode);
                    }}
                  >
                    <opt.icon size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-text">{agentCopy[opt.mode].label}</span>
                      <span className="block text-xs text-muted">
                        {agentCopy[opt.mode].description}
                      </span>
                    </span>
                    {opt.mode === agentMode && (
                      <Check size={13} className="mt-0.5 shrink-0 text-accent" />
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              aria-label={t("composer.agent.aria")}
              title={t("composer.agent.title")}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs",
                agentMode === "plan"
                  ? "bg-link/15 text-link hover:bg-link/25"
                  : "text-muted hover:bg-surface-2 hover:text-text",
              )}
              onClick={() => setAgentOpen((o) => !o)}
            >
              {agentMode === "plan" ? <ClipboardList size={12} /> : <Hammer size={12} />}
              <span>{agentCopy[agentMode].label}</span>
              <ChevronDown size={11} />
            </button>
          </div>
        )}
        {approvalMode && onApprovalModeChange && !isGatewayWeb && (
          <div className="relative shrink-0" ref={approvalRef}>
            {approvalOpen && (
              <div
                role="menu"
                aria-label={t("composer.approval.menuAria")}
                className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-card border border-border bg-surface p-1 shadow-card"
              >
                <div className="px-2 pb-1 pt-1.5 text-xs text-muted">
                  {t("composer.approval.menuTitle")}
                </div>
                {APPROVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.mode}
                    role="menuitemradio"
                    aria-checked={opt.mode === approvalMode}
                    className="flex w-full items-start gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-2"
                    // mousedown, not click — a click would blur the textarea first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setApprovalOpen(false);
                      if (opt.mode !== approvalMode) onApprovalModeChange(opt.mode);
                    }}
                  >
                    <opt.icon size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-text">{approvalCopy[opt.mode].label}</span>
                      <span className="block text-xs text-muted">
                        {approvalCopy[opt.mode].description}
                      </span>
                    </span>
                    {opt.mode === approvalMode && (
                      <Check size={13} className="mt-0.5 shrink-0 text-accent" />
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              aria-label={t("composer.approval.aria")}
              title={t("composer.approval.title")}
              className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
              onClick={() => setApprovalOpen((o) => !o)}
            >
              {approvalMode === "full" ? <Zap size={12} /> : <Hand size={12} />}
              <span>{approvalCopy[approvalMode].label}</span>
              <ChevronDown size={11} />
            </button>
          </div>
        )}
        {onResearchAssistantModeChange && !isGatewayWeb ? (
          <div className="relative shrink-0" ref={researchRef}>
            {researchOpen && (
              <div
                role="menu"
                aria-label={t("composer.deepResearch.aria")}
                className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-card border border-border bg-surface p-1 shadow-card"
              >
                <div className="px-2 pb-1 pt-1.5 text-xs text-muted">
                  {t("composer.deepResearch.menuTitle")}
                </div>
                {([
                  // eslint-disable-next-line i18next/no-literal-string -- Stable internal mode identifier, not user-facing copy.
                  { mode: "deep-research" as const, icon: FlaskConical },
                  // eslint-disable-next-line i18next/no-literal-string -- Stable internal mode identifier, not user-facing copy.
                  { mode: "scientific-assistant" as const, icon: Microscope },
                  // eslint-disable-next-line i18next/no-literal-string -- Stable internal mode identifier, not user-facing copy.
                  { mode: "experiment-log" as const, icon: NotebookPen },
                ]).map((option) => (
                  <button
                    key={option.mode}
                    role="menuitemradio"
                    aria-checked={researchAssistantMode === option.mode}
                    className="flex w-full items-start gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-2"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setResearchOpen(false);
                      onResearchAssistantModeChange(option.mode);
                    }}
                  >
                    <option.icon size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-text">
                        {t(`composer.deepResearch.modes.${option.mode}.label`)}
                      </span>
                      <span className="block text-xs text-muted">
                        {t(`composer.deepResearch.modes.${option.mode}.description`)}
                      </span>
                    </span>
                    {researchAssistantMode === option.mode && <Check size={13} className="mt-0.5 shrink-0 text-accent" />}
                  </button>
                ))}
                {researchAssistantMode && (
                  <button
                    role="menuitem"
                    className="mt-1 flex w-full items-center gap-2 border-t border-border px-2 py-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-text"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setResearchOpen(false);
                      onResearchAssistantModeChange(null);
                    }}
                  >
                    <X size={13} />
                    {t("composer.deepResearch.off")}
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={researchOpen}
              aria-label={t("composer.deepResearch.aria")}
              title={t("composer.deepResearch.title")}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors",
                researchAssistantMode
                  ? "bg-accent/15 text-accent hover:bg-accent/25"
                  : "text-muted hover:bg-surface-2 hover:text-text",
              )}
              onClick={() => setResearchOpen((open) => !open)}
            >
              {researchAssistantMode === "scientific-assistant"
                ? <Microscope size={12} />
                : researchAssistantMode === "experiment-log"
                  ? <NotebookPen size={12} />
                  : <FlaskConical size={12} />}
              <span>
                {researchAssistantMode
                  ? t(`composer.deepResearch.modes.${researchAssistantMode}.label`)
                  : t("composer.deepResearch.label")}
              </span>
              <ChevronDown size={11} />
            </button>
          </div>
        ) : deepResearch !== undefined && onDeepResearchChange && !isGatewayWeb ? (
          <button
            type="button"
            role="switch"
            aria-checked={deepResearch}
            aria-label={t("composer.deepResearch.aria")}
            title={t("composer.deepResearch.title")}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors",
              deepResearch
                ? "bg-accent/15 text-accent hover:bg-accent/25"
                : "text-muted hover:bg-surface-2 hover:text-text",
            )}
            onClick={() => onDeepResearchChange(!deepResearch)}
          >
            <FlaskConical size={12} />
            <span>{t("composer.deepResearch.label")}</span>
          </button>
        ) : null}
        </div>
        {/* Model picker + send stay together in the fixed right-hand cell. */}
        <div data-composer-model-actions className="flex min-w-0 shrink-0 items-center gap-1.5">
          {showModelPicker && <ModelPicker sessionId={modelSessionId} />}
          <ContextMeter usage={contextUsage ?? null} disabled={working || disabled} compacting={compacting} onCompact={onCompact} />
          {working && onStop && (
            <button
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-input hover:opacity-90",
                steeringActive ? "bg-surface-2 text-muted hover:text-text" : "bg-accent text-accent-fg",
              )}
              aria-label={t("composer.stop.aria")}
              title={t("composer.stop.title")}
              onClick={onStop}
            >
              <Square size={11} fill="currentColor" />
            </button>
          )}
          {(steeringActive || !working || !onStop) && (
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
              aria-label={steeringActive ? t("live.steering.send") : t("composer.send.aria")}
              title={steeringActive ? t("live.steering.send") : undefined}
              onClick={submit}
              disabled={!canSend}
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
