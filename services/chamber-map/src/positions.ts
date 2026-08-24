import { db } from "./db/client.js";
import { positions } from "./db/schema.js";
import type { TraccarPosition } from "./traccar/client.js";

// Appends one fix to the permanent GPS log - see db/schema.ts's comment on
// `positions`. Called unconditionally, once per fix, before any of
// tracking.ts's visit/trip classification runs, so nothing Traccar reports
// is ever silently dropped regardless of what that classification decides.
export function recordPosition(fix: TraccarPosition): void {
  db.insert(positions)
    .values({
      traccarPositionId: fix.id,
      latitude: fix.latitude,
      longitude: fix.longitude,
      speedKnots: fix.speed,
      fixTime: new Date(fix.fixTime),
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
}
