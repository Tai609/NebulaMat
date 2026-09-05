import type { AnswersState, GenuiBlockProps } from './state.ts';
import type { GenuiAccordion, GenuiBreadcrumb, GenuiCallout, GenuiCode, GenuiCopy, GenuiDiff, GenuiFileTree, GenuiJson, GenuiKeyValue, GenuiMermaid, GenuiPlot, GenuiQuiz, GenuiScene3D, GenuiSteps, GenuiTabs, GenuiTimeline } from '../spec.ts';
/** Callout: a tinted notice box with an optional heading. */
export declare function CalloutNode({ node }: {
    node: GenuiCallout;
}): import("react").JSX.Element;
/** Steps: a vertical progress checklist with an optional current index. */
export declare function StepsNode({ steps }: {
    steps: GenuiSteps;
}): import("react").JSX.Element;
/** KeyValue: a definition list for configs and metadata. */
export declare function KeyValueNode({ node }: {
    node: GenuiKeyValue;
}): import("react").JSX.Element;
/** Plot: SVG function plot over the SafeMath evaluator. */
export declare function PlotNode({ plot }: {
    plot: GenuiPlot;
}): import("react").JSX.Element;
/** Diff: 收编 dsh DiffBlock (same path/oldText/newText shape as DiffHunk). */
export declare function DiffNode({ node }: {
    node: GenuiDiff;
}): import("react").JSX.Element;
/** Json: 收编 dsh JsonTree. */
export declare function JsonNode({ node }: {
    node: GenuiJson;
}): import("react").JSX.Element;
/** Code: 收编 dsh CodeBlock with explicit language. */
export declare function CodeNode({ node }: {
    node: GenuiCode;
}): import("react").JSX.Element;
/**
 * Table: LOCAL sorting (v2.9) — click a header to sort ascending, click
 * again for descending, a third click restores the spec order. Zero model
 * round trip. Numeric cells (numbers or numeric strings) compare numerically;
 * everything else compares as text.
 */
export declare function TabsNode({ tabs, onAction, depth, answers }: {
    tabs: GenuiTabs;
    onAction?: GenuiBlockProps['onAction'];
    depth?: number;
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Radio: one option from a group; local selection state. The group name is
 * useId-based so sibling groups never collide (deterministic per mount).
 *
 * v2.5 aggregation: when `group` is set, the selection is recorded into the
 * block-wide answers registry instead of firing a per-click action — a
 * sibling `submit` node then grades the paper IN PLACE (v2.6, questions
 * carry `answer` data) or collects all groups in ONE action. Without
 * `group`, the legacy per-click action fires. After a local grading the
 * group locks until 重新作答 resets it. */
export declare function AccordionNode({ node, onAction, depth, answers }: {
    node: GenuiAccordion;
    onAction?: GenuiBlockProps['onAction'];
    depth?: number;
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Copy: a one-click copy chip. */
export declare function CopyNode({ node }: {
    node: GenuiCopy;
}): import("react").JSX.Element;
/** Mermaid: lazily loaded diagram renderer. */
export declare function MermaidNode({ node }: {
    node: GenuiMermaid;
}): import("react").JSX.Element;
/** Scene3D: three.js WebGL canvas, lazily imported. */
export declare function Scene3DNode({ node }: {
    node: GenuiScene3D;
}): import("react").JSX.Element;
/** Timeline: vertical event list with time markers. */
export declare function TimelineNode({ node }: {
    node: GenuiTimeline;
}): import("react").JSX.Element;
/** FileTree: indented tree of files and folders. Directory rows are LOCAL
 * collapsible (spec.ts promised "collapsible children"; this makes it true)
 * — click a dir to fold/unfold, default fully open. Zero model round trip. */
export declare function FileTreeNode({ node }: {
    node: GenuiFileTree;
}): import("react").JSX.Element;
/** Quiz: a self-contained teaching question. Selecting an option marks it
 * correct/incorrect in place and reveals feedback + explanation. With
 * `action`, the chosen answer is ALSO sent back to the model
 * (`{type:'quiz', question, answer, correct}`) so the model can collect or
 * grade it — the in-place judging stays local (no round trip needed). */
export declare function QuizNode({ node, onAction }: {
    node: GenuiQuiz;
    onAction?: GenuiBlockProps['onAction'];
}): import("react").JSX.Element;
/** Breadcrumb: path-style navigation trail. */
export declare function BreadcrumbNode({ node }: {
    node: GenuiBreadcrumb;
}): import("react").JSX.Element;
/**
 * Trailing debounce window (ms) for one `[genui-action]` name: rapid
 * repeated interactions on one control (button mashing, switch flipping)
 * collapse into a single action with the LAST payload. Different action
 * names stay independent. The model round-trip takes seconds, so a few
 * hundred ms of trailing delay is imperceptible — and it stops bursts of
 * queued user turns.
 */
