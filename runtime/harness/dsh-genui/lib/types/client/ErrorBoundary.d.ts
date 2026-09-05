/**
 * Rendering error boundary: a component render failure inside one GenUI
 * block must never take down the whole chat surface (pre-2026-08-09 builds
 * crashed the entire conversation tree on a missing API). Every fence,
 * toolview card and panel body renders under this boundary; on error the
 * block degrades to a compact inline alert instead of unmounting the tree.
 * @module @omdsh-dev/dsh-genui/client
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
interface ErrorBoundaryProps {
    /** What the block is, shown in the fallback alert (fence / tool / panel). */
    label?: string;
    children: ReactNode;
}
interface ErrorBoundaryState {
    error: Error | null;
}
/**
 * Class boundary because function components cannot catch their own subtree
 * errors. `getDerivedStateFromError` flips to the fallback render; the error
 * itself is logged (and its message surfaced in the alert) so the user sees
 * a hint instead of a silent white region.
 */
export declare class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState;
    static getDerivedStateFromError(error: Error): ErrorBoundaryState;
    componentDidCatch(error: Error, info: ErrorInfo): void;
    render(): ReactNode;
}
export {};
