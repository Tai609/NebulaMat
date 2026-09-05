import { describe, expect, it } from "vitest";
import type { ToolUpdatedEvent } from "@ai4s/sdk";
import type { ArtifactInspector } from "@ai4s/shared";
import {
  artifactBlockToInspector,
  deriveArtifact,
  deriveArtifactPresentation,
  extractArtifactRefs,
  extToKind,
  fileInspectorFromBlock,
  previewKind,
  previewKindForName,
  refToArtifactBlock,
  resolveArtifactContent,
} from "./artifacts";

const write = (input: Record<string, unknown>, over: Partial<ToolUpdatedEvent> = {}): ToolUpdatedEvent => ({
  type: "tool.updated",
  sessionId: "s",
  callId: "c",
  tool: "write",
  status: "success",
  input,
  ...over,
});

describe("extToKind", () => {
  it("maps extensions to kinds and defaults unknown to data", () => {
    expect(extToKind("png")).toBe("figure");
    expect(extToKind("PY")).toBe("script");
    expect(extToKind("csv")).toBe("table");
    expect(extToKind("ipynb")).toBe("notebook");
    expect(extToKind("pdf")).toBe("report");
    expect(extToKind("xyz")).toBe("data");
  });
});

describe("deriveArtifact", () => {
  it("derives a script artifact with content + language from a write tool", () => {
    const a = deriveArtifact(write({ filePath: "src/make_fig.py", content: "print(1)" }));
    expect(a).toMatchObject({
      kind: "artifact",
      filename: "make_fig.py",
      artifact: "script",
      tool: "write",
      content: "print(1)",
      language: "python",
    });
  });

  it("classifies an image write as a figure (no text content required)", () => {
    const a = deriveArtifact(write({ path: "figures/atlas.png" }));
    expect(a?.artifact).toBe("figure");
    expect(a?.filename).toBe("atlas.png");
    expect(a?.content).toBeUndefined();
  });

  it("returns null for non-write tools, failures, and missing paths", () => {
    expect(deriveArtifact(write({ filePath: "a.py" }, { tool: "bash" }))).toBeNull();
    expect(deriveArtifact(write({ filePath: "a.py" }, { status: "running" }))).toBeNull();
    expect(deriveArtifact(write({ content: "x" }))).toBeNull();
  });
});

describe("deriveArtifactPresentation", () => {
  it("turns a successful inline tool call into a titled native preview artifact", () => {
    const result = deriveArtifactPresentation(
      write(
        {
          path: "figures/embedding.png",
          display: "inline",
          title: "Cell embedding",
        },
        { tool: "present_artifact" },
      ),
    );
    expect(result).toMatchObject({
      display: "inline",
      target: "current-screen",
      artifact: {
        path: "figures/embedding.png",
        artifact: "figure",
        presentation: { mode: "inline", title: "Cell embedding" },
      },
    });
  });

  it("keeps a valid panel placement and rejects incomplete or failed calls", () => {
    expect(
      deriveArtifactPresentation(
        write(
          { path: "results/summary.csv", display: "panel", placement: "bottom" },
          { tool: "present_artifact" },
        ),
      ),
    ).toMatchObject({
      display: "panel",
      placement: "bottom",
      target: "current-screen",
      artifact: { presentation: { mode: "panel" } },
    });
    // An unknown or absent placement leaves the choice to the layout store.
    expect(
      deriveArtifactPresentation(
        write(
          { path: "results/summary.csv", display: "panel", placement: "bottom-right" },
          { tool: "present_artifact" },
        ),
      )?.placement,
    ).toBeUndefined();
    expect(
      deriveArtifactPresentation(
        write({ path: "results/summary.csv", display: "panel" }, { tool: "present_artifact" }),
      )?.placement,
    ).toBeUndefined();
    expect(
      deriveArtifactPresentation(
        write({ path: "a.png", display: "panel" }, { tool: "present_artifact", status: "failed" }),
      ),
    ).toBeNull();
    expect(
      deriveArtifactPresentation(
        write({ display: "inline" }, { tool: "present_artifact" }),
      ),
    ).toBeNull();
  });

  it("keeps explicit new Screen and dedicated Session targets", () => {
    expect(
      deriveArtifactPresentation(
        write(
          { path: "report.html", display: "panel", target: "new-screen" },
          { tool: "present_artifact" },
        ),
      )?.target,
    ).toBe("new-screen");
    expect(
      deriveArtifactPresentation(
        write(
          { path: "report.html", display: "panel", target: "new-session" },
          { tool: "present_artifact" },
        ),
      )?.target,
    ).toBe("new-session");
  });
});

describe("resolveArtifactContent", () => {
  const data: ArtifactInspector = {
    variant: "artifact",
    title: "fig.py",
    versions: [
      { label: "v1", code: "old", reviewPassed: false },
      { label: "v2" },
    ],
    activeVersion: "v2",
    reviewPassed: true,
    inputs: [],
    code: "new",
    language: "python",
  };

  it("uses the version override when present", () => {
    const r = resolveArtifactContent(data, "v1");
    expect(r.code).toBe("old");
    expect(r.reviewPassed).toBe(false);
  });

  it("falls back to inspector-level fields when the version omits them", () => {
    const r = resolveArtifactContent(data, "v2");
    expect(r.code).toBe("new");
    expect(r.reviewPassed).toBe(true);
  });
});

describe("extractArtifactRefs", () => {
  it("finds files produced by running code, even in prose/backticks", () => {
    const md = "Generated `canvas-project/canvas.pdf` (A4) and a preview at report/index.html.";
    expect(extractArtifactRefs(md)).toEqual(["canvas-project/canvas.pdf", "report/index.html"]);
  });

  it("dedupes and ignores URLs", () => {
    const md = "See figs/a.png and figs/a.png, not https://example.com/b.png";
    expect(extractArtifactRefs(md)).toEqual(["figs/a.png"]);
  });

  it("returns nothing when no artifact-like paths are present", () => {
    expect(extractArtifactRefs("just a sentence about e.g. things")).toEqual([]);
  });

  it("finds Office documents (docx/xlsx/pptx)", () => {
    const md = "Wrote project.docx, project.xlsx and project.pptx.";
    expect(extractArtifactRefs(md)).toEqual(["project.docx", "project.xlsx", "project.pptx"]);
  });

  it("finds files named in non-ASCII scripts (deliverables are named in the user's language)", () => {
    const md = "已交付：青云录_详细剧情梳理.docx，图在 图表/年度趋势.png。";
    expect(extractArtifactRefs(md)).toEqual(["青云录_详细剧情梳理.docx", "图表/年度趋势.png"]);
  });

  it("finds Materials Project ids as virtual crystal previews", () => {
    expect(extractArtifactRefs("NiFe2O4 (mp-35596) and Co3O4 (mp-1271793)."))
      .toEqual(["mp-35596", "mp-1271793"]);
  });
});

describe("previewKind", () => {
  it("maps extensions to a preview strategy", () => {
    expect(previewKind("html")).toBe("html");
    expect(previewKind("pdf")).toBe("pdf");
    expect(previewKind("png")).toBe("image");
    expect(previewKind("svg")).toBe("image");
    expect(previewKind("py")).toBe("text");
  });

  it("renders markdown files as a formatted document, not plain code", () => {
    expect(previewKind("md")).toBe("markdown");
    expect(previewKind("markdown")).toBe("markdown");
  });

  it("gives Office documents their own inline preview kinds", () => {
    expect(previewKind("docx")).toBe("docx");
    expect(previewKind("xlsx")).toBe("xlsx");
    expect(previewKind("pptx")).toBe("pptx");
  });

  it("renders 3D mesh/CAD files with the mesh viewer", () => {
    for (const ext of ["stl", "obj", "ply", "gltf", "glb"]) {
      expect(previewKind(ext)).toBe("mesh");
    }
  });

  it("renders molecular structure files as molecules", () => {
    for (const ext of [
      "mol", "mol2", "sdf", "smi", "smiles", "pdb", "pqr", "xyz", "cube",
    ]) {
      expect(previewKind(ext)).toBe("molecule");
    }
  });

  it("routes periodic structure files to the crystal viewer", () => {
    for (const ext of ["cif", "mcif", "mmcif", "poscar"]) expect(previewKind(ext)).toBe("crystal");
  });

  it("renders FITS astronomy files with the FITS viewer", () => {
    for (const ext of ["fits", "fit", "fts"]) expect(previewKind(ext)).toBe("fits");
  });
});

describe("previewKindForName", () => {
  it("recognizes Materials Project ids as virtual crystal records", () => {
    expect(previewKindForName("mp-35596")).toBe("crystal");
    expect(previewKindForName("MP-1271793")).toBe("crystal");
  });

  it("recognizes extensionless VASP files by filename", () => {
    expect(previewKindForName("DOSCAR")).toBe("dos");
    expect(previewKindForName("run/DOSCAR")).toBe("dos");
    expect(previewKindForName("DOSCAR.dat")).toBe("dos");
    expect(previewKindForName("nacl.dos")).toBe("dos");
    expect(previewKindForName("EIGENVAL")).toBe("bands");
    expect(previewKindForName("run/EIGENVAL")).toBe("bands");
    expect(previewKindForName("POSCAR")).toBe("crystal");
    expect(previewKindForName("run/CONTCAR")).toBe("crystal");
    expect(previewKindForName("OUTCAR")).toBe("text");
    expect(previewKindForName("vasprun.xml")).toBe("text");
  });

  it("falls back to the extension registry for everything else", () => {
    expect(previewKindForName("sky.fits")).toBe("fits");
    expect(previewKindForName("plot.png")).toBe("image");
    expect(previewKindForName("notes.md")).toBe("markdown");
    expect(previewKindForName("main.py")).toBe("text");
  });

  it("routes VASP and MD structure trajectories to the crystal viewer", () => {
    expect(previewKindForName("POSCAR")).toBe("crystal");
    expect(previewKindForName("CONTCAR")).toBe("crystal");
    expect(previewKindForName("XDATCAR")).toBe("crystal");
    expect(previewKindForName("trajectory.lammpstrj")).toBe("crystal");
    expect(previewKindForName("trajectory.extxyz")).toBe("crystal");
  });
});

describe("refToArtifactBlock", () => {
  it("builds a path-only artifact block from a mentioned file", () => {
    expect(refToArtifactBlock("canvas-project/canvas.pdf")).toMatchObject({
      kind: "artifact",
      path: "canvas-project/canvas.pdf",
      filename: "canvas.pdf",
      artifact: "report",
      tool: "output",
    });
  });
});

describe("artifactBlockToInspector", () => {
  it("shows text content for a text artifact", () => {
    const insp = artifactBlockToInspector({
      kind: "artifact",
      path: "a.py",
      filename: "a.py",
      artifact: "script",
      tool: "write",
      content: "print(1)",
      language: "python",
    });
    expect(insp.code).toBe("print(1)");
    expect(insp.language).toBe("python");
  });

  it("surfaces the notebook a jupyter MCP tool works on as a live artifact", () => {
    const a = deriveArtifact(
      write(
        { notebook_name: "scatter-demo", notebook_path: "scatter-demo.ipynb", mode: "create" },
        { tool: "jupyter_use_notebook" },
      ),
    );
    expect(a).toMatchObject({
      kind: "artifact",
      path: "scatter-demo.ipynb",
      artifact: "notebook",
      tool: "jupyter_use_notebook",
    });
    // Cell-level tools carry no path — no artifact, no crash.
    expect(deriveArtifact(write({ cell_index: 0 }, { tool: "jupyter_execute_cell" }))).toBeNull();
  });

  it("routes .ipynb artifacts to the runnable notebook editor, others to file preview", () => {
    const nb = fileInspectorFromBlock({
      kind: "artifact",
      path: "analysis/run.ipynb",
      filename: "run.ipynb",
      artifact: "notebook",
      tool: "write",
    });
    expect(nb).toEqual({ variant: "notebook-file", path: "analysis/run.ipynb" });

    const file = fileInspectorFromBlock({
      kind: "artifact",
      path: "fig.png",
      filename: "fig.png",
      artifact: "figure",
      tool: "write",
    });
    expect(file.variant).toBe("file");
  });

  it("shows a placeholder for a binary artifact", () => {
    const insp = artifactBlockToInspector({
      kind: "artifact",
      path: "figures/atlas.png",
      filename: "atlas.png",
      artifact: "figure",
      tool: "write",
    });
    expect(insp.code).toContain("Binary artifact");
    expect(insp.code).toContain("figures/atlas.png");
  });
});
