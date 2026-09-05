import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "./LocaleProvider";
import { useUiStore } from "@/lib/store";
import i18n from "@/i18n";

afterEach(async () => {
  await act(async () => {
    useUiStore.getState().setLocale("en");
  });
});

describe("LocaleProvider", () => {
  it("applies the current locale to <html lang> and dir", () => {
    render(<LocaleProvider><span>x</span></LocaleProvider>);
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("changes i18next language and html attrs when locale changes", async () => {
    render(<LocaleProvider><span>x</span></LocaleProvider>);
    await act(async () => {
      useUiStore.getState().setLocale("ja");
    });
    expect(document.documentElement.lang).toBe("ja");
    await waitFor(() => expect(i18n.language).toBe("ja"));
  });
});
