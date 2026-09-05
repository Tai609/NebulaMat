/**
 * Basic display family: avatar palette, and the local click-feedback button
 * (the actionable-button chip). Used by the render dispatcher.
 * @module @omdsh-dev/dsh-genui/client/blocks/basic
 */
import { type ReactNode } from 'react';
export declare function avatarColor(name: string): string;
/** Button with LOCAL click feedback: clicking an actionable button shows a
 * brief "✓ 已触发" chip so the user sees the click registered even while the
 * model round trip is in flight — no more "点了没反应" perception. The chip
 * is purely cosmetic; the action fires through `onClick` as before. */
export declare function ClickFeedbackButton({ className, disabled, onClick, children }: {
    className: string;
    disabled?: boolean;
    onClick?: (() => void) | undefined;
    children: ReactNode;
}): import("react").JSX.Element;
