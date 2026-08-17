import type { GridDims } from "./grid";

export interface GridDotsProps {
  dims: GridDims;
  cellWidth: number;
  cellHeight: number;
  gapPx: number;
}

// Position of grid line `n` (0-indexed, 0 = the grid's own edge) along an
// axis of cells sized `cellPx` with `gapPx` between them: line 0 is at 0;
// line n>=1 sits right where cell (n-1) ends, i.e. n*cellPx + (n-1)*gapPx
// (NOT n*(cellPx+gapPx), which overshoots by one full gap for every line
// past the first).
function linePos(n: number, cellPx: number, gapPx: number): number {
  return n === 0 ? 0 : n * cellPx + (n - 1) * gapPx;
}

// Edit-mode-only debugging aid: marks every grid line intersection so a
// mismatch between the assumed cell grid and what's actually visible is
// visible at a glance instead of having to infer it from where widgets
// *look* like they are. Deliberately painted *behind* the widget grid (no
// z-index of its own, and placed earlier in the DOM - see Canvas.tsx) so it
// doesn't obscure widget content.
export function GridDots({ dims, cellWidth, cellHeight, gapPx }: GridDotsProps) {
  const dots: { x: number; y: number }[] = [];
  for (let row = 0; row <= dims.rows; row++) {
    for (let col = 0; col <= dims.cols; col++) {
      dots.push({ x: linePos(col, cellWidth, gapPx), y: linePos(row, cellHeight, gapPx) });
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {dots.map((dot, i) => (
        <div
          key={i}
          className="absolute h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/60"
          style={{ left: dot.x, top: dot.y }}
        />
      ))}
    </div>
  );
}
