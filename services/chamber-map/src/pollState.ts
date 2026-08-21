import { eq } from "drizzle-orm";
import type { PollHealth } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

const SETTINGS_ID = 1;

// Internal poll-loop bookkeeping, deliberately kept out of the public
// Settings type/PUT /api/settings (see db/schema.ts's comment) even though
// it lives on the same single-row table - settings.ts's updateSettings only
// ever `.set()`s its own two columns, so the two modules can't clobber each
// other.
export function getPollState(): { lastProcessedAt: Date | null; lastPollSucceededAt: Date | null; lastPollError: string | null } {
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  return {
    lastProcessedAt: row?.lastProcessedAt ?? null,
    lastPollSucceededAt: row?.lastPollSucceededAt ?? null,
    lastPollError: row?.lastPollError ?? null,
  };
}

export function toPollHealth(state: ReturnType<typeof getPollState>): PollHealth {
  return {
    lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
    lastPollSucceededAt: state.lastPollSucceededAt?.toISOString() ?? null,
    lastPollError: state.lastPollError,
  };
}

export function updatePollState(input: Partial<{ lastProcessedAt: Date; lastPollSucceededAt: Date; lastPollError: string | null }>): void {
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (existing) {
    db.update(settings).set(input).where(eq(settings.id, SETTINGS_ID)).run();
  } else {
    db.insert(settings)
      .values({ id: SETTINGS_ID, ...input })
      .run();
  }
}
