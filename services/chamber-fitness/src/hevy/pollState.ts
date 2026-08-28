import { eq } from "drizzle-orm";
import type { HevySyncHealth } from "../types.js";
import { db } from "../db/client.js";
import { settings } from "../db/schema.js";

const SETTINGS_ID = 1;

// Internal poll-loop bookkeeping, deliberately kept out of the public
// Settings type/PUT /api/settings (see db/schema.ts's comment) even though
// it lives on the same single-row table - mirrors chamber-map's
// pollState.ts.
export function getSyncState(): { lastSyncedAt: Date | null; consecutiveFailures: number; lastError: string | null } {
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  return {
    lastSyncedAt: row?.hevyLastSyncedAt ?? null,
    consecutiveFailures: row?.hevyConsecutiveFailures ?? 0,
    lastError: row?.hevyLastPollError ?? null,
  };
}

export function toSyncHealth(state: ReturnType<typeof getSyncState>): HevySyncHealth {
  return {
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError,
  };
}

export function updateSyncState(input: { lastSyncedAt?: Date; consecutiveFailures?: number; lastError?: string | null }): void {
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  const columns: Partial<typeof settings.$inferInsert> = {};
  if (input.lastSyncedAt !== undefined) columns.hevyLastSyncedAt = input.lastSyncedAt;
  if (input.consecutiveFailures !== undefined) columns.hevyConsecutiveFailures = input.consecutiveFailures;
  if (input.lastError !== undefined) columns.hevyLastPollError = input.lastError;

  if (existing) {
    db.update(settings).set(columns).where(eq(settings.id, SETTINGS_ID)).run();
  } else {
    db.insert(settings)
      .values({ id: SETTINGS_ID, ...columns })
      .run();
  }
}
