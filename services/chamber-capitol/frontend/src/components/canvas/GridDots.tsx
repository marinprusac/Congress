import type { GridDims } from "./grid";

export interface GridDotsProps {
  dims: GridDims;
  cellPx: number;
  gapPx: number;
}

// Edit-mode-only debugging aid: marks every grid line intersection so a
// mismatch between the assumed cell grid and what's actually visible - a
// stale out-of-bounds placement, a container shorter than dims.rows *
// cellPx, drag math landing somewhere unexpected - is visible at a glance
// instead of having to infer it from where widgets *look* like they are.
export function GridDots({ dims, cellPx, gapPx }: GridDotsProps) {
  const step = cellPx + gapPx;
  const dots: { x: number; y: number }[] = [];
  for (let row = 0; row <= dims.rows; row++) {
    for (let col = 0; col <= dims.cols; col++) {
      dots.push({ x: col * step, y: row * step });
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
      {dots.map((dot, i) => (
        <div
          key={i}
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/70"
          style={{ left: dot.x, top: dot.y }}
        />
      ))}
    </div>
  );
}
