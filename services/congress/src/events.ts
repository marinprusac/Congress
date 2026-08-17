import { asc, gt, lt } from "drizzle-orm";
import type { EventPublishRequest, EventLogEntry, EventLogResponse } from "@congress/shared-types";
import { db } from "./db/client.js";
import { events } from "./db/schema.js";

// Capped per poll batch, same idiom as notifications.ts's LIST_LIMIT - a
// poller that fell behind (was offline a while) catches up over several
// polls rather than one unbounded query.
const BATCH_LIMIT = 200;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function toEntry(row: typeof events.$inferSelect): EventLogEntry {
  return {
    id: row.id,
    chamber: row.chamber,
    type: row.type,
    payload: JSON.parse(row.payloadJson),
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function publishEvent(req: EventPublishRequest): void {
  db.insert(events)
    .values({
      chamber: req.chamber,
      type: req.type,
      payloadJson: JSON.stringify(req.payload),
      occurredAt: req.occurredAt ? new Date(req.occurredAt) : new Date(),
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
  const cutoff = new Date(Date.now() - RETENTION_MS);
  return db.delete(events).where(lt(events.occurredAt, cutoff)).run().changes;
}
