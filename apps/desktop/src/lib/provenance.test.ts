import { describe, expect, it } from "vitest";
import type { ToolUpdatedEvent } from "@ai4s/sdk";
import { provenanceInputFromEvent, provenanceInputsFromEvent } from "./provenance";

const write = (over: Partial<ToolUpdatedEvent> = {}): ToolUpdatedEvent => ({
  type: "tool.updated",
  sessionId: "ses_1",
  callId: "call_1",
  tool: "write",
  status: "success",
  input: { filePath: "fig/plot.py", content: "print(1)" },
  ...over,
});

describe("provenanceInputFromEvent", () => {
  it("derives a record from a successful write with its content", () => {
    const r = provenanceInputFromEvent(write({ title: "Rewrote the plotting helper" }));
    expect(r).toEqual({
      eventId: "call_1:fig/plot.py",
      path: "fig/plot.py",
      tool: "write",
      content: "print(1)",
      log: "Rewrote the plotting helper",
    });
  });

  it("replaces path-only or empty titles with a compact tool → path log", () => {
    // OpenCode write titles are usually just the file path — redundant.
    const paths = provenanceInputFromEvent(write({ title: "Users/x/OpenScience/fig/plot.py" }));
    expect(paths?.log).toBe("write → fig/plot.py");
    const empty = provenanceInputFromEvent(write({ title: "" }));
    expect(empty?.log).toBe("write → fig/plot.py");
  });

  it("captures an edit's diff for lineage when full content isn't available", () => {
    // OpenCode's edit tool carries oldString/newString (not `content`), so the
    // full file text isn't in the event — but its unified diff is.
    const edit = provenanceInputFromEvent(
      write({
        tool: "edit",
        input: { filePath: "fig/plot.py", oldString: "print(1)", newString: "print(2)" },
        diff: "--- a/fig/plot.py\n+++ b/fig/plot.py\n@@ -1 +1 @@\n-print(1)\n+print(2)",
      }),
    );
    expect(edit?.content).toBeUndefined();
    expect(edit?.diff).toContain("+print(2)");
  });

  it("ignores non-success, non-write, and pathless events", () => {
    expect(provenanceInputFromEvent(write({ status: "running" }))).toBeNull();
    expect(provenanceInputFromEvent(write({ tool: "bash" }))).toBeNull();
    expect(provenanceInputFromEvent(write({ input: {} }))).toBeNull();
  });

  it("fans an apply_patch call out to one record per file", () => {
    // apply_patch names each file inside `patchText` (not in a path field) and can
    // touch many files at once — every add/update must become its own version.
    const patchText = [
      "*** Begin Patch",
      "*** Add File: PROGRESS.md",
      "+2026-07-16 done",
      "*** Update File: src/plot.py",
      "@@ -1 +1 @@",
      "-print(1)",
      "+print(2)",
      "*** Delete File: old.tmp",
      "*** End Patch",
    ].join("\n");
    const records = provenanceInputsFromEvent({
      type: "tool.updated",
      sessionId: "ses_1",
      callId: "call_1",
      tool: "apply_patch",
      status: "success",
      input: { patchText },
    } as unknown as ToolUpdatedEvent);

    expect(records.map((r) => r.path)).toEqual(["PROGRESS.md", "src/plot.py"]); // delete skipped
    const added = records.find((r) => r.path === "PROGRESS.md");
    expect(added?.content).toBe("2026-07-16 done"); // `+` stripped → full new text
    expect(added?.diff).toBeUndefined();
    const updated = records.find((r) => r.path === "src/plot.py");
    expect(updated?.content).toBeUndefined();
    expect(updated?.diff).toContain("+print(2)"); // diff kept for lineage
  });

  it("wraps a single non-patch write as a one-element list, [] when not version-worthy", () => {
    expect(provenanceInputsFromEvent(write()).map((r) => r.path)).toEqual(["fig/plot.py"]);
    expect(provenanceInputsFromEvent(write({ status: "running" }))).toEqual([]);
    expect(provenanceInputsFromEvent(write({ tool: "bash" }))).toEqual([]);
  });

  it("records mutating jupyter tools but not reads", () => {
    const jupyter = (tool: string) =>
      write({ tool, input: { notebook_path: "analysis.ipynb" } });
    expect(provenanceInputFromEvent(jupyter("jupyter_insert_cell"))?.path).toBe("analysis.ipynb");
    expect(provenanceInputFromEvent(jupyter("jupyter_execute_cell"))?.path).toBe("analysis.ipynb");
    expect(provenanceInputFromEvent(jupyter("jupyter_read_cells"))).toBeNull();
    expect(provenanceInputFromEvent(jupyter("jupyter_list_files"))).toBeNull();
  });
});
