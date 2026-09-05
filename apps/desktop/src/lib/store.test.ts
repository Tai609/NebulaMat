import { beforeEach, describe, expect, it } from "vitest";
import { initialTheme, useUiStore } from "./store";

describe("uiStore theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ theme: "warm", aquaBlur: 20, aquaFrost: 18, aquaBrightness: 58 });
  });

  it("cycles theme and persists to localStorage", () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("dark");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBe("dark");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("aqua");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBe("aqua");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBe("light");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("warm");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBe("warm");
  });

  it("defaults to Aqua when no theme preference exists", () => {
    expect(initialTheme()).toBe("aqua");
  });

  it("clamps and persists Aqua glass controls", () => {
    useUiStore.getState().setAquaBlur(41);
    useUiStore.getState().setAquaFrost(-1);
    useUiStore.getState().setAquaBrightness(120);

    expect(useUiStore.getState().aquaBlur).toBe(40);
    expect(useUiStore.getState().aquaFrost).toBe(0);
    expect(useUiStore.getState().aquaBrightness).toBe(100);
    expect(window.localStorage.getItem("ai4s.aqua.blur")).toBe("40");
    expect(window.localStorage.getItem("ai4s.aqua.frost")).toBe("0");
    expect(window.localStorage.getItem("ai4s.aqua.brightness")).toBe("100");
  });

  it("uses the original Aqua brightness range", () => {
    useUiStore.getState().setAquaBrightness(-20);
    expect(useUiStore.getState().aquaBrightness).toBe(0);
    useUiStore.getState().setAquaBrightness(50);
    expect(useUiStore.getState().aquaBrightness).toBe(50);
    useUiStore.getState().setAquaBrightness(80);
    expect(useUiStore.getState().aquaBrightness).toBe(80);
  });
});
