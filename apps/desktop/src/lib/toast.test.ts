import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes success and error toasts and auto-dismisses them", () => {
    toast.success("Saved to /tmp/a.py");
    toast.error("Could not save b.svg");
    const { toasts } = useToastStore.getState();
    expect(toasts.map((t) => t.tone)).toEqual(["success", "error"]);

    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("dismisses a single toast by id", () => {
    toast.success("one");
    toast.success("two");
    const [first] = useToastStore.getState().toasts;
    useToastStore.getState().dismiss(first.id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["two"]);
  });
});
