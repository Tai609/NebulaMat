import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readArtifact } from "@/lib/artifactFile";
import { StructureWorkflowPane } from "./StructureWorkflowPane";

vi.mock("@/lib/artifactFile", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/artifactFile")>();
  return {
    ...mod,
    readArtifact: vi.fn(async () => ({
      path: "POSCAR",
      mime: "text/plain",
      encoding: "utf8",
      data: "POSCAR content",
      size: 14,
    })),
  };
});

vi.mock("./VaspFlowStructureView", () => ({
  VaspFlowStructureView: () => <div>structure preview</div>,
}));

describe("StructureWorkflowPane session scope", () => {
  it("reads a discovered structure from the owning session directory", async () => {
    render(
      <StructureWorkflowPane
        blocks={[]}
        discoveredPaths={["POSCAR"]}
        discoveryComplete
        workspaceDirectory={"C:\\workspaces\\session-a"}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(readArtifact).toHaveBeenCalledWith("POSCAR", undefined, "C:\\workspaces\\session-a");
    });
  });

  it("renders an absolute CIF mentioned in the transcript through the bounded base scope", async () => {
    const path = "C:\\workspaces\\project\\.openscience\\generated.cif";
    render(
      <StructureWorkflowPane
        blocks={[{ kind: "agent", markdown: `已生成 \`${path}\`` }]}
        discoveredPaths={[]}
        discoveryComplete
        workspaceDirectory={"C:\\workspaces\\session-a"}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(readArtifact).toHaveBeenCalledWith(path, "base", undefined);
    });
  });
});
