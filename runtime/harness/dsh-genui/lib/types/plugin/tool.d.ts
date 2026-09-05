/**
 * The `render_ui` tool: a model-facing channel that renders a GenUI spec as
 * an interactive card in the conversation TOOL ROW (route A of the design
 * doc). The ```dsh-ui fence channel renders inline in the reply; this tool
 * renders in the tool row and rides the harness's result `meta` projection:
 * `presentationMeta` stores the repaired spec, the browser toolview
 * (`src/client/toolview.tsx`) reads it from the result node and renders.
 *
 * Zero runtime harness imports, deliberately: an external plugin's node half
 * must not depend on the harness module graph at runtime (the profile
 * resolves only the plugin package itself). The definition is therefore a
 * plain `ToolDefinition` object — the exact shape `defineTool` returns — with
 * the arguments schema authored as JSON Schema (the harness validates args
 * and output with the same JSON Schema validator defineTool uses). Deep
 * validation, deterministic repair, and resource limits live in the shared
 * guard (`src/client/guard.ts`), which the schema deliberately stays loose
 * enough to reach.
 * @module @omdsh-dev/dsh-genui/plugin/tool
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/**
 * Build the render_ui tool definition. Registered by the plugin node half;
 * `ctx.tools.register` consumes it exactly like a `defineTool` result.
 */
export declare function createRenderUiTool(): ToolDefinition;
/** Build the validate_dsh_ui tool definition (registered alongside render_ui). */
export declare function createValidateDshUiTool(): ToolDefinition;
