import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useLayoutStore } from "@/lib/layout";
import { useRuntimeStore } from "@/lib/runtime";
import { SessionView } from "./SessionView";

const artifactFileMocks = vi.hoisted(() => ({
  listDir: vi.fn(async () => []),
}));

vi.mock("@/lib/artifactFile", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/artifactFile")>();
  return { ...mod, listDir: artifactFileMocks.listDir };
});

const SESSION_ID = "ses_empty";
const originalBindSession = useLayoutStore.getState().bindSession;

beforeEach(async () => {
  artifactFileMocks.listDir.mockClear();
  await i18n.changeLanguage("en");
  useRuntimeStore.setState({
    status: "ready",
    currentId: SESSION_ID,
    sessions: [{ id: SESSION_ID, title: "Empty session", directory: "C:\\workspace" }],
    threads: { [SESSION_ID]: { blocks: [], index: {}, loaded: true } },
    panes: {},
    agents: [],
    sessionAgents: {},
    sendingSessions: {},
    runningSessions: {},
  });
});

afterEach(() => {
  cleanup();
  useLayoutStore.setState({ bindSession: originalBindSession });
  useRuntimeStore.setState({
    status: "offline",
    currentId: null,
    sessions: [],
    threads: {},
    panes: {},
    agents: [],
    sessionAgents: {},
    sendingSessions: {},
    runningSessions: {},
  });
});

describe("SessionView header", () => {
  it("updates the empty-session hero when the interface language changes", async () => {
    useRuntimeStore.setState({ currentId: null });
    render(
      <MemoryRouter>
        <SessionView sessionId={null} leafId="leaf-hero" focused />
      </MemoryRouter>,
    );

    expect(screen.getByText("Explore the world of materials")).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });

    expect(screen.getByText("探索材料之境")).toBeInTheDocument();
    expect(screen.queryByText("Explore the world of materials")).not.toBeInTheDocument();
  });

  it("gives the solo composer enough width to keep its controls on one row", () => {
    useRuntimeStore.setState({ currentId: null });
    const { container } = render(
      <MemoryRouter>
        <SessionView sessionId={null} leafId="leaf-wide-composer" focused />
      </MemoryRouter>,
    );

    expect(container.querySelector("[data-dsh-inputbar]")).toHaveClass(
      "w-[min(720px,calc(100%_-_32px))]",
      "max-w-[720px]",
    );
  });

  it("keeps the selected research assistant lane per pane", async () => {
    render(
      <MemoryRouter>
        <SessionView sessionId={SESSION_ID} leafId="leaf-research" focused />
      </MemoryRouter>,
    );

    const menu = screen.getByRole("button", { name: "Deep research mode" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Deep research/ }));
    expect(useRuntimeStore.getState().deepResearchSessions[SESSION_ID]).toBe("deep-research");
  });

  it("renders live progress once, below newer transcript content", () => {
    useRuntimeStore.setState({
      runningSessions: { [SESSION_ID]: true },
      threads: {
        [SESSION_ID]: {
          blocks: [
            { kind: "user", text: "Build candidates" },
            { kind: "status-line", text: "Writing the proper candidates…", tone: "running" },
            { kind: "agent", markdown: "Candidate list updated." },
          ],
          index: { progress: 1 },
          loaded: true,
        },
      },
    });

    render(
      <MemoryRouter>
        <SessionView sessionId={SESSION_ID} leafId="leaf-1" focused />
      </MemoryRouter>,
    );

    const content = screen.getByText("Candidate list updated.");
    const progress = screen.getByText("Writing the proper candidates…");
    expect(screen.getAllByText("Writing the proper candidates…")).toHaveLength(1);
    expect(content.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adds a left question rail for conversations with multiple user turns", () => {
    useRuntimeStore.setState({
      threads: {
        [SESSION_ID]: {
          blocks: [
            { kind: "user", text: "Find a stable catalyst candidate." },
            { kind: "agent", markdown: "I will compare the available candidates." },
            { kind: "user", text: "Now prioritize the lowest-cost option." },
          ],
          index: {},
          loaded: true,
        },
      },
    });

    render(
      <MemoryRouter>
        <SessionView sessionId={SESSION_ID} leafId="leaf-1" focused />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Conversation questions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to question 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to question 2" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-question-anchor]")).toHaveLength(2);
  });

  it("does not render the removed Task DAG surface", async () => {
    render(
      <MemoryRouter>
        <SessionView sessionId={SESSION_ID} leafId="leaf-1" focused />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Task DAG" })).not.toBeInTheDocument();
  });

  it("does not expose the materials workflow icon in the session header", () => {
    render(
      <MemoryRouter>
        <SessionView sessionId={SESSION_ID} leafId="leaf-1" focused />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Materials workflow" })).not.toBeInTheDocument();
  });

  it("keeps a new empty conversation free of displayed examples", () => {
    useRuntimeStore.setState({
      currentId: null,
      sessions: [],
      threads: {},
    });

    render(
      <MemoryRouter>
        <SessionView sessionId={null} leafId="leaf-draft" focused />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Explore an example: climate trends")).not.toBeInTheDocument();
    expect(screen.queryByText("Try a complete workflow")).not.toBeInTheDocument();
  });

  it("uses the retrying connection path from the disconnected header", async () => {
    const connect = vi.fn(async () => {});
    const connectRetry = vi.fn(async () => true);
    const originalConnect = useRuntimeStore.getState().connect;
    const originalConnectRetry = useRuntimeStore.getState().connectRetry;
    useRuntimeStore.setState({ status: "offline", connect, connectRetry });

    try {
      render(
        <MemoryRouter>
          <SessionView sessionId={SESSION_ID} leafId="leaf-1" focused />
        </MemoryRouter>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(connectRetry).toHaveBeenCalledTimes(1);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        useRuntimeStore.setState({ connect: originalConnect, connectRetry: originalConnectRetry });
      });
    }
  });

  it("does not show the removed structure workflow header icon for VASP sessions", async () => {
    useRuntimeStore.setState({
      threads: {
        [SESSION_ID]: {
          blocks: [
            { kind: "user", text: "Run a VASP relaxation for this structure." },
            {
              kind: "artifact",
              path: "POSCAR",
              filename: "POSCAR",
              artifact: "data",
              tool: "write",
              content: "POSCAR content",
            },
          ],
          index: {},
          loaded: true,
        },
      },
    });

    render(
      <MemoryRouter>
        <SessionView sessionId={SESSION_ID} leafId="leaf-1" focused />
      </MemoryRouter>,
    );

    await act(async () => Promise.resolve());
    expect(screen.queryByRole("button", { name: "Close structure workflow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Structure workflow" })).not.toBeInTheDocument();
    expect(artifactFileMocks.listDir).not.toHaveBeenCalled();
  });
});
