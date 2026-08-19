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
  onReorder: (next: T[]) => void
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
    // currently over, using each row's own live bounding rect (not an
    // assumed fixed height) - reordering fires live, not just on drop, so
    // the list visibly reflows as the row moves. Captured into a local so
    // TS can narrow it to non-null once for the rest of this closure -
    // `draggingName` itself is a useState value, not something TS treats as
    // const across nested function bodies.
    const name = draggingName;
    function moveToPointer(clientY: number) {
      const entries = orderRef.current.map((n) => {
        const rect = rowRefs.current.get(n)?.getBoundingClientRect();
        return { n, mid: rect ? rect.top + rect.height / 2 : 0 };
      });
      let targetIndex = entries.findIndex((entry) => clientY < entry.mid);
      if (targetIndex === -1) targetIndex = entries.length - 1;
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
