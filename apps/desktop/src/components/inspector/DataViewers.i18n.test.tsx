import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/store";
import { MoleculeView } from "./MoleculeView";
import { TableChart } from "./TableChart";
import { GenomeView } from "./GenomeView";
import { DosView } from "./DosView";
import { QCodeView } from "./QCodeView";
import type { ParsedTable } from "@/lib/csv";

// COPYCAT RULE: useUiStore is module-global; reset the locale after each test
// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

const T: ParsedTable = {
  columns: ["month", "sales"],
  rows: [
    ["Jan", "100"],
    ["Feb", "120"],
  ],
  truncated: false,
};

const BED = "chr1\t0\t100\tgeneA\t500\t+";

function bytesOf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

const SPIN = [
  "   2   2   1   0",
  "  1.0 1.0 1.0 1.0 1e-16",
  "  1.0",
  "  CAR",
  " system",
  "  4.0 -4.0   4   1.0   1.0",
  " -4.0 0.0 0.0 0.0 0.0",
  " -1.0 0.8 0.7 0.5 0.4",
  "  1.0 1.5 1.4 1.2 1.1",
  "  4.0 0.0 0.0 2.0 1.9",
].join("\n");

describe("MoleculeView strings (i18n)", () => {
  it("renders the per-value style labels, reset control, and empty state in English", async () => {
    render(<MoleculeView filename="empty.smi" text={"   \n# comment\n"} />);
    expect(await screen.findByText(/No chemical structures found/)).toBeInTheDocument();
  });

  it("renders the not-a-chemical-file message in English", () => {
    render(<MoleculeView filename="notes.txt" text="hello" />);
    expect(screen.getByText("Not a chemical structure file.")).toBeInTheDocument();
  });
});

describe("TableChart strings (i18n)", () => {
  it("renders the per-value chart-type controls and the row# picker option in English", () => {
    render(<TableChart table={T} />);
    // Chart-type enum values (line/bar/scatter) are per-value keyed — English is
    // byte-identical to the raw ChartType values.
    for (const label of ["line", "bar", "scatter"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("row #")).toBeInTheDocument();
  });

  it("shows the no-numeric-columns message in English", () => {
    const empty: ParsedTable = { columns: ["a"], rows: [["x"]], truncated: false };
    render(<TableChart table={empty} />);
    expect(screen.getByText("No numeric columns to chart.")).toBeInTheDocument();
  });
});

describe("GenomeView strings (i18n)", () => {
  it("renders the zoom/reset controls and pluralized feature count in English", () => {
    render(<GenomeView filename="ann.bed" text={BED} />);
    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
    expect(screen.getByLabelText("Reset view")).toBeInTheDocument();
    expect(screen.getByText(/1 features/)).toBeInTheDocument();
  });

  it("renders the not-an-annotation-file message in English", () => {
    render(<GenomeView filename="notes.txt" text="hello" />);
    expect(screen.getByText("Not a genome annotation file.")).toBeInTheDocument();
  });
});

describe("DosView strings (i18n)", () => {
  it("renders the per-value axis-alignment toggle in English", () => {
    render(<DosView filename="DOSCAR" bytes={bytesOf(SPIN)} />);
    expect(screen.getByRole("button", { name: "E − E_F" })).toBeInTheDocument();
  });
});

describe("QCodeView strings (i18n)", () => {
  it("renders the codebook heading, exact-quote badge, and pluralized counts in English", () => {
    const DOC = JSON.stringify({
      sources: [{ id: "i1", title: "Interview 1", text: "I trust the doctor." }],
      codes: [{ name: "trust" }],
      annotations: [{ source: "i1", code: "trust", start: 2, end: 18 }],
    });
    render(<QCodeView filename="study.qcode" text={DOC} />);
    expect(screen.getByText("Codebook")).toBeInTheDocument();
    expect(screen.getByText("quotes are exact source spans")).toBeInTheDocument();
    expect(screen.getByText(/1 source/)).toBeInTheDocument();
    expect(screen.getByText(/1 code/)).toBeInTheDocument();
  });
});
