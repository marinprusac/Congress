import { useEffect, useState, type RefObject } from "react";
import { GRID } from "./grid";
import type { CanvasScope } from "../../../../src/types";

const GAP_PX = 8;
const MIN_CELL_PX = 90;
const MAX_CELL_PX = 260;

// Derives each cell's *pixel* size from the container's measured box and
// the scope's *fixed* cell count (see grid.ts's GRID for why the count
// itself is never derived from a measurement). A narrow window shows
// smaller cells, not fewer of them.
export function useCanvasGrid(containerRef: RefObject<HTMLElement | null>, scope: CanvasScope): number {
  const [cellPx, setCellPx] = useState(MIN_CELL_PX);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dims = GRID[scope];
    function measure(width: number, height: number) {
      const byWidth = (width + GAP_PX) / dims.cols - GAP_PX;
      const byHeight = (height + GAP_PX) / dims.rows - GAP_PX;
      const next = Math.floor(Math.min(byWidth, byHeight));
      setCellPx(Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, next)));
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      measure(width, height);
    });
    observer.observe(el);
    measure(el.clientWidth, el.clientHeight);
    return () => observer.disconnect();
  }, [containerRef, scope]);

  return cellPx;
}

export { GAP_PX };
