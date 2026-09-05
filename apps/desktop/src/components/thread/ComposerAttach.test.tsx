import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer } from "./Composer";
import i18n from "@/i18n";
import { addBinaryToWorkspace, addFilesToWorkspace } from "@/lib/tauri";

// Desktop-only attach behaviors, with the Tauri bridge mocked out.
vi.mock("@/lib/tauri", () => ({
  isTauri: true,
  addFilesToWorkspace: vi.fn(async () => ["data.csv"]),
  addTextToWorkspace: vi.fn(async () => "pasted.txt"),
  addBinaryToWorkspace: vi.fn(async (filename: string) => filename),
  addPathsToWorkspace: vi.fn(async () => ["dropped.csv"]),
  logDebug: vi.fn(async () => {}),
}));

// The composer subscribes to the webview's native drag-drop event on mount.
// Without a Tauri runtime `getCurrentWebview()` throws — stub it so the effect
// subscribes cleanly instead of leaving an unhandled rejection.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}));

describe("Composer attachments (desktop)", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("adds picked files as removable chips and sends them as a file note", async () => {
    const onSend = vi.fn();
    const sessionDir = String.raw`C:\workspaces\session-1423`;
    render(<Composer onSend={onSend} sessionDir={sessionDir} />);

    fireEvent.click(screen.getByLabelText("Add files"));
    await waitFor(() => expect(screen.getByText("data.csv")).toBeTruthy());
    expect(addFilesToWorkspace).toHaveBeenCalledWith(sessionDir);

    // Chip is outside the textarea — typing text is independent of the file.
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "analyze this" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith(
      "analyze this\n\nFiles added to the workspace: data.csv",
    );
    // Chips are cleared after sending.
    expect(screen.queryByText("data.csv")).toBeNull();
  });

  it("removes a chip via its X button without touching the text", async () => {
    render(<Composer onSend={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Add files"));
    await waitFor(() => expect(screen.getByText("data.csv")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Remove data.csv"));
    expect(screen.queryByText("data.csv")).toBeNull();
  });

  it("turns an oversized paste into a workspace file chip, keeping the box clean", async () => {
    render(<Composer onSend={vi.fn()} />);
    const input = screen.getByLabelText("Ask anything") as HTMLTextAreaElement;

    fireEvent.paste(input, {
      clipboardData: { getData: () => "x".repeat(3000) },
    });
    await waitFor(() => expect(screen.getByText("pasted.txt")).toBeTruthy());
    expect(input.value).toBe("");

    // A short paste stays a normal paste (no new chip).
    fireEvent.paste(input, { clipboardData: { getData: () => "short text" } });
    expect(screen.getAllByText("pasted.txt")).toHaveLength(1);
  });

  it("turns a pasted image (screenshot) into an image file chip", async () => {
    render(<Composer onSend={vi.fn()} />);
    const input = screen.getByLabelText("Ask anything") as HTMLTextAreaElement;

    // A clipboard image item, as macOS/Windows/Linux webviews expose it.
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "",
        items: [
          {
            type: "image/png",
            getAsFile: () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
          },
        ],
      },
    });
    await waitFor(() => expect(screen.getByText("pasted.png")).toBeTruthy());
    expect(input.value).toBe(""); // the image never lands as text
  });

  it("uploads multiple pasted files and preserves their names", async () => {
    const sessionDir = String.raw`C:\workspaces\session-1423`;
    const onSend = vi.fn();
    render(<Composer onSend={onSend} sessionDir={sessionDir} />);
    const input = screen.getByLabelText("Ask anything") as HTMLTextAreaElement;
    const csv = new File(["a,b\n1,2"], "measurements.csv", { type: "text/csv" });
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf", {
      type: "application/pdf",
    });

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "clipboard file paths must not become prompt text",
        files: [csv, pdf],
        // The same files can also appear here. The composer must not upload
        // both collections and duplicate every attachment.
        items: [
          { type: csv.type, getAsFile: () => csv },
          { type: pdf.type, getAsFile: () => pdf },
        ],
      },
    });

    await waitFor(() => expect(screen.getByText("measurements.csv")).toBeTruthy());
    expect(screen.getByText("paper.pdf")).toBeTruthy();
    expect(addBinaryToWorkspace).toHaveBeenCalledTimes(2);
    expect(addBinaryToWorkspace).toHaveBeenNthCalledWith(
      1,
      "measurements.csv",
      expect.any(String),
      sessionDir,
    );
    expect(addBinaryToWorkspace).toHaveBeenNthCalledWith(
      2,
      "paper.pdf",
      expect.any(String),
      sessionDir,
    );
    expect(input.value).toBe("");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(
      "Files added to the workspace: measurements.csv, paper.pdf",
    );
  });

  it("waits for a first-send paste upload before sending the prompt", async () => {
    let release!: (name: string) => void;
    vi.mocked(addBinaryToWorkspace).mockImplementationOnce(
      async (filename: string) => new Promise<string>((resolve) => {
        release = () => resolve(filename);
      }),
    );
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByLabelText("Ask anything") as HTMLTextAreaElement;
    const image = new File([new Uint8Array([137, 80, 78, 71])], "figure.png", {
      type: "image/png",
    });

    fireEvent.paste(input, {
      clipboardData: { getData: () => "", files: [image] },
    });
    fireEvent.change(input, { target: { value: "inspect this figure" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The keydown may happen before React renders `adding=true`; the send must
    // still wait for the actual workspace write rather than losing the file.
    await waitFor(() => expect(release).toEqual(expect.any(Function)));
    expect(onSend).not.toHaveBeenCalled();
    release("figure.png");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      "inspect this figure\n\nFiles added to the workspace: figure.png",
    ));
  });

  it("waits for a first-send picker upload before sending the prompt", async () => {
    let release!: (names: string[]) => void;
    vi.mocked(addFilesToWorkspace).mockImplementationOnce(
      async () => new Promise<string[]>((resolve) => {
        release = resolve;
      }),
    );
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByLabelText("Ask anything") as HTMLTextAreaElement;

    fireEvent.click(screen.getByLabelText("Add files"));
    fireEvent.change(input, { target: { value: "inspect this dataset" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(release).toEqual(expect.any(Function)));
    expect(onSend).not.toHaveBeenCalled();
    release(["dataset.csv"]);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      "inspect this dataset\n\nFiles added to the workspace: dataset.csv",
    ));
  });

  it("sends the generated file note in the interface language", async () => {
    await i18n.changeLanguage("zh-Hans");
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    fireEvent.click(screen.getByLabelText("添加文件"));
    await waitFor(() => expect(screen.getByText("data.csv")).toBeTruthy());
    fireEvent.keyDown(screen.getByLabelText("尽情提问"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("文件已添加到工作区：data.csv");
  });
});
