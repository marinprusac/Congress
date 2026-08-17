import { Component, Suspense, type ReactNode } from "react";
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
  onRemove: () => void;
  onDragHandlePointerDown: (e: React.PointerEvent) => void;
  // Live pixel offset while this cell is being dragged (see useWidgetDrag) -
  // null the rest of the time. Applied as an additional transform on this
  // same grid item rather than a separate wrapper div, since only a direct
  // child of the .grid container's gridColumn/gridRow actually positions it.
  dragOffset: { dx: number; dy: number } | null;
}

export function WidgetCell({ chamber, widget, x, y, editing, onRemove, onDragHandlePointerDown, dragOffset }: WidgetCellProps) {
  const active = chamber.status === "active";
  const Widget = active ? getWidgetComponent(chamber.name, widget.id) : null;

  return (
    <div
      className="relative overflow-hidden border border-dust bg-parchment"
      style={{
        gridColumn: `${x + 1} / span ${widget.width}`,
        gridRow: `${y + 1} / span ${widget.height}`,
        ...(dragOffset && {
          transform: `translate(${dragOffset.dx}px, ${dragOffset.dy}px)`,
          zIndex: 20,
          opacity: 0.85,
        }),
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
          onPointerDown={onDragHandlePointerDown}
          className="absolute inset-x-0 top-0 z-10 flex touch-none select-none items-center justify-between gap-1 bg-parchment/95 px-1.5 py-1"
        >
          <span className="flex min-w-0 items-center gap-1">
            <ChamberMark name={chamber.name} className="h-3.5 w-3.5 shrink-0 text-ink" />
            <span className="truncate font-mono text-[9px] uppercase tracking-wide text-ink">{widget.label}</span>
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
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
