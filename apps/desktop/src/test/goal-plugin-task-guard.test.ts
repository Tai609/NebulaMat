import {
  EMPTY_TASK_RESULT_MESSAGE,
  guardEmptyTaskResult,
} from "../../../../scripts/dev/task-output-guard.ts";

describe("packaged goal-plugin task guard", () => {
  it("turns an empty task result into an explicit resumable failure", () => {
    const output = {
      output: '<task id="ses_child" state="completed">\n<task_result>\n\n</task_result>\n</task>',
      metadata: { sessionId: "ses_child" },
    };

    expect(guardEmptyTaskResult({ tool: "task" }, output)).toBe(true);
    expect(output.output).toContain('<task id="ses_child" state="error">');
    expect(output.output).toContain("<task_error>");
    expect(output.output).toContain(EMPTY_TASK_RESULT_MESSAGE);
    expect(output.metadata).toMatchObject({
      sessionId: "ses_child",
      nebulamatTaskGuard: { reason: "empty_subagent_result" },
    });
  });

  it("leaves non-empty and non-task outputs unchanged", () => {
    const task = { output: "<task_result>usable report</task_result>" };
    const bash = { output: "<task_result></task_result>" };

    expect(guardEmptyTaskResult({ tool: "task" }, task)).toBe(false);
    expect(task.output).toBe("<task_result>usable report</task_result>");
    expect(guardEmptyTaskResult({ tool: "bash" }, bash)).toBe(false);
    expect(bash.output).toBe("<task_result></task_result>");
  });
});
