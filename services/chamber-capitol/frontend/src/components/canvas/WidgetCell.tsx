import { Component, Suspense, memo, useCallback, type ReactNode } from "react";
import { ChamberMark } from "@congress/congress-ui";
import { getWidgetComponent, evictWidgetComponent } from "./widgetComponent";
import type { ManifestWidget, ChamberRegistryEntry } from "@congress/shared-types";

interface WidgetErrorBoundaryProps {
  chamber: string;
  widgetId: string;
  children: ReactNode;
}
interface WidgetErrorBoundaryState {
  failed: boolean;
}

// One boundary per placed widget cell (not per Chamber, unlike Congress's
// own ChamberHost) - a render failure in one widget must not blank the rest
// of the canvas. Mirrors ChamberHost's ChamberErrorBoundary in spirit.
class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  state: WidgetErrorBoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    evictWidgetComponent(this.props.chamber, this.props.widgetId);
  }

  render() {
    if (this.state.failed) {
      return <p className="p-2 font-mono text-[10px] text-alert">Widget failed to load.</p>;
    }
    return this.props.children;
  }
}

function WidgetCellLoading() {
  return <div className="h-full w-full animate-pulse bg-ink/[0.04]" aria-hidden="true" />;
}

// The brief's explicit requirement (docs/congress-project-brief.md): an
// offline Chamber's widget slot stays visibly present, never silently
// omitted. Same diagonal-hatch treatment the old per-chamber WidgetGrid
// used, now applied per widget cell instead of per chamber card.
function OfflineHatch({ label }: { label: string }) {
  return (
    <>
      <span className="sr-only">{label} is unavailable</span>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent, transparent 7px, color-mix(in srgb, var(--color-ink) 12%, transparent) 7px, color-mix(in srgb, var(--color-ink) 12%, transparent) 8px)",
        }}
      />
    </>
  );
}

export interface WidgetCellProps {
  chamber: ChamberRegistryEntry;
  widget: ManifestWidget;
  x: number;
  y: number;
  editing: boolean;
  // True only for the single cell actively being dragged or settling after
  // a drop - the live pixel offset itself is written straight to this
  // cell's own DOM node by useWidgetDrag (see `cellRef` below), never
  // passed through a prop, so a drag gesture's own per-frame pointermoves
  // never change this component's props at all.
  isDragging: boolean;
  // Registers this cell's root node with useWidgetDrag so it can write
  // `transform` directly during a drag - stable per (chamber, widget) pair
  // (see useWidgetDrag's registerCellElement), so attaching it doesn't
  // itself cause a detach/reattach on every unrelated render.
  cellRef: (el: HTMLDivElement | null) => void;
  onRemove: (args: { chamber: string; widgetId: string }) => void;
  onDragStart: (
    e: React.PointerEvent,
    chamber: string,
    widgetId: string,
    width: number,
    height: number,
    x: number,
    y: number
  ) => void;
}

// memo()'d, with every prop above either a primitive or stable across a
// drag-only Canvas re-render (see useWidgetDrag and Canvas.tsx) - a canvas
// re-render for any reason now only actually re-renders the one cell whose
// props genuinely changed, rather than reconciling all nine placed widgets'
// own mounted subtrees (each hosting a live component from another Chamber)
// on every pointermove of an unrelated drag.
function WidgetCellImpl({ chamber, widget, x, y, editing, isDragging, cellRef, onRemove, onDragStart }: WidgetCellProps) {
  const active = chamber.status === "active";
  const Widget = active ? getWidgetComponent(chamber.name, widget.id) : null;

  const handleRemove = useCallback(
    () => onRemove({ chamber: chamber.name, widgetId: widget.id }),
    [onRemove, chamber.name, widget.id]
  );
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => onDragStart(e, chamber.name, widget.id, widget.width, widget.height, x, y),
    [onDragStart, chamber.name, widget.id, widget.width, widget.height, x, y]
  );

  return (
    <div
      ref={cellRef}
      className="relative overflow-hidden border border-dust bg-parchment"
      style={{
        gridColumn: `${x + 1} / span ${widget.width}`,
        gridRow: `${y + 1} / span ${widget.height}`,
        ...(isDragging && { zIndex: 20, opacity: 0.85 }),
      }}
    >
      {active && Widget ? (
        <WidgetErrorBoundary chamber={chamber.name} widgetId={widget.id}>
          <Suspense fallback={<WidgetCellLoading />}>
            <Widget />
          </Suspense>
        </WidgetErrorBoundary>
      ) : (
        <OfflineHatch label={`${chamber.displayName} — ${widget.label}`} />
      )}

      {editing && (
        <div
          onPointerDown={handlePointerDown}
          className="absolute inset-x-0 top-0 z-10 flex touch-none select-none items-center justify-between gap-1 bg-parchment/95 px-1.5 py-1"
        >
          <span className="flex min-w-0 items-center gap-1">
            <ChamberMark name={chamber.name} className="h-3.5 w-3.5 shrink-0 text-ink" />
            <span className="truncate font-mono text-[9px] uppercase tracking-wide text-ink">{widget.label}</span>
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleRemove}
            className="shrink-0 font-mono text-xs leading-none text-dust hover:text-alert"
            aria-label={`Remove ${widget.label} from canvas`}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export const WidgetCell = memo(WidgetCellImpl);
