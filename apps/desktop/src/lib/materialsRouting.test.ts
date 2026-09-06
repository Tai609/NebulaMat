import { describe, expect, it } from "vitest";
import { classifyMaterialsRequest, shouldRouteToMaterialsWorkflow } from "./materialsRouting";

describe("DFT Materials workflow routing", () => {
  it.each([
    "给我一个 Ni3Pt 在碱性 HER 中的 DFT 任务",
    "Run a VASP NEB calculation with INCAR and POSCAR",
    "计算表面吸附能和过渡态能垒",
  ])("routes computational materials request: %s", (text) => {
    expect(shouldRouteToMaterialsWorkflow(text)).toBe(true);
  });

  it("does not route ordinary materials discussion", () => {
    expect(shouldRouteToMaterialsWorkflow("比较 Ni3Pt 和 NiFe 的实验稳定性"))
      .toBe(false);
  });

  it.each([
    "GitHub中有没有能够通过AI来辅助进行DFT计算的技能或者智能体",
    "Search GitHub for an agent that helps with DFT calculations",
    "GitHub 上有没有能运行 VASP 的 agent",
  ])("keeps GitHub capability discovery in the normal research lane: %s", (text) => {
    expect(classifyMaterialsRequest(text)).toBe("discussion");
    expect(shouldRouteToMaterialsWorkflow(text)).toBe(false);
  });

  it("keeps an explicit materials operation routed even when it starts with discovery", () => {
    expect(classifyMaterialsRequest("在 GitHub 找到 VASP 工具后运行 DFT 计算")).toBe("dft-execution");
  });

  it("keeps preparation and execution as distinct gate inputs", () => {
    expect(classifyMaterialsRequest("整理 INCAR/POSCAR 并做模型审计")).toBe("dft-preparation");
    expect(classifyMaterialsRequest("提交 VASP 到 HPC")).toBe("dft-execution");
  });
});
