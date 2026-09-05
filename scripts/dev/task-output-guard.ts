export const EMPTY_TASK_RESULT_MESSAGE = [
  "The subagent ended without a usable text result.",
  "Its provider stream was likely truncated, so this task failed and must not be treated as an empty finding.",
  "Resume this task ID once. If it is empty again, use another configured model/provider or report the failure to the user.",
].join(" ");

interface TaskHookInput {
  tool?: unknown;
}

interface TaskHookOutput {
  output?: unknown;
  metadata?: unknown;
}

/** Convert a silent empty subagent result into a model-visible error. */
export function guardEmptyTaskResult(input: TaskHookInput, output: TaskHookOutput): boolean {
  if (typeof input.tool !== "string" || input.tool.toLowerCase() !== "task") return false;
  if (typeof output.output !== "string") return false;
  const result = /<task_result>([\s\S]*?)<\/task_result>/i.exec(output.output);
  if (!result || result[1].trim()) return false;

  const taskId = /<task\b[^>]*\bid=["']([^"']+)["']/i.exec(output.output)?.[1];
  output.output = [
    `<task${taskId ? ` id="${taskId}"` : ""} state="error">`,
    "<task_error>",
    EMPTY_TASK_RESULT_MESSAGE,
    "</task_error>",
    "</task>",
  ].join("\n");
  const metadata =
    output.metadata && typeof output.metadata === "object"
      ? (output.metadata as Record<string, unknown>)
      : {};
  output.metadata = {
    ...metadata,
    nebulamatTaskGuard: { reason: "empty_subagent_result" },
  };
  return true;
}
