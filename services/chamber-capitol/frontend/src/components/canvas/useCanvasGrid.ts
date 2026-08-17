import { useEffect, useState } from "react";
import { GRID } from "./grid";
import type { CanvasScope } from "../../../../src/types";

const GAP_PX = 8;
// Only meant to stop a degenerate (zero/negative) size on a pathological
// container - not a "comfortable" minimum, and there's no upper cap either:
// cells are exactly (available space / dims.cols|rows) on whichever axis is
// more constraining, uniformly scaled (square cells, never stretched) - the
// grid always exactly fills the container on at least one axis, never
// overflowing it (the container is overflow:hidden - the whole point of
// "finite, unscrollable, whatever fits the screen is it"). dims.cols/rows
// (grid.ts) is the one place cell *count* - and the grid's overall
// width:height ratio - is chosen; this hook only ever divides whatever
// space actually exists by that fixed count, equally on both axes.
const MIN_SANE_CELL_PX = 24;

// Takes the container *element* itself (from a callback ref via useState in
// the caller, not a useRef object) - the container is conditionally
// rendered (only once loading/error/empty states have resolved), so a
// plain useRef's "current" would still be null the one time this hook's
// effect ran on mount if that happened before data loaded, and - since a
// ref object's own identity never changes across renders - the effect would
// never fire again once the container actually appeared, leaving cellPx
// stuck at its initial default forever. Using the element itself (which
// changes identity from null -> the real node once it mounts) as the effect
// dependency makes re-observation happen exactly when it should.
export function useCanvasGrid(containerEl: HTMLElement | null, scope: CanvasScope): number {
  const [cellPx, setCellPx] = useState(MIN_SANE_CELL_PX);

  useEffect(() => {
    if (!containerEl) return;

    const dims = GRID[scope];
    function measure(width: number, height: number) {
      const byWidth = (width + GAP_PX) / dims.cols - GAP_PX;
      const byHeight = (height + GAP_PX) / dims.rows - GAP_PX;
      const next = Math.floor(Math.min(byWidth, byHeight));
      setCellPx(Math.max(MIN_SANE_CELL_PX, next));
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      measure(width, height);
    });
    observer.observe(containerEl);
    measure(containerEl.clientWidth, containerEl.clientHeight);
    return () => observer.disconnect();
  }, [containerEl, scope]);

  return cellPx;
}

export { GAP_PX };
