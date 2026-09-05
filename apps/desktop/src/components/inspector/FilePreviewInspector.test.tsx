import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FilePreviewInspector as FilePreviewInspectorT } from "@ai4s/shared";
import { readArtifact } from "@/lib/artifactFile";
import { useRuntimeStore } from "@/lib/runtime";
import { FilePreviewInspector, PreviewError } from "./FilePreviewInspector";

// The markdown tests below carry inline `content`, so they never hit
// readArtifact — this mock only feeds the binary-file test.
const probeLargeFile = vi.fn();
vi.mock("@/lib/artifactFile", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/artifactFile")>();
  return {
    ...mod,
    readArtifact: vi.fn(async () => ({
      path: "data/blob.bin",
      mime: "application/octet-stream",
      encoding: "base64",
      data: "AAEC",
      size: 3,
    })),
    probeLargeFile: (...args: unknown[]) => probeLargeFile(...args),
  };
});
vi.mock("./VaspFlowStructureView", () => ({
  VaspFlowStructureView: ({ materialId }: { materialId: string }) => <div>crystal:{materialId}</div>,
}));

const md: FilePreviewInspectorT = {
  variant: "file",
  path: "notes/report.md",
  filename: "report.md",
  artifact: "report",
  content: "# Findings\n\nDose–response holds. `p < 0.01`.",
};

describe("FilePreviewInspector — markdown", () => {
  it("uses the same compact 32px header as a tiled Session pane", () => {
    const { container } = render(
      <FilePreviewInspector data={md} onClose={() => {}} compactHeader />,
    );
    expect(container.querySelector("header")).toHaveClass("h-8", "border-faint");
  });

  it("renders markdown as a formatted document by default", async () => {
    render(<FilePreviewInspector data={md} onClose={() => {}} />);
    // The heading is real document markup, not raw "# Findings" text.
    expect(await screen.findByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.queryByText("# Findings")).not.toBeInTheDocument();
  });

  it("toggles to the raw source under the Code tab", async () => {
    render(<FilePreviewInspector data={md} onClose={() => {}} />);
    await screen.findByRole("heading", { name: "Findings" });
    await userEvent.click(screen.getByRole("button", { name: /Code/ }));
    expect(screen.getByText(/# Findings/)).toBeInTheDocument();
  });

  it("shows the newly opened file, not the previous one (no stale bleed)", async () => {
    // The same inspector instance is reused across files; opening a second
    // file with its own inline content must replace the first, not keep it.
    const a: FilePreviewInspectorT = { ...md, path: "a.md", filename: "a.md", content: "# Alpha" };
    const b: FilePreviewInspectorT = { ...md, path: "b.md", filename: "b.md", content: "# Beta" };
    const { rerender } = render(<FilePreviewInspector data={a} onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeInTheDocument();

    rerender(<FilePreviewInspector data={b} onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alpha" })).not.toBeInTheDocument();
  });
});

describe("FilePreviewInspector — binary file behind a text preview", () => {
  it("says the file is binary instead of the misleading 'desktop app' note", async () => {
    // A text-kind preview whose read comes back base64 (genuinely binary
    // bytes) must say so — not claim the preview needs the desktop app.
    const bin: FilePreviewInspectorT = {
      variant: "file",
      path: "data/blob.bin",
      filename: "blob.bin",
      artifact: "data",
    };
    render(<FilePreviewInspector data={bin} onClose={() => {}} />);
    expect(await screen.findByText(/binary and has no preview/)).toBeInTheDocument();
    expect(screen.queryByText(/available in the desktop app/)).not.toBeInTheDocument();
  });
});

describe("FilePreviewInspector — session workspace scope", () => {
  const deck: FilePreviewInspectorT = {
    variant: "file",
    path: "GPT-5.6-Luna-self-introduction-premium.pptx",
    filename: "GPT-5.6-Luna-self-introduction-premium.pptx",
    artifact: "report",
  };

  it("reads binary files from their owning session without following global focus", async () => {
    const read = vi.mocked(readArtifact);
    read.mockClear();
    act(() => {
      useRuntimeStore.setState({ workspace: "/workspaces/other-session" });
    });

    render(
      <FilePreviewInspector
        data={deck}
        workspaceDirectory="/workspaces/luna-session"
      />,
    );
    await waitFor(() => {
      expect(read).toHaveBeenCalledWith(deck.path, undefined, "/workspaces/luna-session");
    });
    expect(read).toHaveBeenCalledTimes(1);

    // Focusing a different split pane changes the global active workspace.
    // The already-bound Luna preview must neither 404 nor read a same-named
    // file from that other directory.
    act(() => {
      useRuntimeStore.setState({ workspace: "/workspaces/third-session" });
    });
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("FilePreviewInspector - Materials Project record", () => {
  it("renders an mp id directly without reading a workspace file", async () => {
    const read = vi.mocked(readArtifact);
    read.mockClear();
    render(
      <FilePreviewInspector
        data={{ variant: "file", path: "mp-35596", filename: "mp-35596", artifact: "data" }}
      />,
    );
    expect(await screen.findByText("crystal:mp-35596")).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("PreviewError", () => {
  it("shows a helpful card with Open-externally for a too-large file", async () => {
    const onOpen = vi.fn();
    render(
      <PreviewError
        error="file too large to preview (>25 MB)"
        filename="huge.nc"
        path="data/huge.nc"
        onOpenExternally={onOpen}
      />,
    );
    expect(screen.getByText(/huge\.nc is too large to preview/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open externally/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("inspects a too-large file without loading it and renders the pointer", async () => {
    probeLargeFile.mockResolvedValueOnce({
      format: "fastq",
      size: "90.0 GB",
      approx_reads: 450_000_000,
      read_length: { min: 150, max: 150, mean: 150 },
      gzipped: true,
      note: "Memory pointer — file introspected/sampled, not loaded.",
    });
    render(
      <PreviewError
        error="file too large to preview (>25 MB)"
        filename="reads.fastq.gz"
        path="data/reads.fastq.gz"
        onOpenExternally={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Inspect without loading/i }));
    // The pointer's key facts render — the format value, the read count, and
    // that it was sampled, not loaded.
    expect(await screen.findByText("fastq")).toBeInTheDocument(); // the Format cell, exact
    expect(screen.getByText(/450,000,000/)).toBeInTheDocument();
    expect(screen.getByText(/not loaded/i)).toBeInTheDocument();
    expect(probeLargeFile).toHaveBeenCalledWith("data/reads.fastq.gz", undefined, undefined);
  });

  it("shows the probe's error if introspection fails", async () => {
    probeLargeFile.mockRejectedValueOnce(new Error("no Python found"));
    render(
      <PreviewError error="file too large to preview" filename="x.bam" path="x.bam" onOpenExternally={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Inspect without loading/i }));
    expect(await screen.findByText(/no Python found/)).toBeInTheDocument();
  });

  it("renders other errors as a plain line, no card", () => {
    render(<PreviewError error="Preview is available in the desktop app." filename="x.bin" onOpenExternally={() => {}} />);
    expect(screen.getByText(/available in the desktop app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open externally/ })).not.toBeInTheDocument();
  });
});
