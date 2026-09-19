import { eq } from "drizzle-orm";
import { CONGRESS_SYNTHETIC_EVENTS } from "@congress/shared-types";
import { db } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { listChambers } from "./registry.js";

// Keeps Congress's known event-type catalog current with its own live
// Chamber registry, so every event type any registered Chamber declares in
// its own manifest (manifest.events, shared-types) automatically gets a
// settings row - no user-facing create/delete, see eventSettings.ts. Only
// ever inserts rows for newly-seen event types (with the "record by
// default, don't notify" starting point) and refreshes the cached display
// fields (chamber/label/description) on existing ones; never touches the
// owner's own configured toggles/thresholds, and never deletes a row for an
// event type that's temporarily missing (e.g. that Chamber is offline).
export function syncEventCatalog(): void {
  const registry = listChambers();

  const knownTypes = new Set(db.select({ eventType: eventSettings.eventType }).from(eventSettings).all().map((row) => row.eventType));
  const now = new Date();

  // Congress itself never registers (it's the registry owner, not a
  // registrant - CLAUDE.md), so its own chamber-health events would
  // otherwise never get an auto-derived settings row here. This is the one
  // hand-written entry alongside the live registry loop below.
  const syntheticChambers = [{ name: "congress", events: CONGRESS_SYNTHETIC_EVENTS }];

  for (const chamber of [...registry, ...syntheticChambers]) {
    for (const event of chamber.events) {
      const payloadFieldsJson = event.payloadFields ? JSON.stringify(event.payloadFields) : null;
      if (knownTypes.has(event.type)) {
        db.update(eventSettings)
          .set({ chamber: chamber.name, label: event.label, description: event.description ?? null, payloadFieldsJson })
          .where(eq(eventSettings.eventType, event.type))
          .run();
        continue;
      }
      db.insert(eventSettings)
        .values({
          eventType: event.type,
          chamber: chamber.name,
          label: event.label,
          description: event.description ?? null,
          payloadFieldsJson,
          recordToHistory: true,
          notify: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      knownTypes.add(event.type);
    }
  }

}

const EVENT_CATALOG_SYNC_INTERVAL_MS = 5 * 60 * 1000;

let syncInterval: ReturnType<typeof setInterval> | undefined;

export function startEventCatalogSync(): void {
  syncEventCatalog();
  syncInterval = setInterval(() => {
    syncEventCatalog();
  }, EVENT_CATALOG_SYNC_INTERVAL_MS);
}

export function stopEventCatalogSync(): void {
  if (syncInterval) clearInterval(syncInterval);
}
