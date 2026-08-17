import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRegistry, showToast } from "@congress/congress-ui";
import type { ChamberRegistryEntry, ManifestWidget } from "@congress/shared-types";
import type { WidgetPlacement } from "../../../src/types";
import { fetchLayout, upsertPlacement, deletePlacement } from "@/lib/api";
import { GRID, occupiedCells, findFirstFit, type PlacedRect } from "./canvas/grid";
import { useCanvasScope } from "./canvas/useCanvasScope";
import { useCanvasGrid, GAP_PX } from "./canvas/useCanvasGrid";
import { useWidgetDrag } from "./canvas/useWidgetDrag";
import { WidgetCell } from "./canvas/WidgetCell";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const cellPx = useCanvasGrid(containerRef, scope);
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

  const placed = useMemo(
    () => catalog.filter((entry) => placementByKey.has(widgetKey(entry.chamber.name, entry.widget.id))),
    [catalog, placementByKey]
  );
  const unplaced: UnplacedWidget[] = useMemo(
    () => catalog.filter((entry) => !placementByKey.has(widgetKey(entry.chamber.name, entry.widget.id))),
    [catalog, placementByKey]
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
    onSuccess: (result) => {
      if (result) queryClient.invalidateQueries({ queryKey: ["capitol", "layout", scope] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ chamber, widgetId }: { chamber: string; widgetId: string }) => deletePlacement(scope, chamber, widgetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["capitol", "layout", scope] }),
  });

  // Auto-places any registered widget with no stored position for this
  // scope, into the first free cell region - and persists it immediately so
  // it's stable on reload, not just an ephemeral client-side default. Guards
  // against re-attempting a widget already in flight (React Query's own
  // refetch-on-invalidate would otherwise re-run this every render while a
  // mutation is pending). Widgets that don't fit anywhere stay unplaced and
  // surface in the tray for manual placement once room is freed up.
  const pendingAutoPlace = useRef(new Set<string>());
  useEffect(() => {
    if (registryQuery.isLoading || layoutQuery.isLoading) return;
    // Accumulated across this pass (not just read once from `placed`) so
    // multiple never-placed widgets discovered in the same effect run claim
    // different cells instead of all computing the same first-fit spot
    // against the same stale occupancy snapshot.
    const claimed = occupiedCells(placedRects());
    for (const entry of catalog) {
      const key = widgetKey(entry.chamber.name, entry.widget.id);
      if (placementByKey.has(key) || pendingAutoPlace.current.has(key)) continue;
      const spot = findFirstFit(entry.widget.width, entry.widget.height, dims, claimed);
      if (!spot) continue;
      for (let dy = 0; dy < entry.widget.height; dy++) {
        for (let dx = 0; dx < entry.widget.width; dx++) claimed.add(`${spot.x + dx},${spot.y + dy}`);
      }
      pendingAutoPlace.current.add(key);
      upsertMutation.mutate(
        { chamber: entry.chamber.name, widgetId: entry.widget.id, x: spot.x, y: spot.y },
        { onSettled: () => pendingAutoPlace.current.delete(key) }
      );
    }
    // Deliberately keyed off the raw query results (only change on an
    // actual refetch), not the derived `catalog`/`placementByKey` (new
    // object/array identity every render) - otherwise this would re-run and
    // re-scan on every render instead of only when the underlying data
    // actually changes.
  }, [registryQuery.data, layoutQuery.data, scope]);

  function attemptPlace(chamber: string, widgetId: string, width: number, height: number) {
    const spot = findFirstFit(width, height, dims, occupiedCells(placedRects()));
    if (!spot) {
      showToast("No room on the canvas for this widget", "error");
      return;
    }
    upsertMutation.mutate({ chamber, widgetId, x: spot.x, y: spot.y });
  }

  const { drag, startDrag } = useWidgetDrag({
    cellPx,
    gapPx: GAP_PX,
    dims,
    occupiedExcluding: (chamber, widgetId) => occupiedCells(placedRects(widgetKey(chamber, widgetId))),
    onCommit: (chamber, widgetId, x, y) => upsertMutation.mutate({ chamber, widgetId, x, y }),
  });

  const isLoading = registryQuery.isLoading || layoutQuery.isLoading;
  const isError = registryQuery.isError || layoutQuery.isError;

  return (
    <section className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <h2 className="font-display text-lg text-ink">Chambers</h2>
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
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
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
                  onRemove={() => deleteMutation.mutate({ chamber: entry.chamber.name, widgetId: entry.widget.id })}
                  onDragHandlePointerDown={(e) =>
                    startDrag(e, entry.chamber.name, entry.widget.id, entry.widget.width, entry.widget.height, placement.x, placement.y)
                  }
                  dragOffset={isDragging ? { dx: drag.currentX - drag.pointerStartX, dy: drag.currentY - drag.pointerStartY } : null}
                />
              );
            })}
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
