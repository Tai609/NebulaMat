import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

vi.mock("@/lib/tauri", () => ({
  importKnowledgeBase: vi.fn(),
  isTauri: false,
  knowledgeBaseArticles: vi.fn(),
  knowledgeBaseGraph: vi.fn(),
  knowledgeBaseStatus: vi.fn(),
  searchKnowledgeBase: vi.fn(),
}));

vi.mock("@/components/knowledge/KnowledgeUniverseCanvas", () => ({
  KnowledgeUniverseCanvas: () => <div data-testid="knowledge-universe-canvas" />,
}));

import { KnowledgeBasePage } from "./KnowledgeBasePage";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("KnowledgeBasePage theme integration", () => {
  it("uses the shared semantic theme tokens for the page, controls, and category buttons", () => {
    const { container } = render(<KnowledgeBasePage />);

    expect(container.firstElementChild).toHaveClass("bg-bg", "text-text");
    expect(screen.getByRole("button", { name: "Source and index" })).toHaveClass("text-text", "hover:bg-surface-2");
    expect(screen.getByRole("button", { name: "Universe controls" })).toHaveClass("text-text", "hover:bg-surface-2");
    expect(screen.getByRole("button", { name: "Search" })).toHaveClass("bg-accent", "text-accent-fg");
    expect(screen.getByRole("combobox", { name: "Select an article to load" })).toHaveClass(
      "knowledge-article-select",
    );

    const allFilter = screen.getByRole("button", { name: "all" });
    const chemicalFilter = screen.getByRole("button", { name: "chemicals" });
    expect(allFilter).toHaveStyle({ borderColor: "var(--accent)", color: "var(--text)" });
    expect(chemicalFilter).toHaveStyle({ borderColor: "var(--border)", color: "var(--muted)" });

    fireEvent.click(chemicalFilter);
    expect(chemicalFilter).toHaveStyle({ borderColor: "var(--series-1)", color: "var(--text)" });
    expect(allFilter).toHaveStyle({ borderColor: "var(--border)", color: "var(--muted)" });

    expect(container.innerHTML).not.toMatch(/(?:cyan|amber|rose|emerald)-|#[0-9a-f]{3,8}|rgba?\(/i);
  });
});
