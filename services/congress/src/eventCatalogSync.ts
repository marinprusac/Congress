import { eq } from "drizzle-orm";
import { CONGRESS_SYNTHETIC_EVENTS } from "@congress/shared-types";
import { db } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { typeEventCatalog } from "./typeEngine/source.js";
import { getLocalSource } from "./recordSources.js";
import { listConnectors } from "./connectors/runtime.js";

// Keeps Congress's known event-type catalog current with its own live
// registry, so every declared event type automatically gets a settings row -
// no user-facing create/delete, see eventSettings.ts. Inserts rows for
// newly-seen types (notify off), refreshes the cached display fields on
// existing ones without touching the owner's own configuration, and deletes
// rows for types no longer declared.
export function syncEventCatalog(): void {
  const knownTypes = new Set(db.select({ eventType: eventSettings.eventType }).from(eventSettings).all().map((row) => row.eventType));
  const now = new Date();

  // Congress itself never registers (it's the registry owner, not a
  // registrant - CLAUDE.md), so its own chamber-health events would
  // otherwise never get an auto-derived settings row here. This is the one
  // hand-written entry alongside the live registry loop below.
  const syntheticChambers = [{ name: "congress", events: CONGRESS_SYNTHETIC_EVENTS }];

  const typeCatalog = getLocalSource("e") ? typeEventCatalog() : [];
  const connectorCatalog = listConnectors().flatMap((c) => (c.events?.length ? [{ name: c.name, events: c.events }] : []));
  const catalog = [...syntheticChambers, ...typeCatalog, ...connectorCatalog];
  for (const chamber of catalog) {
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
          notify: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      knownTypes.add(event.type);
    }
  }

  // An event type nothing declares any more (a removed type, a retired
  // connector) can never fire, so it doesn't get to clutter the list.
  const declared = new Set(catalog.flatMap((c) => c.events.map((e) => e.type)));
  for (const eventType of knownTypes) {
    if (!declared.has(eventType)) db.delete(eventSettings).where(eq(eventSettings.eventType, eventType)).run();
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
