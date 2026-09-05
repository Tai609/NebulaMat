import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeStore } from "@/lib/runtime";
import { useUiStore } from "@/lib/store";
import { MaterialsDesignPage } from "./MaterialsDesignPage";

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(async () => [{ name: "structure-001.cif", isDir: false }]),
  writeWorkspaceFile: vi.fn(async () => {}),
}));

vi.mock("@/lib/artifactFile", () => ({
  listDir: mocks.listDir,
  writeWorkspaceFile: mocks.writeWorkspaceFile,
}));

describe("MaterialsDesignPage", () => {
  beforeEach(() => {
    mocks.listDir.mockClear();
    mocks.writeWorkspaceFile.mockClear();
    useRuntimeStore.setState({ status: "offline" });
    useUiStore.setState({ composerDraft: null });
  });

  it("turns database refresh into a provenance-preserving MCP search task", async () => {
    render(
      <MemoryRouter initialEntries={["/materials"]}>
        <MaterialsDesignPage />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "重新检索数据库" }));
    const draft = useUiStore.getState().composerDraft;
    expect(draft).toContain("materials-mcp.search_materials");
    expect(draft).toContain("provider、material_id");
    expect(draft).toContain("缺失字段必须明确标记");
  });

  it("writes a human-authored experiment artifact before enabling AI interpretation", async () => {
    render(
      <MemoryRouter initialEntries={["/materials"]}>
        <MaterialsDesignPage />
      </MemoryRouter>,
    );

    const save = screen.getByRole("button", { name: "保存实验结果" });
    expect(save).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "提交 MatterGen 结构生成" }));
    await screen.findByText("MatterGen 结构已生成");
    mocks.writeWorkspaceFile.mockClear();

    await userEvent.type(screen.getByRole("textbox", { name: "实验者 ID" }), "operator-7");
    await userEvent.type(screen.getByRole("textbox", { name: "实验观察" }), "650 C sample contains a minor impurity phase");
    await userEvent.type(screen.getByRole("textbox", { name: "测量结果" }), "Conductivity: 8.2e-5 S cm-1");
    await userEvent.type(screen.getByRole("textbox", { name: "实验偏差与失败" }), "Dwell time shortened by 20 min");
    await userEvent.type(screen.getByRole("textbox", { name: "原始数据路径" }), "raw/xrd.csv, raw/eis.csv");
    await userEvent.click(save);

    await waitFor(() => expect(mocks.writeWorkspaceFile).toHaveBeenCalledTimes(1));
    const [path, record] = mocks.writeWorkspaceFile.mock.calls[0] as unknown as [string, string];
    expect(path).toBe("materials/design/iteration-1/experiment-record.md");
    expect(record).toContain("human_actor: operator-7");
    expect(record).toContain("Conductivity: 8.2e-5 S cm-1");
    expect(record).toContain("- raw/xrd.csv");
    expect(record).toContain("- raw/eis.csv");
    expect(screen.getByRole("button", { name: "交给 AI 解读并规划下一轮" })).toBeInTheDocument();
  }, 10_000);
});
