import { asc } from "drizzle-orm";
import type { EventDelivery, EventLogEntry } from "@congress/shared-types";
import { db } from "./db/client.js";
import { pendingCheckupEvents } from "./db/schema.js";

// Buffers a received event toward whichever scheduled directive next runs -
// see db/schema.ts's own comment on pendingCheckupEvents for why this
// Chamber persists its own copy instead of re-reading Congress's own (now
// nonexistent) log.
export function bufferEvent(event: EventDelivery): void {
  db.insert(pendingCheckupEvents)
    .values({
      chamber: event.chamber,
      type: event.type,
      payloadJson: JSON.stringify(event.payload),
      occurredAt: new Date(event.occurredAt),
    })
    .run();
}

// Reads and clears everything buffered since the last drain, in one step -
// reading without draining would double-count the same events on the next
// directive that runs.
export function drainPendingCheckupEvents(): EventLogEntry[] {
  const rows = db.select().from(pendingCheckupEvents).orderBy(asc(pendingCheckupEvents.id)).all();
  if (rows.length > 0) db.delete(pendingCheckupEvents).run();
  return rows.map((row) => ({
    id: row.id,
    chamber: row.chamber,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
  }));
}
