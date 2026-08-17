import { useEffect, useState } from "react";
import { GRID, CELL_RATIO } from "./grid";
import type { CanvasScope } from "../../../../src/types";

const GAP_PX = 8;
// Only meant to stop a degenerate (zero/negative) size on a pathological
// container - not a "comfortable" minimum.
const MIN_SANE_CELL_PX = 24;

export interface CellSize {
  width: number;
  height: number;
}

// Takes the container *element* itself (from a callback ref via useState in
// the caller, not a useRef object) - the container is conditionally
// rendered (only once loading/error/empty states have resolved), so a
// plain useRef's "current" would still be null the one time this hook's
// effect ran on mount if that happened before data loaded, and - since a
// ref object's own identity never changes across renders - the effect would
// never fire again once the container actually appeared, leaving cell size
// stuck at its initial default forever. Using the element itself (which
// changes identity from null -> the real node once it mounts) as the effect
// dependency makes re-observation happen exactly when it should.
export function useCanvasGrid(containerEl: HTMLElement | null, scope: CanvasScope): CellSize {
  const [size, setSize] = useState<CellSize>(() => {
    const height = MIN_SANE_CELL_PX;
    return { width: Math.floor(height * CELL_RATIO[scope]), height };
  });

  useEffect(() => {
    if (!containerEl) return;

    const dims = GRID[scope];
    const ratio = CELL_RATIO[scope];
    function measure(containerWidth: number, containerHeight: number) {
      // Solve for the largest uniform scale (expressed as cellHeight, with
      // cellWidth = cellHeight * ratio) such that the whole grid - at that
      // scale, including the fixed inter-cell gaps - still fits both axes
      // of the container; whichever axis is more constraining wins.
      const heightFromWidth = (containerWidth - (dims.cols - 1) * GAP_PX) / (dims.cols * ratio);
      const heightFromHeight = (containerHeight - (dims.rows - 1) * GAP_PX) / dims.rows;
      const height = Math.max(MIN_SANE_CELL_PX, Math.floor(Math.min(heightFromWidth, heightFromHeight)));
      setSize({ width: Math.floor(height * ratio), height });
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

  return size;
}

export { GAP_PX };
