import { describe, expect, it } from "vitest";
import { emptyIpynb, notebookLanguage, parseIpynb, serializeIpynb } from "./notebook-file";

const REAL_IPYNB = JSON.stringify({
  cells: [
    { cell_type: "markdown", source: ["# Title\n", "intro"], metadata: {} },
    {
      cell_type: "code",
      source: ["x = 1\n", "x + 1"],
      metadata: {},
      execution_count: 2,
      outputs: [
        { output_type: "stream", name: "stdout", text: ["hello\n"] },
        { output_type: "execute_result", data: { "text/plain": ["2"] }, metadata: {}, execution_count: 2 },
      ],
    },
    {
      cell_type: "code",
      source: "1/0",
      metadata: {},
      execution_count: 3,
      outputs: [{ output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["Traceback…", "ZeroDivisionError: division by zero"] }],
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

describe("notebook-file", () => {
  it("parses nbformat cells with joined sources and readable outputs", () => {
    const cells = parseIpynb(REAL_IPYNB);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatchObject({ language: "markdown", code: "# Title\nintro" });
    expect(cells[1].code).toBe("x = 1\nx + 1");
    expect(cells[1].output).toBe("hello\n2");
    expect(cells[2].output).toContain("ZeroDivisionError: division by zero");
  });

  it("round-trips through serialize → parse", () => {
    const cells = parseIpynb(REAL_IPYNB);
    const again = parseIpynb(serializeIpynb(cells));
    expect(again.map((c) => c.code)).toEqual(cells.map((c) => c.code));
    expect(again[1].output).toBe("hello\n2");
  });

  it("carries figure outputs (image/png) through parse and serialize", () => {
    const withImage = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "plt.scatter(x, y)",
          metadata: {},
          execution_count: 1,
          outputs: [
            {
              output_type: "display_data",
              data: { "image/png": ["iVBORw0KGgo=\n"], "text/plain": ["<Figure>"] },
              metadata: {},
            },
          ],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });
    const cells = parseIpynb(withImage);
    expect(cells[0].image).toBe("iVBORw0KGgo=");
    expect(cells[0].output).toBe("<Figure>");
    const again = parseIpynb(serializeIpynb(cells));
    expect(again[0].image).toBe("iVBORw0KGgo=");
  });

  it("rejects non-notebook JSON and builds a valid empty notebook", () => {
    expect(() => parseIpynb("{}")).toThrow();
    const blank = parseIpynb(emptyIpynb());
    expect(blank).toHaveLength(1);
    expect(blank[0].language).toBe("python");
  });

  it("detects the notebook kernel language from its kernelspec", () => {
    const rNb = JSON.stringify({
      cells: [{ cell_type: "code", source: "1 + 1", metadata: {} }],
      metadata: { kernelspec: { name: "ir", language: "R" }, language_info: { name: "R" } },
      nbformat: 4,
      nbformat_minor: 5,
    });
    expect(notebookLanguage(rNb)).toBe("r");
    expect(notebookLanguage(REAL_IPYNB)).toBe("python");
    expect(notebookLanguage("not json")).toBe("python");
  });

  it("parses R code cells and round-trips an R notebook (kernelspec preserved)", () => {
    const blank = parseIpynb(emptyIpynb("r"));
    expect(blank[0].language).toBe("r");

    const cells = parseIpynb(
      JSON.stringify({
        cells: [
          { cell_type: "markdown", source: "# R", metadata: {} },
          { cell_type: "code", source: "a <- 41\na + 1", metadata: {} },
        ],
        metadata: { kernelspec: { name: "ir", language: "R" } },
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    expect(cells[0].language).toBe("markdown");
    expect(cells[1].language).toBe("r");
    // Code cells serialize back as real code cells (not cell_type "r").
    const out = JSON.parse(serializeIpynb(cells));
    expect(out.cells[1].cell_type).toBe("code");
    expect(out.metadata.kernelspec.name).toBe("ir");
    expect(notebookLanguage(serializeIpynb(cells))).toBe("r");
  });
});
