import { afterEach, describe, expect, it } from "vitest";
import i18n from "./index";
import { formatNumber } from "./format";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("formatNumber", () => {
  it("groups by the active locale", async () => {
    await i18n.changeLanguage("en");
    expect(formatNumber(1234567)).toBe("1,234,567");
    await i18n.changeLanguage("de");
    // de-DE groups with dots.
    expect(formatNumber(1234567)).toBe("1.234.567");
  });
});
