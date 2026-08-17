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
  // True once the pointer has been released and a valid target committed -
  // currentX/Y are frozen at the exact target cell's pixel offset (not the
  // raw, possibly-imprecise release position) and stay that way until the
  // commit settles. See onUp's comment for why this exists.
  settling: boolean;
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
  // Returns a Promise (or promise-like) that settles once the placement is
  // actually persisted - see onUp for why the caller's async round-trip
  // matters here, not just fire-and-forget.
  onCommit: (chamber: string, widgetId: string, x: number, y: number) => Promise<unknown>;
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
      settling: false,
    });
  }

  useEffect(() => {
    if (!drag) return;

    function onMove(e: PointerEvent) {
      setDrag((d) => (d && !d.settling ? { ...d, currentX: e.clientX, currentY: e.clientY } : d));
    }

    function onUp() {
      setDrag((d) => {
        if (!d || d.settling) return d;
        const { cellPx, gapPx, dims, occupiedExcluding, onCommit } = optionsRef.current;
        const step = cellPx + gapPx;
        const cellDx = Math.round((d.currentX - d.pointerStartX) / step);
        const cellDy = Math.round((d.currentY - d.pointerStartY) / step);
        const targetX = d.originX + cellDx;
        const targetY = d.originY + cellDy;
        const occupied = occupiedExcluding(d.chamber, d.widgetId);
        if (!fits({ x: targetX, y: targetY, width: d.width, height: d.height }, dims, occupied)) {
          // Invalid target - nothing to persist, so nothing to wait for;
          // clearing immediately just snaps back to the (unchanged) stored
          // position, which is correct, not a jump.
          return null;
        }
        // Placing/moving a widget round-trips through the server (so a
        // freshly-placed widget is stable on reload, not just an optimistic
        // client guess) - clearing `drag` immediately here would drop the
        // CSS transform right away, and since the underlying stored
        // placement hasn't updated yet, the widget would render at its OLD
        // grid position for one frame, then jump again once the mutation
        // resolves and the layout query refetches. Freezing the transform
        // at exactly the target cell's offset (not the raw pointer
        // position, which may not land precisely on a cell boundary) and
        // holding it there until the commit settles means the widget stays
        // visually put for the whole async gap - only a single motion, not
        // "snap back, then jump forward".
        const frozen: DragState = {
          ...d,
          currentX: d.pointerStartX + cellDx * step,
          currentY: d.pointerStartY + cellDy * step,
          settling: true,
        };
        onCommit(d.chamber, d.widgetId, targetX, targetY).finally(() => {
          setDrag((cur) => (cur === frozen ? null : cur));
        });
        return frozen;
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
