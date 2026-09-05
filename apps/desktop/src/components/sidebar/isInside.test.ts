import { describe, expect, it } from "vitest";
import { isInside } from "./Sidebar";

describe("isInside", () => {
  it("recognizes a folder inside the workspace, at any depth", () => {
    expect(isInside("/Users/a/Documents/OpenScience/仙侠克苏鲁", "/Users/a/Documents/OpenScience")).toBe(true);
    expect(isInside("/Users/a/Documents/OpenScience/projects/bci", "/Users/a/Documents/OpenScience")).toBe(true);
    expect(isInside("/Users/a/Documents/OpenScience", "/Users/a/Documents/OpenScience")).toBe(true);
  });

  it("compares whole segments — a shared prefix is not containment", () => {
    // The bug a naive startsWith would have: this folder is NOT in the workspace.
    expect(isInside("/Users/a/Documents/OpenScience-old/x", "/Users/a/Documents/OpenScience")).toBe(false);
    expect(isInside("/Users/a/Documents/Other", "/Users/a/Documents/OpenScience")).toBe(false);
  });

  it("ignores trailing slashes and doubled separators", () => {
    expect(isInside("/base/proj/", "/base/")).toBe(true);
    expect(isInside("/base//proj", "/base")).toBe(true);
  });

  it("handles Windows separators", () => {
    expect(isInside("C:\\Users\\a\\OpenScience\\proj", "C:\\Users\\a\\OpenScience")).toBe(true);
    expect(isInside("C:\\Users\\a\\Elsewhere", "C:\\Users\\a\\OpenScience")).toBe(false);
  });

  it("treats an empty base as containing nothing", () => {
    expect(isInside("/base/proj", "")).toBe(false);
  });
});
