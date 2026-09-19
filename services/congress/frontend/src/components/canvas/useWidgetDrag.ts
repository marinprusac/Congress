import { useCallback, useEffect, useRef, useState } from "react";
import { fits, type GridDims } from "./grid";

export interface DragState {
  chamber: string;
  widgetId: string;
  // True once the pointer has been released and a valid target committed -
  // toggles the dragged cell's own z-index/opacity while the placement
  // round-trips. See onUp's comment for why this exists.
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

function cellKey(chamber: string, widgetId: string): string {
  return `${chamber}:${widgetId}`;
}

// Pointer-based (not touch-only, since edit mode is plausibly used with a
// mouse too) drag-to-move: snaps to the nearest cell under the pointer on
// release, rejecting (no commit - the widget just stays where it was) if the
// target overlaps another placed widget or falls outside the grid. No
// resize, no swap - "put and move" only, per the confirmed scope.
//
// The live offset never touches React state. `pointermove` can fire at up
// to 120Hz, and calling setState from it re-renders Canvas and, with it,
// every OTHER placed widget's own cell - a full canvas reconciliation on
// every frame of a gesture that most needs to feel direct. Instead, each
// WidgetCell registers its own DOM node here (via the `cellRef` callback
// returned below), and onMove writes `transform` straight to that node.
// React only re-renders for the three things that actually change what's
// rendered: drag start, the brief "settling" state while the commit
// round-trips, and drag end.
export function useWidgetDrag(options: UseWidgetDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const cellRefCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  // Returns the same callback-ref function for a given key across renders -
  // a fresh function identity on every render would make React detach and
  // reattach every cell's ref on every render, exactly the per-frame
  // per-widget churn this hook exists to avoid.
  const registerCellElement = useCallback((key: string) => {
    let fn = cellRefCache.current.get(key);
    if (!fn) {
      fn = (el) => {
        if (el) elementsRef.current.set(key, el);
        else elementsRef.current.delete(key);
      };
      cellRefCache.current.set(key, fn);
    }
    return fn;
  }, []);

  // Mutable per-gesture bookkeeping - refs, not state, since these update on
  // every `pointermove` and none of them should trigger a render.
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const originRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const currentRef = useRef({ x: 0, y: 0 });

  const startDrag = useCallback(
    (
      e: React.PointerEvent,
      chamber: string,
      widgetId: string,
      width: number,
      height: number,
      originX: number,
      originY: number
    ) => {
      e.preventDefault();
      // Keeps receiving pointermove/up for this gesture even if the pointer
      // strays off the (small, edge-of-cell) drag handle mid-drag - without
      // this, a fast or imprecise drag can end up not firing pointerup on
      // any listened element, though window-level listeners below still
      // catch most cases regardless; capture just makes it reliable.
      (e.target as Element).setPointerCapture(e.pointerId);
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      currentRef.current = { x: e.clientX, y: e.clientY };
      originRef.current = { x: originX, y: originY, width, height };
      setDrag({ chamber, widgetId, settling: false });
    },
    []
  );

  useEffect(() => {
    if (!drag) return;
    const { chamber, widgetId } = drag;
    const key = cellKey(chamber, widgetId);

    function onMove(e: PointerEvent) {
      currentRef.current = { x: e.clientX, y: e.clientY };
      const el = elementsRef.current.get(key);
      if (!el) return;
      const dx = currentRef.current.x - pointerStartRef.current.x;
      const dy = currentRef.current.y - pointerStartRef.current.y;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    function onUp() {
      const el = elementsRef.current.get(key);
      const { cellPx, gapPx, dims, occupiedExcluding, onCommit } = optionsRef.current;
      const step = cellPx + gapPx;
      const cellDx = Math.round((currentRef.current.x - pointerStartRef.current.x) / step);
      const cellDy = Math.round((currentRef.current.y - pointerStartRef.current.y) / step);
      const { x: originX, y: originY, width, height } = originRef.current;
      const targetX = originX + cellDx;
      const targetY = originY + cellDy;
      const occupied = occupiedExcluding(chamber, widgetId);

      if (!fits({ x: targetX, y: targetY, width, height }, dims, occupied)) {
        // Invalid target - nothing to persist, so nothing to wait for;
        // clearing the transform immediately just snaps back to the
        // (unchanged) stored position, which is correct, not a jump.
        if (el) el.style.transform = "";
        setDrag(null);
        return;
      }

      // Placing/moving a widget round-trips through the server (so a
      // freshly-placed widget is stable on reload, not just an optimistic
      // client guess) - clearing the transform right away here would drop
      // the visual offset immediately, and since the underlying stored
      // placement hasn't updated yet, the widget would render at its OLD
      // grid position for one frame, then jump again once the mutation
      // resolves and the layout query refetches. Freezing the transform at
      // exactly the target cell's offset (not the raw pointer position,
      // which may not land precisely on a cell boundary) and holding it
      // there until the commit settles means the widget stays visually put
      // for the whole async gap - only a single motion, not "snap back,
      // then jump forward".
      if (el) el.style.transform = `translate(${cellDx * step}px, ${cellDy * step}px)`;
      setDrag((d) => (d && d.chamber === chamber && d.widgetId === widgetId ? { ...d, settling: true } : d));
      onCommit(chamber, widgetId, targetX, targetY).finally(() => {
        if (el) el.style.transform = "";
        setDrag((cur) => (cur && cur.chamber === chamber && cur.widgetId === widgetId ? null : cur));
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
    // Keyed on the dragged widget's identity, not `drag` wholesale - the
    // `settling` flip happens inside this same closure via setDrag's
    // updater form, so it doesn't need to be a dependency, and re-running
    // this effect for it would tear down and rebuild the listeners
    // mid-drag for no reason.
  }, [drag?.chamber, drag?.widgetId]);

  return { drag, startDrag, registerCellElement };
}
