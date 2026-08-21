import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRegistry, showToast } from "@congress/congress-ui";
import type { ChamberRegistryEntry, ManifestWidget } from "@congress/shared-types";
import type { WidgetPlacement } from "../../../src/types";
import { fetchLayout, upsertPlacement, deletePlacement } from "@/lib/api";
import { GRID, occupiedCells, findFirstFit, fits, type PlacedRect } from "./canvas/grid";
import { useCanvasScope } from "./canvas/useCanvasScope";
import { useCanvasGrid, GAP_PX } from "./canvas/useCanvasGrid";
import { useWidgetDrag } from "./canvas/useWidgetDrag";
import { WidgetCell } from "./canvas/WidgetCell";
import { GridDots } from "./canvas/GridDots";
import { AddWidgetTray, type UnplacedWidget } from "./canvas/AddWidgetTray";

interface CatalogEntry {
  chamber: ChamberRegistryEntry;
  widget: ManifestWidget;
}

function widgetKey(chamber: string, widgetId: string): string {
  return `${chamber}:${widgetId}`;
}

export function Canvas({ editing, onToggleEditing }: { editing: boolean; onToggleEditing: () => void }) {
  const queryClient = useQueryClient();
  const scope = useCanvasScope();
  // Callback ref (via useState), not useRef - the container div is only
  // conditionally rendered (see below, once loading/error/empty states
  // resolve), so useCanvasGrid needs to know the *moment* the real node
  // attaches, not just once on initial mount when it may still be null.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const cellPx = useCanvasGrid(containerEl, scope);
  const dims = GRID[scope];

  const registryQuery = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const layoutQuery = useQuery({
    queryKey: ["capitol", "layout", scope],
    queryFn: () => fetchLayout(scope),
  });

  const catalog: CatalogEntry[] = useMemo(
    () => (registryQuery.data ?? []).flatMap((chamber) => chamber.widgets.map((widget) => ({ chamber, widget }))),
    [registryQuery.data]
  );

  const placementByKey = useMemo(() => {
    const map = new Map<string, WidgetPlacement>();
    for (const placement of layoutQuery.data ?? []) map.set(widgetKey(placement.chamber, placement.widgetId), placement);
    return map;
  }, [layoutQuery.data]);

  // A stored placement only counts as "placed" if it still fits the
  // *current* grid dims - GRID's cols/rows are code constants that can
  // change between deploys (they did: desktop went from 8 cols to 4), and a
  // row left over from a wider/taller grid would otherwise render into a
  // CSS Grid *implicit* track (auto-sized to content, not the fixed cellPx
  // size) instead of the explicit grid, producing wildly-wrong-sized cards.
  // Treated as unplaced instead - it shows back up in the tray, and
  // re-placing it (tray tap or drag) overwrites the stale row with a
  // same-primary-key upsert, so this self-heals with no migration needed.
  function isWithinBounds(placement: WidgetPlacement, widget: ManifestWidget): boolean {
    return fits({ x: placement.x, y: placement.y, width: widget.width, height: widget.height }, dims, new Set());
  }

  const placed = useMemo(
    () =>
      catalog.filter((entry) => {
        const placement = placementByKey.get(widgetKey(entry.chamber.name, entry.widget.id));
        return placement !== undefined && isWithinBounds(placement, entry.widget);
      }),
    [catalog, placementByKey, dims]
  );
  const unplaced: UnplacedWidget[] = useMemo(
    () =>
      catalog.filter((entry) => {
        const placement = placementByKey.get(widgetKey(entry.chamber.name, entry.widget.id));
        return placement === undefined || !isWithinBounds(placement, entry.widget);
      }),
    [catalog, placementByKey, dims]
  );

  function placedRects(excluding?: string): PlacedRect[] {
    return placed
      .filter((entry) => widgetKey(entry.chamber.name, entry.widget.id) !== excluding)
      .map((entry) => {
        const placement = placementByKey.get(widgetKey(entry.chamber.name, entry.widget.id))!;
        return { x: placement.x, y: placement.y, width: entry.widget.width, height: entry.widget.height };
      });
  }

  const upsertMutation = useMutation({
    mutationFn: ({ chamber, widgetId, x, y }: { chamber: string; widgetId: string; x: number; y: number }) =>
      upsertPlacement(scope, chamber, widgetId, x, y),
    // Returns (doesn't just fire) invalidateQueries's promise - mutateAsync
    // callers (specifically useWidgetDrag's post-drop "settling" state)
    // need to know once the refetched layout actually reflects the new
    // placement, not just once the write itself succeeded. Otherwise
    // there's a shorter version of the same double-jump drag was fixed for:
    // the drag transform would clear the instant the upsert responds, but
    // the refetch (a second network round-trip) hasn't landed yet, so the
    // widget's *base* grid position would still reflect the old placement
    // for a beat.
    onSuccess: (result) => {
      if (result) return queryClient.invalidateQueries({ queryKey: ["capitol", "layout", scope] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ chamber, widgetId }: { chamber: string; widgetId: string }) => deletePlacement(scope, chamber, widgetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["capitol", "layout", scope] }),
  });

  // Widgets are never auto-placed - a newly-registered widget just sits in
  // the tray until the owner explicitly places it (tray tap or drag), same
  // as one they've removed. "Placed" is purely a manual, persisted choice.
  function attemptPlace(chamber: string, widgetId: string, width: number, height: number) {
    const spot = findFirstFit(width, height, dims, occupiedCells(placedRects()));
    if (!spot) {
      showToast("No room on the canvas for this widget", "error");
      return;
    }
    upsertMutation.mutate({ chamber, widgetId, x: spot.x, y: spot.y });
  }

  const { drag, startDrag, registerCellElement } = useWidgetDrag({
    cellPx,
    gapPx: GAP_PX,
    dims,
    occupiedExcluding: (chamber, widgetId) => occupiedCells(placedRects(widgetKey(chamber, widgetId))),
    // mutateAsync (not mutate) - the drag hook holds its own "settling"
    // visual state frozen at the target cell until this promise resolves,
    // so it needs something to actually await.
    onCommit: (chamber, widgetId, x, y) => upsertMutation.mutateAsync({ chamber, widgetId, x, y }),
  });

  const isLoading = registryQuery.isLoading || layoutQuery.isLoading;
  const isError = registryQuery.isError || layoutQuery.isError;

  return (
    <section className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end px-3 py-2">
        <button
          type="button"
          onClick={onToggleEditing}
          className="border border-dust px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-accent hover:text-accent"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {isLoading && <p className="px-3 font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="px-3 font-mono text-sm text-alert">Failed to reach Congress's registry.</p>}
      {!isLoading && !isError && catalog.length === 0 && (
        <p className="px-3 font-mono text-sm text-dust">— No Chambers registered —</p>
      )}

      {!isLoading && !isError && catalog.length > 0 && (
        <div
          ref={setContainerEl}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"
        >
          <div className="relative">
            {editing && <GridDots dims={dims} cellPx={cellPx} gapPx={GAP_PX} />}
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${dims.cols}, ${cellPx}px)`,
                gridTemplateRows: `repeat(${dims.rows}, ${cellPx}px)`,
                gap: `${GAP_PX}px`,
              }}
            >
              {placed.map((entry) => {
                const placement = placementByKey.get(widgetKey(entry.chamber.name, entry.widget.id))!;
                const key = widgetKey(entry.chamber.name, entry.widget.id);
                const isDragging = drag?.chamber === entry.chamber.name && drag?.widgetId === entry.widget.id;
                return (
                  <WidgetCell
                    key={key}
                    chamber={entry.chamber}
                    widget={entry.widget}
                    x={placement.x}
                    y={placement.y}
                    editing={editing}
                    isDragging={isDragging}
                    cellRef={registerCellElement(key)}
                    onRemove={deleteMutation.mutate}
                    onDragStart={startDrag}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <AddWidgetTray
          unplaced={unplaced}
          onPlace={(chamber, widgetId) => {
            const entry = unplaced.find((u) => u.chamber.name === chamber && u.widget.id === widgetId);
            if (entry) attemptPlace(chamber, widgetId, entry.widget.width, entry.widget.height);
          }}
        />
      )}
    </section>
  );
}
