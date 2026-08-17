import { useEffect, useRef, useState } from "react";
import { fits, type GridDims } from "./grid";

export interface DragState {
  chamber: string;
  widgetId: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  pointerStartX: number;
  pointerStartY: number;
  currentX: number;
  currentY: number;
}

export interface UseWidgetDragOptions {
  cellPx: number;
  gapPx: number;
  dims: GridDims;
  // Cells occupied by every widget OTHER than the one currently being
  // dragged, keyed fresh per render via a ref so the drag's pointer
  // listeners (set up once per gesture, not once per render) always see the
  // latest occupancy without needing to be torn down and rebuilt mid-drag.
  occupiedExcluding: (chamber: string, widgetId: string) => Set<string>;
  onCommit: (chamber: string, widgetId: string, x: number, y: number) => void;
}

// Pointer-based (not touch-only, since edit mode is plausibly used with a
// mouse too) drag-to-move: snaps to the nearest cell under the pointer on
// release, rejecting (no commit - the widget just stays where it was) if the
// target overlaps another placed widget or falls outside the grid. No
// resize, no swap - "put and move" only, per the confirmed scope.
export function useWidgetDrag(options: UseWidgetDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function startDrag(
    e: React.PointerEvent,
    chamber: string,
    widgetId: string,
    width: number,
    height: number,
    originX: number,
    originY: number
  ) {
    e.preventDefault();
    // Keeps receiving pointermove/up for this gesture even if the pointer
    // strays off the (small, edge-of-cell) drag handle mid-drag - without
    // this, a fast or imprecise drag can end up not firing pointerup on any
    // listened element, though window-level listeners below still catch
    // most cases regardless; capture just makes it reliable.
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({
      chamber,
      widgetId,
      width,
      height,
      originX,
      originY,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
  }

  useEffect(() => {
    if (!drag) return;

    function onMove(e: PointerEvent) {
      setDrag((d) => (d ? { ...d, currentX: e.clientX, currentY: e.clientY } : d));
    }

    function onUp() {
      setDrag((d) => {
        if (d) {
          const { cellPx, gapPx, dims, occupiedExcluding, onCommit } = optionsRef.current;
          const step = cellPx + gapPx;
          const cellDx = Math.round((d.currentX - d.pointerStartX) / step);
          const cellDy = Math.round((d.currentY - d.pointerStartY) / step);
          const targetX = d.originX + cellDx;
          const targetY = d.originY + cellDy;
          const occupied = occupiedExcluding(d.chamber, d.widgetId);
          if (fits({ x: targetX, y: targetY, width: d.width, height: d.height }, dims, occupied)) {
            onCommit(d.chamber, d.widgetId, targetX, targetY);
          }
        }
        return null;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // Deliberately depends only on whether a drag is active, not on `drag`
    // itself (which gets a new object identity every pointermove) or on
    // `options` (read fresh via optionsRef instead) - otherwise these
    // listeners would be torn down and rebuilt on every pointer move.
  }, [Boolean(drag)]);

  return { drag, startDrag };
}
