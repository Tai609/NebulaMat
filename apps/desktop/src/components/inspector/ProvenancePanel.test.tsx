import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvenanceRecord, RunRecord } from "@ai4s/shared";
import { useUiStore } from "@/lib/store";
import { ProvenancePanel, reproducePrompt } from "./ProvenancePanel";

const records: ProvenanceRecord[] = [
  { path: "fig/plot.py", version: 1, ts: 1751500000, tool: "write", content: "print(1)", sessionId: "ses_1" },
  {
    path: "fig/plot.py",
    version: 2,
    ts: 1751503600,
    tool: "edit",
    content: "print(2)",
    model: "anthropic/claude",
    sessionId: "ses_1",
    env: {
      python: "3.12.4",
      platform: "macos-aarch64",
      app: "0.1.0",
      packages: { count: 3, hash: "deadbeef" },
    },
  },
];

const listProvenance = vi.fn();
const readEnvLockfile = vi.fn();
vi.mock("@/lib/provenance", () => ({
  listProvenance: (path: string) => listProvenance(path),
  readEnvLockfile: (hash: string) => readEnvLockfile(hash),
}));

const listRuns = vi.fn();
vi.mock("@/lib/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runs")>()),
  listRuns: () => listRuns(),
}));

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ProvenancePanel path="fig/plot.py" language="python" />
    </MemoryRouter>,
  );

/** Highlighting splits code across spans — match the whole <code> element. */
const codeBlock = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === "CODE" && el.textContent === text;

describe("ProvenancePanel", () => {
  beforeEach(() => {
    listProvenance.mockReset();
    readEnvLockfile.mockReset();
    listRuns.mockReset();
    listRuns.mockResolvedValue([]);
  });

  it("lists versions newest first with the latest expanded", async () => {
    listProvenance.mockResolvedValue(records);
    renderPanel();

    expect(await screen.findByText("v2")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("v2");
    expect(items[1]).toHaveTextContent("v1");
    // Latest version starts expanded: its code, model, and session link show.
    expect(screen.getByText(codeBlock("print(2)"))).toBeInTheDocument();
    expect(screen.getByText("anthropic/claude")).toBeInTheDocument();
    expect(screen.getByText("Open conversation")).toBeInTheDocument();
  });

  it("expands an older version to reveal its code", async () => {
    listProvenance.mockResolvedValue(records);
    renderPanel();

    await userEvent.click(await screen.findByText("v1"));
    expect(screen.getByText(codeBlock("print(1)"))).toBeInTheDocument();
  });

  it("shows the recorded environment and drafts a reproduce prompt", async () => {
    listProvenance.mockResolvedValue(records);
    useUiStore.setState({ composerDraft: null });
    renderPanel();

    // Latest version (expanded) shows its captured environment.
    expect(await screen.findByText("py 3.12.4 · macos-aarch64 · app 0.1.0")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Reproduce/ }));
    const draft = useUiStore.getState().composerDraft;
    expect(draft).toContain("Reproduce `fig/plot.py` (provenance v2)");
    expect(draft).toContain("Python 3.12.4");
    expect(draft).toContain("print(2)");
    // The reproduce prompt references the captured package lockfile.
    expect(draft).toContain("3 installed Python packages");
    expect(draft).toContain(".openscience/env/deadbeef.txt");
  });

  it("reveals the captured package lockfile on demand", async () => {
    listProvenance.mockResolvedValue(records);
    readEnvLockfile.mockResolvedValue("numpy==2.0.1\npandas==2.2.2\nscipy==1.14.0");
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /3 packages/ }));
    expect(readEnvLockfile).toHaveBeenCalledWith("deadbeef");
    expect(await screen.findByText(/numpy==2.0.1/)).toBeInTheDocument();
    expect(screen.getByText(/pip freeze · 3 packages/)).toBeInTheDocument();
  });

  it("shows a run-produced version as produced by its run, with a recipe reproduce", async () => {
    const runProduced: ProvenanceRecord[] = [
      { path: "output/metrics.json", version: 1, ts: 1751500000, tool: "run", runId: "run_abc123", sessionId: "ses_1" },
    ];
    const run: RunRecord = {
      runId: "run_abc123",
      ts: 1751500000,
      sessionId: "ses_1",
      command: "python train.py --lr 3e-4",
      status: "ok",
      code: [{ path: "train.py", hash: "aaaa", size: 100 }],
      outputs: [{ path: "output/metrics.json", hash: "bbbb", size: 64 }],
      env: { python: "3.11.4", platform: "linux-x86_64", app: "0.1.3" },
    };
    listProvenance.mockResolvedValue(runProduced);
    listRuns.mockResolvedValue([run]);
    useUiStore.setState({ composerDraft: null });
    renderPanel();

    // Not the misleading "content not captured" text — it points at the run.
    expect(await screen.findByText(/Produced by run/)).toBeInTheDocument();
    expect(screen.queryByText(/Content not captured/)).not.toBeInTheDocument();
    expect(screen.getByText(/python train.py --lr 3e-4/)).toBeInTheDocument();

    // Reproduce drafts the RUN recipe (re-run the command), not re-authoring.
    await userEvent.click(screen.getByRole("button", { name: /Reproduce/ }));
    const draft = useUiStore.getState().composerDraft;
    expect(draft).toContain("Reproduce run `run_abc123`");
    expect(draft).toContain("python train.py --lr 3e-4");
    expect(draft).toContain("output/metrics.json");
  });

  it("shows an edit's diff as its lineage instead of 'content not captured'", async () => {
    const edited: ProvenanceRecord[] = [
      {
        path: "fig/plot.py",
        version: 1,
        ts: 1751500000,
        tool: "edit",
        diff: "--- a/fig/plot.py\n+++ b/fig/plot.py\n@@ -1 +1 @@\n-print(1)\n+print(2)",
        sessionId: "ses_1",
      },
    ];
    listProvenance.mockResolvedValue(edited);
    renderPanel();

    expect(await screen.findByText("+print(2)")).toBeInTheDocument();
    expect(screen.getByText("-print(1)")).toBeInTheDocument();
    expect(screen.queryByText(/Content not captured/)).not.toBeInTheDocument();
  });

  it("explains the empty state", async () => {
    listProvenance.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/No versions recorded yet/)).toBeInTheDocument();
    expect(screen.getByText("fig/plot.py")).toBeInTheDocument();
  });
});

describe("reproducePrompt", () => {
  const record = (content: string): ProvenanceRecord => ({
    path: "report.md",
    version: 3,
    ts: 1751500000,
    tool: "write",
    content,
  });

  it("uses a fence longer than any backtick run in the content", () => {
    const content = "text\n```python\nprint(1)\n```\nmore";
    const prompt = reproducePrompt(record(content));
    // The content's own ``` must not close the outer fence early.
    expect(prompt).toContain(`\`\`\`\`\n${content}\n\`\`\`\``);
  });

  it("flags truncated records and points at the full provenance store", () => {
    const prompt = reproducePrompt(record("big = 1\n… [truncated]"));
    expect(prompt).toContain("truncated");
    expect(prompt).toContain(".openscience/provenance.jsonl");
  });
});
