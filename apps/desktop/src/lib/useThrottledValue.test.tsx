import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledValue } from "./useThrottledValue";

describe("useThrottledValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the initial value immediately", () => {
    const { result } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });

  it("commits the first change at once, then holds rapid updates to the trailing value", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: "a" },
    });

    // The first change lands immediately — no commit has happened this window.
    act(() => rerender({ v: "b" }));
    expect(result.current).toBe("b");

    // Further changes inside the window are held; the display stays put.
    act(() => rerender({ v: "c" }));
    act(() => rerender({ v: "d" }));
    expect(result.current).toBe("b");

    // Once the window elapses, only the latest (trailing) value is committed —
    // intermediate "c" is skipped, exactly what caps the markdown re-parse rate.
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("d");
  });

  it("settles on the final value and schedules nothing further", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: "a" },
    });
    act(() => rerender({ v: "b" })); // immediate
    act(() => rerender({ v: "c" })); // throttled
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("c");

    // A stable value leaves no pending timer — time passing changes nothing.
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe("c");
  });
});
