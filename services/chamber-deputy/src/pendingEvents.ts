import { asc } from "drizzle-orm";
import type { EventDelivery, EventLogEntry } from "@congress/shared-types";
import { db } from "./db/client.js";
import { pendingCheckupEvents } from "./db/schema.js";

// Buffers a received event toward the next periodic checkup - see
// db/schema.ts's own comment on pendingCheckupEvents for why this Chamber
// persists its own copy instead of re-reading Congress's own (now
// nonexistent) log. Returns the buffer row's own id, used only to give an
// urgent event's own immediate run (eventReceive.ts) a stable EventLogEntry
// id - never a Congress-wide id, since nothing assigns one of those any
// more.
export function bufferEvent(event: EventDelivery): number {
  const row = db
    .insert(pendingCheckupEvents)
    .values({
      chamber: event.chamber,
      type: event.type,
      payloadJson: JSON.stringify(event.payload),
      occurredAt: new Date(event.occurredAt),
    })
    .returning({ id: pendingCheckupEvents.id })
    .get();
  return row.id;
}

// Reads and clears everything buffered since the last periodic checkup, in
// one step - a checkup that reads without draining would double-count the
// same events on its next run.
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
