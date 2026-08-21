import { useCallback, useEffect, useRef, useState } from "react";

// How long a press has to hold still before it's treated as "pick this row
// up to drag" rather than "tap to navigate" - long enough that a normal tap
// or the start of a scroll never accidentally triggers a drag.
const LONG_PRESS_MS = 350;
// How far a pointer can move before the long-press timer fires without
// cancelling it - anything past this while still waiting reads as a scroll
// gesture, not someone holding still, so the timer is dropped and normal
// scrolling/tapping proceeds untouched.
const MOVE_CANCEL_PX = 10;

// Long-press-and-drag reordering for NavPanel's Chambers list (desktop
// mouse and mobile touch both go through Pointer Events, so one
// implementation covers both). Each row calls `onPointerDown` on press and
// `onClickCapture` on the eventual click; `setRowRef(name)` wires up a ref
// callback each row passes to its own root element so drag math can read
// real layout positions instead of assuming a fixed row height.
export function useReorderableList<T extends string>(
  order: T[],
  // Fires on every slot crossing while actively dragging - cheap, state-only
  // update so the list visibly reflows as the row moves.
  onReorder: (next: T[]) => void,
  // Fires once, on drop, with the final order - the place to do anything
  // more expensive than a state update (useChamberOrder's commitOrder
  // writes to localStorage here instead of on every crossing).
  onDrop: (next: T[]) => void
): {
  draggingName: T | null;
  setRowRef: (name: T) => (el: HTMLElement | null) => void;
  onPointerDown: (name: T, e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
} {
  const [draggingName, setDraggingName] = useState<T | null>(null);
  const rowRefs = useRef(new Map<T, HTMLElement>());
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  // Measured once when a drag actually starts, not re-measured on every
  // pointermove - rows are fixed-height and the list doesn't scroll during
  // a drag, so a row's live bounding rect never actually changes over the
  // course of one gesture except as a *result* of the reordering itself
  // (which visually shifts other rows), and the target slot is fully
  // determined by these two numbers plus arithmetic.
  const rowHeightRef = useRef(0);
  const firstTopRef = useRef(0);

  const setRowRef = useCallback(
    (name: T) => (el: HTMLElement | null) => {
      if (el) rowRefs.current.set(name, el);
      else rowRefs.current.delete(name);
    },
    []
  );

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  const onPointerDown = useCallback((name: T, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    didDragRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      didDragRef.current = true;
      const firstName = orderRef.current[0];
      const firstRect = firstName ? rowRefs.current.get(firstName)?.getBoundingClientRect() : undefined;
      rowHeightRef.current = firstRect?.height ?? 0;
      firstTopRef.current = firstRect?.top ?? 0;
      setDraggingName(name);
    }, LONG_PRESS_MS);
  }, []);

  // A drag that actually moved the list must not also fire the row's own
  // <Link> navigation (or NavPanel's close-on-navigate) once the pointer
  // lifts - capture-phase so it runs before React's own onClick handlers.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
    didDragRef.current = false;
  }, []);

  useEffect(() => {
    if (!draggingName) {
      // Waiting out the long-press window (or not pressed at all) - only
      // watching for an early release or enough movement to cancel it and
      // fall back to ordinary scroll/tap behavior.
      function onMove(e: PointerEvent) {
        if (!startRef.current) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
          clearTimer();
          startRef.current = null;
        }
      }
      function onUp() {
        clearTimer();
        startRef.current = null;
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    }

    // Actively dragging: move the held row to whichever slot the pointer is
    // currently over. Target slot is computed from the row height/first-row
    // top measured once at drag start, not from a fresh getBoundingClientRect
    // per row per frame - equivalent to the old "first row whose midpoint is
    // below the pointer" scan for a uniformly-spaced list (rounding to the
    // nearest slot center is the same comparison, just arithmetic instead of
    // N forced layout reads). Reordering fires live, not just on drop, so
    // the list visibly reflows as the row moves.
    const name = draggingName;
    function moveToPointer(clientY: number) {
      const rowHeight = rowHeightRef.current;
      if (rowHeight <= 0) return;
      const count = orderRef.current.length;
      const raw = (clientY - firstTopRef.current) / rowHeight;
      const targetIndex = Math.min(count - 1, Math.max(0, Math.round(raw)));
      const currentIndex = orderRef.current.indexOf(name);
      if (targetIndex === currentIndex || currentIndex === -1) return;
      const next = orderRef.current.filter((n) => n !== name);
      next.splice(targetIndex, 0, name);
      orderRef.current = next;
      onReorderRef.current(next);
    }

    function onMove(e: PointerEvent) {
      e.preventDefault();
      moveToPointer(e.clientY);
    }
    function onUp() {
      startRef.current = null;
      setDraggingName(null);
      onDropRef.current(orderRef.current);
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [draggingName]);

  return { draggingName, setRowRef, onPointerDown, onClickCapture };
}
