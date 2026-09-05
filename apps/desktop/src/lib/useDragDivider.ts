import { useCallback, useRef, useState } from "react";

/** A pointer position during a divider drag, plus the divider container's
 *  bounding box captured at pointer-down. Interior split dividers compute a
 *  fraction from `x - rect.left`; window-anchored dividers ignore `rect` and
 *  read `x`/`y` against the viewport. */
export interface DragPoint {
  x: number;
  y: number;
  rect: DOMRect;
}

export interface UseDragDividerOptions {
  /** The committed value the drag seeds from (a px width, or a 0..1 fraction). */
  value: number;
  /** Map a pointer position to the next value. Return `null` to request a
   *  collapse — the drag KEEPS running (so the user can drag back out, as the
   *  sidebar does); callers that unmount on collapse simply end the drag that
   *  way. */
  compute: (p: DragPoint) => number | null;
  /** Persist the live value on pointer-up. */
  onCommit: (value: number) => void;
  /** `compute` returned `null` — enter the collapsed state. Fires once per
   *  transition into the collapse zone. */
  onCollapse?: () => void;
  /** `compute` returned a number after a collapse — leave the collapsed state.
   *  Fires once per transition back out. */
  onExpand?: () => void;
}

export interface DragDivider {
  /** True while a drag is in progress. */
  dragging: boolean;
  /** The live value during a drag; `null` when idle (fall back to the committed
   *  value). */
  dragValue: number | null;
  /** Spread onto the draggable divider element. */
  handleProps: Pick<
    React.DOMAttributes<HTMLElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
  >;
}

/**
 * Shared divider-drag mechanics: pointer capture, container-rect capture at
 * pointer-down, a live drag value, and commit-on-pointer-up. The geometry
 * (window-edge vs. interior/relative) lives in the caller's `compute`, so one
 * hook backs the sidebar, the right inspector, and interior split dividers.
 */
export function useDragDivider(options: UseDragDividerOptions): DragDivider {
  const [dragValue, setDragValue] = useState<number | null>(null);
  // Latest options without re-binding the (stable) pointer handlers each render.
  const optsRef = useRef(options);
  optsRef.current = options;
  const rectRef = useRef<DOMRect | null>(null);
  const collapsedRef = useRef(false);
  const dragging = dragValue !== null;

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    rectRef.current = e.currentTarget.getBoundingClientRect();
    collapsedRef.current = false;
    setDragValue(optsRef.current.value);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (rectRef.current === null) return;
    const next = optsRef.current.compute({ x: e.clientX, y: e.clientY, rect: rectRef.current });
    if (next === null) {
      if (!collapsedRef.current) {
        collapsedRef.current = true;
        optsRef.current.onCollapse?.();
      }
      return; // keep the last value so pointer-up commits a sane width
    }
    if (collapsedRef.current) {
      collapsedRef.current = false;
      optsRef.current.onExpand?.();
    }
    setDragValue(next);
  }, []);

  const endDrag = useCallback(() => {
    setDragValue((v) => {
      if (v !== null) optsRef.current.onCommit(v);
      return null;
    });
    rectRef.current = null;
    collapsedRef.current = false;
  }, []);

  return {
    dragging,
    dragValue,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
