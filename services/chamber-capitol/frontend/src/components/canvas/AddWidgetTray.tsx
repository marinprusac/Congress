import { ChamberMark } from "@congress/congress-ui";
import type { ManifestWidget, ChamberRegistryEntry } from "@congress/shared-types";

export interface UnplacedWidget {
  chamber: ChamberRegistryEntry;
  widget: ManifestWidget;
}

export interface AddWidgetTrayProps {
  unplaced: UnplacedWidget[];
  onPlace: (chamber: string, widgetId: string) => void;
}

// Edit-mode-only list of every registered widget with no placement on this
// scope's canvas - the one way back onto the canvas for a widget that was
// removed (or a newly-registered one that never got auto-placed because no
// room was free at the time).
export function AddWidgetTray({ unplaced, onPlace }: AddWidgetTrayProps) {
  if (unplaced.length === 0) return null;

  return (
    <div className="capitol-add-widget-tray">
      <p className="border-b border-dust px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-dust">
        Add to canvas
      </p>
      <div className="flex flex-col">
        {unplaced.map(({ chamber, widget }) => (
          <button
            key={`${chamber.name}:${widget.id}`}
            type="button"
            onClick={() => onPlace(chamber.name, widget.id)}
            className="flex items-center gap-2 border-b border-dust px-3 py-2 text-left last:border-b-0 hover:bg-ink/[0.04]"
          >
            <ChamberMark name={chamber.name} className="h-4 w-4 shrink-0 text-ink" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
              {chamber.displayName} — {widget.label}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-dust">
              {widget.width}×{widget.height}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
