import type { AnswersState, GenuiBlockProps, QuestionMeta } from './state.ts';
import type { GenuiInput, GenuiRadio, GenuiSelect, GenuiSlider, GenuiSubmit, GenuiSwitch, GenuiTextarea } from '../spec.ts';
export declare function RadioNode({ node, onAction, answers }: {
    node: GenuiRadio;
    onAction?: GenuiBlockProps['onAction'];
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Resolve a question's correct label from its metadata. */
export declare function correctLabelOf(m: QuestionMeta): string | undefined;
/** Submit: the "交卷" control of a grouped-radio block. LOCAL-FIRST (v2.6):
 * when at least one question carries `answer` data the click grades IN PLACE
 * — score, per-question right/wrong, explanations — with zero model round
 * trip, and locks the questions until 重新作答 resets them. Only when NO
 * question has answers does it fall back to firing ONE action
 * (`{type:'submit', answers, total, answered}`). Disabled until the
 * selection criteria are met (all listed groups answered, or ≥1 answer
 * without a group list); the hint shows the progress. */
export declare function SubmitNode({ node, onAction, answers }: {
    node: GenuiSubmit;
    onAction?: GenuiBlockProps['onAction'];
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Switch: toggle with local state. */
export declare function SwitchNode({ node, onAction }: {
    node: GenuiSwitch;
    onAction?: GenuiBlockProps['onAction'];
}): import("react").JSX.Element;
/** Slider: range input for numeric form values (v2.9). Field-aligned: with an
 * `id` the value persists across refresh and joins the sibling submit's
 * `fields` collection (stored as the numeric string); a model-provided
 * default registers at mount; a restored durable value wins. Dragging fires
 * the action (block-level debounce collapses the drag into one delivery). */
export declare function SliderNode({ node, onAction, answers }: {
    node: GenuiSlider;
    onAction?: GenuiBlockProps['onAction'];
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Reuse the DSH main input's three-layer IME protection (verified in the
 *  host InputBar): composition start arms a ref, composition end clears it
 *  10ms later (Safari sends the closing keydown BEFORE compositionend), and
 *  every submit keydown re-checks the ref, the native `isComposing` flag,
 *  and `keyCode === 229`. A Chinese selection Enter must never submit. */
export declare function useImeComposing(): {
    isComposing: () => boolean;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
};
export declare function isImeSubmitKeydown(e: React.KeyboardEvent): boolean;
/** Select: single choice from a dropdown, field-aligned (v2.8). With an `id`
 * the chosen option persists across refresh and joins the sibling submit's
 * `fields` collection; a model-provided `selected` default registers at
 * mount; a restored durable value wins over both. Without any default a
 * placeholder option shows — nothing is silently pre-registered (same
 * philosophy as radio). */
export declare function SelectNode({ node, onAction, answers }: {
    node: GenuiSelect;
    onAction?: GenuiBlockProps['onAction'];
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Input: single-line field. Controlled (value tracked for persistence and
 *  submit collection when `id` is set). With `action`: Enter submits
 *  immediately (`{type:'input', value, submit:true}`), blur sends too —
 *  the user never has to click elsewhere for the value to reach the model.
 *  Enter during IME composition never submits. `inputType: 'password'`
 *  stays masked; its value is never persisted and never joins submit
 *  collection (secrets stay out of localStorage), while its own `action`
 *  still delivers on explicit user submit. */
export declare function InputNode({ node, onAction, answers }: {
    node: GenuiInput;
    onAction?: GenuiBlockProps['onAction'];
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Textarea: multi-line input; with `action`, blurring sends the value and
 *  Ctrl/Cmd+Enter submits immediately. Controlled when `id` is set (durable
 *  value + submit collection). Ctrl/Cmd+Enter during IME composition never
 *  submits. */
export declare function TextareaNode({ node, onAction, answers }: {
    node: GenuiTextarea;
    onAction?: GenuiBlockProps['onAction'];
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Accordion: collapsible sections with local open state. Headings and
 * bodies are wired via useId (`aria-controls`/`aria-labelledby`). */
