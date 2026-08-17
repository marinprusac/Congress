import { and, eq, ne } from "drizzle-orm";
import { db } from "./db/client.js";
import { widgetLayouts } from "./db/schema.js";
import type { CanvasScope, WidgetPlacement } from "./types.js";

export function listPlacements(scope: CanvasScope): WidgetPlacement[] {
  return db
    .select({ chamber: widgetLayouts.chamber, widgetId: widgetLayouts.widgetId, x: widgetLayouts.x, y: widgetLayouts.y })
    .from(widgetLayouts)
    .where(eq(widgetLayouts.scope, scope))
    .all();
}

// Upserts a single widget's cell position for a scope. Returns null (instead
// of writing) if the target origin cell is already claimed by a *different*
// widget - a real race when two tabs both auto-place an unplaced widget at
// once. This is an origin-cell check, not full footprint/rectangle overlap
// (this table deliberately doesn't store widget width/height - see
// db/schema.ts), so it catches the concurrent-auto-placement case without
// needing this Chamber to look up sizes from Congress's registry; the client
// (which already has the full widget catalog) is trusted to avoid placing
// differently-sized widgets so they overlap in the first place.
export function upsertPlacement(scope: CanvasScope, chamber: string, widgetId: string, x: number, y: number): WidgetPlacement | null {
  const conflict = db
    .select()
    .from(widgetLayouts)
    .where(
      and(
        eq(widgetLayouts.scope, scope),
        eq(widgetLayouts.x, x),
        eq(widgetLayouts.y, y),
        ne(widgetLayouts.chamber, chamber)
      )
    )
    .get();
  if (conflict) return null;
  const sameOriginOtherWidget = db
    .select()
    .from(widgetLayouts)
    .where(
      and(
        eq(widgetLayouts.scope, scope),
        eq(widgetLayouts.x, x),
        eq(widgetLayouts.y, y),
        eq(widgetLayouts.chamber, chamber),
        ne(widgetLayouts.widgetId, widgetId)
      )
    )
    .get();
  if (sameOriginOtherWidget) return null;

  const now = new Date();
  db.insert(widgetLayouts)
    .values({ scope, chamber, widgetId, x, y, updatedAt: now })
    .onConflictDoUpdate({
      target: [widgetLayouts.scope, widgetLayouts.chamber, widgetLayouts.widgetId],
      set: { x, y, updatedAt: now },
    })
    .run();

  return { chamber, widgetId, x, y };
}

export function deletePlacement(scope: CanvasScope, chamber: string, widgetId: string): void {
  db.delete(widgetLayouts)
    .where(and(eq(widgetLayouts.scope, scope), eq(widgetLayouts.chamber, chamber), eq(widgetLayouts.widgetId, widgetId)))
    .run();
}
