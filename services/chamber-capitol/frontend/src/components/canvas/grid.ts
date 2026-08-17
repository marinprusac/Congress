import type { CanvasScope } from "../../../../src/types";

export interface GridDims {
  cols: number;
  rows: number;
}

// Fixed per-scope, deliberately NOT derived from any one device's measured
// viewport - layout is shared across every device in a scope (see
// CLAUDE.md/the plan: "mobile" and "desktop" are two shared layouts, not one
// per physical device), so if the cell *count* varied with each window's
// exact pixel size, two desktop windows of different widths would disagree
// about which cells even exist even though they read/write the same stored
// positions. Only each cell's pixel size (useCanvasGrid's cellPx) responds
// to the live viewport - tune these two constants visually against real
// device sizes, not by measurement.
export const GRID: Record<CanvasScope, GridDims> = {
  mobile: { cols: 2, rows: 12 },
  desktop: { cols: 4, rows: 6 },
};

export interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cellsOf(rect: PlacedRect): string[] {
  const cells: string[] = [];
  for (let dy = 0; dy < rect.height; dy++) {
    for (let dx = 0; dx < rect.width; dx++) {
      cells.push(`${rect.x + dx},${rect.y + dy}`);
    }
  }
  return cells;
}

export function occupiedCells(rects: PlacedRect[]): Set<string> {
  const occupied = new Set<string>();
  for (const rect of rects) {
    for (const cell of cellsOf(rect)) occupied.add(cell);
  }
  return occupied;
}

export function fits(rect: PlacedRect, dims: GridDims, occupied: Set<string>): boolean {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > dims.cols || rect.y + rect.height > dims.rows) return false;
  return cellsOf(rect).every((cell) => !occupied.has(cell));
}

// Greedy first-fit, scanning row-major from the top-left - simple and good
// enough for a handful of widgets on a small grid; no packing optimization.
export function findFirstFit(width: number, height: number, dims: GridDims, occupied: Set<string>): { x: number; y: number } | null {
  for (let y = 0; y <= dims.rows - height; y++) {
    for (let x = 0; x <= dims.cols - width; x++) {
      if (fits({ x, y, width, height }, dims, occupied)) return { x, y };
    }
  }
  return null;
}
