import { and, eq, inArray } from "drizzle-orm";
import { recordsDb } from "./db/client.js";
import { legacyAliases } from "./db/schema.js";

// Old Chamber record ids keep working after an import: resolve and sync
// consult these instead of other Chambers' text ever being rewritten.

export function resolveLegacyAlias(chamber: string, id: string): string | null {
  const row = recordsDb
    .select()
    .from(legacyAliases)
    .where(and(eq(legacyAliases.legacyChamber, chamber), eq(legacyAliases.legacyId, id)))
    .get();
  return row?.recordId ?? null;
}

// Legacy record ids (any chamber) -> record id, for ids that have one.
export function aliasesForIds(ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  return new Map(
    recordsDb
      .select()
      .from(legacyAliases)
      .where(inArray(legacyAliases.legacyId, ids))
      .all()
      .map((r) => [r.legacyId, r.recordId])
  );
}

export function legacyIdsFor(recordId: string): string[] {
  return recordsDb
    .select({ id: legacyAliases.legacyId })
    .from(legacyAliases)
    .where(eq(legacyAliases.recordId, recordId))
    .all()
    .map((r) => r.id);
}

export function addLegacyAlias(chamber: string, legacyId: string, recordId: string): void {
  recordsDb.insert(legacyAliases).values({ legacyChamber: chamber, legacyId, recordId }).onConflictDoNothing().run();
}
