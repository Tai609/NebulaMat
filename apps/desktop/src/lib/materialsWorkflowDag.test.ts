import { describe, expect, it } from "vitest";
import { layoutMaterialsWorkflowDag, parseMaterialsWorkflowDag } from "./materialsWorkflowDag";

describe("materials workflow DAG", () => {
  it("normalizes task fields and creates dependency layers", () => {
    const workflow = parseMaterialsWorkflowDag({
      workflow_id: "mw_test",
      workflow_template: "electrocatalysis-discovery-v1",
      tasks: [
        { task_id: "generate", capability: "mattergen", role: "materials", objective: "Generate", dependencies: [], status: "completed" },
        { task_id: "surface", capability: "catkit", role: "surface", objective: "Surface", dependencies: ["generate"], status: "running" },
        { task_id: "screen", capability: "catmap", role: "kinetics", objective: "Screen", dependencies: ["surface"], status: "pending" },
      ],
    });
    expect(workflow?.template).toBe("electrocatalysis-discovery-v1");
    const layout = layoutMaterialsWorkflowDag(workflow!);
    expect(layout.layers.map((layer) => layer.map((node) => node.taskId))).toEqual([
      ["generate"], ["surface"], ["screen"],
    ]);
    expect(layout.edges).toEqual([
      { from: "generate", to: "surface", missing: false },
      { from: "surface", to: "screen", missing: false },
    ]);
  });

  it("keeps missing dependencies and cycles inspectable", () => {
    const workflow = parseMaterialsWorkflowDag({
      workflow_id: "mw_invalid",
      tasks: [
        { task_id: "a", dependencies: ["missing"], status: "failed" },
        { task_id: "b", dependencies: ["c"], status: "pending" },
        { task_id: "c", dependencies: ["b"], status: "pending" },
      ],
      optional_stages: [{ stage: "kmos", status: "skipped", reason: "not requested" }],
    });
    const layout = layoutMaterialsWorkflowDag(workflow!);
    expect(layout.nodes.find((node) => node.taskId === "missing")).toMatchObject({
      status: "blocked",
      missingDependency: true,
    });
    expect(layout.edges).toContainEqual({ from: "missing", to: "a", missing: true });
    expect(layout.nodes.filter((node) => node.taskId === "b" || node.taskId === "c").every((node) => node.layer >= 1)).toBe(true);
    expect(workflow?.optionalStages[0].status).toBe("skipped");
  });
});
