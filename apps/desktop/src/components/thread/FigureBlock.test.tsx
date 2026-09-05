import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FigureBlock as FigureBlockT } from "@ai4s/shared";
import { FigureBlock } from "./FigureBlock";

const block: FigureBlockT = {
  kind: "figure",
  title: "atlas_fig1a.png",
  src: "data:image/svg+xml;utf8,<svg/>",
  caption: "138 species",
  annotations: [{ index: 1, note: "these labels are hard to see", x: 72, y: 64 }],
};

describe("FigureBlock", () => {
  it("renders the figure and caption", () => {
    render(<FigureBlock block={block} />);
    expect(screen.getByAltText("atlas_fig1a.png")).toBeInTheDocument();
    expect(screen.getByText("138 species")).toBeInTheDocument();
  });

  it("opens an existing pin's note in a popover", async () => {
    render(<FigureBlock block={block} />);
    await userEvent.click(screen.getByRole("button", { name: /Annotation 1/ }));
    expect(await screen.findByText("these labels are hard to see")).toBeInTheDocument();
  });

  it("lets you drop a pin, write a note, and forwards it via onComment", async () => {
    const onComment = vi.fn();
    render(<FigureBlock block={block} onComment={onComment} />);

    await userEvent.click(screen.getByAltText("atlas_fig1a.png"));
    const input = await screen.findByLabelText("Annotation note");
    await userEvent.type(input, "add a scale bar");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onComment).toHaveBeenCalledOnce();
    expect(onComment.mock.calls[0][0]).toMatchObject({ index: 2, note: "add a scale bar" });
    expect(onComment.mock.calls[0][1]).toBe("atlas_fig1a.png");
  });
});
