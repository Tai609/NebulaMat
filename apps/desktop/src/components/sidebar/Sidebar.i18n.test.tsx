import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";

// COPYCAT RULE: useUiStore is module-global; reset the locale after each test
// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

describe("Sidebar i18n", () => {
  it("renders migrated nav labels and section heading in English", async () => {
    renderAt("/files");

    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByText("Files")).toBeInTheDocument();
    expect(within(nav).getByText("Review")).toBeInTheDocument();
    expect(within(nav).queryByText("Runs")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Materials")).not.toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
