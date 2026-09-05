import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModalCard } from "./ModalCard";

// In the test (non-Tauri) environment isTauri is false, so the card renders its
// "desktop app" fallback without invoking any Rust command — a mount smoke test.
describe("ModalCard", () => {
  it("renders the Modal compute card without crashing", () => {
    render(<ModalCard />);
    expect(screen.getByText(/Cloud compute \(Modal\)/)).toBeInTheDocument();
    expect(screen.getByText(/Available in the desktop app|Not installed|Ready/)).toBeInTheDocument();
  });
});
