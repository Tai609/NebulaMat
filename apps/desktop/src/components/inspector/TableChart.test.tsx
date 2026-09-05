import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TableChart } from "./TableChart";
import type { ParsedTable } from "@/lib/csv";

const T: ParsedTable = {
  columns: ["month", "sales", "returns"],
  rows: [
    ["Jan", "100", "5"],
    ["Feb", "120", "8"],
    ["Mar", "90", "3"],
  ],
  truncated: false,
};

describe("TableChart", () => {
  it("renders chart-type controls, an X picker, and the numeric series", () => {
    const { container } = render(<TableChart table={T} />);
    for (const t of ["line", "bar", "scatter"]) {
      expect(screen.getByRole("button", { name: t })).toBeInTheDocument();
    }
    // numeric series toggles present (sales, returns); the categorical "month" is not a series
    expect(screen.getByRole("button", { name: /sales/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /returns/ })).toBeInTheDocument();
    // default is a bar chart (categorical X) → <rect> marks drawn
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("switches to a line chart, drawing polylines", async () => {
    const { container } = render(<TableChart table={T} />);
    await userEvent.click(screen.getByRole("button", { name: "line" }));
    expect(container.querySelector("path")).not.toBeNull();
  });

  it("shows a message when there is nothing numeric to plot", () => {
    const t: ParsedTable = { columns: ["a", "b"], rows: [["x", "y"]], truncated: false };
    render(<TableChart table={t} />);
    expect(screen.getByText(/No numeric columns to chart/)).toBeInTheDocument();
  });
});
