import { asc, gt, lt } from "drizzle-orm";
import type { EventPublishRequest, EventLogEntry, EventLogResponse } from "@congress/shared-types";
import { db } from "./db/client.js";
import { events } from "./db/schema.js";
import { getChamber } from "./registry.js";
import { getSettings } from "./settings.js";

// Capped per poll batch, same idiom as notifications.ts's LIST_LIMIT - a
// poller that fell behind (was offline a while) catches up over several
// polls rather than one unbounded query.
const BATCH_LIMIT = 200;

function toEntry(row: typeof events.$inferSelect): EventLogEntry {
  return {
    id: row.id,
    chamber: row.chamber,
    type: row.type,
    payload: JSON.parse(row.payloadJson),
    occurredAt: row.occurredAt.toISOString(),
  };
}

export async function publishEvent(req: EventPublishRequest): Promise<void> {
  const occurredAt = req.occurredAt ? new Date(req.occurredAt) : new Date();
  // Copies a number the publishing chamber already declared about its own
  // event type, same as label/description - not an interpretation of
  // `type`/`payload` content, just mechanical bookkeeping about how long to
  // keep the row. Falls back to the owner-tunable Settings default (see
  // settings.ts's eventRetentionMs) when the chamber never declared this
  // event type at all (nothing stops a Chamber from publishing an
  // undeclared type - the catalog is descriptive, not enforced) or isn't
  // currently registered.
  const declared = getChamber(req.chamber)?.events.find((e) => e.type === req.type)?.retentionMs;
  const retentionMs = declared ?? (await getSettings()).eventRetentionMs;

  db.insert(events)
    .values({
      chamber: req.chamber,
      type: req.type,
      payloadJson: JSON.stringify(req.payload),
      occurredAt,
      expiresAt: new Date(occurredAt.getTime() + retentionMs),
    })
    .run();
}

export function listEventsSince(since: number): EventLogResponse {
  const rows = db.select().from(events).where(gt(events.id, since)).orderBy(asc(events.id)).limit(BATCH_LIMIT).all();
  // Echo the caller's own cursor back when nothing's new, rather than 0 -
  // a poller advances its stored cursor to whatever this returns
  // unconditionally, so an empty batch must not rewind it.
  const cursor = rows.length > 0 ? rows[rows.length - 1]!.id : since;
  return { events: rows.map(toEntry), cursor };
}

export function pruneOldEvents(): number {
  return db.delete(events).where(lt(events.expiresAt, new Date())).run().changes;
}
