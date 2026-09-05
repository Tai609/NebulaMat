import type { ThreadBlock } from "@ai4s/shared";
import { describe, expect, it, vi } from "vitest";
import {
  collectStructureWorkflowSteps,
  discoverStructurePaths,
  extractStructurePaths,
  isAbsoluteStructurePath,
  isComputationalMaterialsThread,
  isStructurePath,
} from "./structureWorkflow";

describe("structure workflow discovery", () => {
  it("recognizes fixed VASP names and common periodic structure formats", () => {
    expect(isStructurePath("runs/01/POSCAR")).toBe(true);
    expect(isStructurePath("runs/01/CONTCAR")).toBe(true);
    expect(isStructurePath("trajectory.lammpstrj")).toBe(true);
    expect(isStructurePath("seed-1729/trajectory.extxyz")).toBe(true);
    expect(isStructurePath("OUTCAR")).toBe(false);
  });

  it("prefers the bounded UI trajectory when a full ASE trajectory is also present", () => {
    const steps = collectStructureWorkflowSteps([], [
      "md/seed-1729/trajectory.extxyz",
      "md/seed-1729/trajectory-preview.extxyz",
      "md/seed-1729/final.extxyz",
    ]);
    expect(steps.map((step) => step.path)).toEqual([
      "md/seed-1729/trajectory-preview.extxyz",
      "md/seed-1729/final.extxyz",
    ]);
    expect(steps[0].phase).toBe("trajectory");
    expect(steps[1].phase).toBe("output");
  });

  it("collects uploaded, generated, and calculated structures in workflow order", () => {
    const blocks: ThreadBlock[] = [
      { kind: "user", text: "请用 uploaded.cif 做一次 DFT 结构优化。\n\nFiles added to the workspace: uploaded.cif" },
      { kind: "artifact", path: "prep/structures/POSCAR", filename: "POSCAR", artifact: "data", tool: "write" },
      { kind: "agent", markdown: "计算完成，结果位于 results/run-01/CONTCAR，轨迹为 results/run-01/XDATCAR。" },
    ];
    expect(isComputationalMaterialsThread(blocks)).toBe(true);
    expect(collectStructureWorkflowSteps(blocks).map(({ path, phase, source }) => ({ path, phase, source }))).toEqual([
      { path: "uploaded.cif", phase: "input", source: "uploaded" },
      { path: "prep/structures/POSCAR", phase: "prepared", source: "generated" },
      { path: "results/run-01/CONTCAR", phase: "relaxed", source: "calculation" },
      { path: "results/run-01/XDATCAR", phase: "trajectory", source: "calculation" },
    ]);
  });

  it("resolves a bare transcript filename to the scanned path", () => {
    const steps = collectStructureWorkflowSteps(
      [{ kind: "user", text: "请查看 POSCAR" }],
      ["runs/01/POSCAR"],
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].path).toBe("runs/01/POSCAR");
  });

  it("extracts extensionless VASP paths without treating prose as a file", () => {
    expect(extractStructurePaths("输入 `prep/run-01/POSCAR`，输出 results/run-01/CONTCAR。"))
      .toEqual(["prep/run-01/POSCAR", "results/run-01/CONTCAR"]);
  });

  it("recognizes and extracts an absolute CIF path from an agent answer", () => {
    const path = "C:\\workspaces\\project\\.openscience\\candidate.cif";
    expect(isAbsoluteStructurePath(path)).toBe(true);
    expect(extractStructurePaths(`结构文件：\`${path}\``)).toEqual([path]);
  });

  it("keeps a copied POSCAR as an input even when archived under results", () => {
    expect(collectStructureWorkflowSteps([], ["results/run-01/POSCAR"])[0].phase).toBe("input");
  });

  it("marks MatterGen CIFs as generated structures", () => {
    const step = collectStructureWorkflowSteps([], ["materials/design/iteration-1/mattergen/structure-0001.cif"])[0];
    expect(step.phase).toBe("prepared");
    expect(step.source).toBe("generated");
  });

  it("performs a bounded recursive scan for structures created outside write tools", async () => {
    const tree: Record<string, Array<{ path: string; name: string; isDir: boolean; size: number; modified: number }>> = {
      "": [{ path: "results", name: "results", isDir: true, size: 0, modified: 0 }],
      results: [
        { path: "results/run-01", name: "run-01", isDir: true, size: 0, modified: 0 },
        { path: "results/report.md", name: "report.md", isDir: false, size: 1, modified: 0 },
      ],
      "results/run-01": [
        { path: "results/run-01/CONTCAR", name: "CONTCAR", isDir: false, size: 1, modified: 0 },
      ],
    };
    const readDir = vi.fn(async (path: string) => tree[path] ?? []);
    await expect(discoverStructurePaths(readDir)).resolves.toEqual(["results/run-01/CONTCAR"]);
  });

  it("reads sibling directories concurrently within the configured limit", async () => {
    let active = 0;
    let peak = 0;
    const readDir = vi.fn(async (path: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      if (path === "") {
        return ["a", "b", "c"].map((name) => ({ path: name, name, isDir: true, size: 0, modified: 0 }));
      }
      return [{ path: `${path}/POSCAR`, name: "POSCAR", isDir: false, size: 1, modified: 0 }];
    });

    await expect(discoverStructurePaths(readDir, 2, 50, 2)).resolves.toHaveLength(3);
    expect(peak).toBe(2);
  });
});
