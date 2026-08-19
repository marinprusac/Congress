import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import type {
  ExhibitSyncRequest,
  CapitolExhibitSearchResult,
  CapitolExhibitResolveResult,
  ExhibitRefEntry,
} from "@congress/shared-types";
import { exhibitSearchResultSchema, exhibitResolveResultSchema } from "@congress/shared-types";
import { db } from "./db/client.js";
import { exhibitCache, exhibitRefs } from "./db/schema.js";
import { listChambers, getChamber } from "./registry.js";

const FAN_OUT_TIMEOUT_MS = 5_000;

// Only Capitol parses these - the response envelope for its own fan-out
// calls to each Chamber's /exhibits/search and /exhibits/resolve.
const exhibitSearchResponseSchema = z.object({ results: z.array(exhibitSearchResultSchema) });
const exhibitResolveResponseSchema = z.object({ results: z.array(exhibitResolveResultSchema) });

export function syncExhibit(push: ExhibitSyncRequest): void {
  const now = new Date();
  const existing = db.select().from(exhibitCache).where(eq(exhibitCache.id, push.id)).get();

  if (existing) {
    db.update(exhibitCache)
      .set({
        chamber: push.chamber,
        type: push.type,
        name: push.name,
        url: push.url,
        deleted: push.deleted ?? false,
        updatedAt: now,
      })
      .where(eq(exhibitCache.id, push.id))
      .run();
  } else {
    db.insert(exhibitCache)
      .values({
        id: push.id,
        chamber: push.chamber,
        type: push.type,
        name: push.name,
        url: push.url,
        deleted: push.deleted ?? false,
        updatedAt: now,
      })
      .run();
  }

  const manualRefs = new Set(push.manualRefs ?? []);
  db.delete(exhibitRefs).where(eq(exhibitRefs.sourceId, push.id)).run();
  for (const targetId of push.outgoingRefs) {
    db.insert(exhibitRefs)
      .values({ sourceId: push.id, sourceChamber: push.chamber, targetId, isManual: manualRefs.has(targetId) })
      .run();
  }
}

export async function searchExhibits(query: string): Promise<CapitolExhibitSearchResult[]> {
  const chambers = listChambers().filter((c) => c.status === "active");

  const perChamberResults = await Promise.all(
    chambers.map(async (chamber): Promise<CapitolExhibitSearchResult[]> => {
      try {
        const res = await fetch(`${chamber.apiBase}/exhibits/search?q=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(FAN_OUT_TIMEOUT_MS),
        });
        if (!res.ok) return [];
        const parsed = exhibitSearchResponseSchema.safeParse(await res.json());
        if (!parsed.success) return [];
        return parsed.data.results.map((r) => ({ ...r, chamber: chamber.name }));
      } catch {
        return [];
      }
    })
  );

  return perChamberResults.flat();
}

export async function resolveOneLive(id: string, chamber: string): Promise<CapitolExhibitResolveResult> {
  const entry = getChamber(chamber);
  if (!entry || entry.status !== "active") {
    return { id, chamber, unavailable: true };
  }

  try {
    const res = await fetch(`${entry.apiBase}/exhibits/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
      signal: AbortSignal.timeout(FAN_OUT_TIMEOUT_MS),
    });
    if (!res.ok) return { id, chamber, unavailable: true };

    const parsed = exhibitResolveResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { id, chamber, unavailable: true };

    const result = parsed.data.results.find((r) => r.id === id);
    if (!result) return { id, chamber, unavailable: true };

    if ("deleted" in result) {
      syncExhibit({ chamber, id, type: "", name: "", url: "", deleted: true, outgoingRefs: [] });
      return { id, chamber, deleted: true };
    }

    // A live resolve doesn't carry `type` (only /exhibits/search does), so a
    // never-before-cached id gets an empty type here - harmless, since
    // rendering only needs chamber (for the icon) + name + url.
    const existing = db.select().from(exhibitCache).where(eq(exhibitCache.id, id)).get();
    syncExhibit({
      chamber,
      id,
      type: existing?.type ?? "",
      name: result.name,
      url: result.url,
      outgoingRefs: db
        .select({ targetId: exhibitRefs.targetId })
        .from(exhibitRefs)
        .where(eq(exhibitRefs.sourceId, id))
        .all()
        .map((r) => r.targetId),
    });

    return { id, chamber, name: result.name, url: result.url };
  } catch {
    return { id, chamber, unavailable: true };
  }
}

export async function resolveExhibits(
  refs: { id: string; chamber: string }[]
): Promise<CapitolExhibitResolveResult[]> {
  return Promise.all(
    refs.map(async ({ id, chamber }): Promise<CapitolExhibitResolveResult> => {
      const cached = db.select().from(exhibitCache).where(eq(exhibitCache.id, id)).get();
      if (cached) {
        if (cached.deleted) return { id, chamber: cached.chamber, deleted: true };
        return { id, chamber: cached.chamber, name: cached.name, url: cached.url };
      }
      return resolveOneLive(id, chamber);
    })
  );
}

// Which Chamber owns an Exhibit id, per the resolution cache - used to route
// a manual-ref add/remove to the right Chamber's own "/api/exhibits/:id/refs"
// regardless of which Chamber's page the request originated from. Unlike
// resolveOneLive, this never falls back to guessing: an id with no cache row
// has nothing to route to yet (it can only get one by syncing on create, and
// a ref can only ever target something that already exists).
export function getCachedChamber(id: string): string | null {
  const cached = db.select().from(exhibitCache).where(eq(exhibitCache.id, id)).get();
  return cached?.chamber ?? null;
}

// A Connection has no direction to the caller - exhibit_refs still stores
// each row as owner->other internally (see the schema comment: that's an
// attribution detail for sync bookkeeping, letting a chamber's own sync
// delete-and-reinsert exactly the rows *it* discovered without touching a
// connection the other side discovered independently), but this collapses
// both directions into one deduped entry per "other" exhibit, isManual true
// if either side's row is manual.
export async function getConnections(id: string): Promise<ExhibitRefEntry[]> {
  const asOther = db.select().from(exhibitRefs).where(eq(exhibitRefs.targetId, id)).all();
  const asOwner = db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, id)).all();

  const byOtherId = new Map<string, { chamber: string | null; isManual: boolean }>();
  for (const row of asOther) {
    // This exhibit is row's target -> the other side is row.sourceId, whose
    // chamber is always known (sourceChamber is recorded on every row).
    const existing = byOtherId.get(row.sourceId);
    byOtherId.set(row.sourceId, { chamber: row.sourceChamber, isManual: (existing?.isManual ?? false) || row.isManual });
  }
  for (const row of asOwner) {
    // This exhibit is row's owner -> the other side is row.targetId, whose
    // chamber was never recorded on the row itself (only exhibit_cache might
    // know it) - same limitation the old frontlinks read had.
    const existing = byOtherId.get(row.targetId);
    byOtherId.set(row.targetId, { chamber: existing?.chamber ?? null, isManual: (existing?.isManual ?? false) || row.isManual });
  }

  const toResolve: { id: string; chamber: string }[] = [];
  const isManualByOtherId = new Map<string, boolean>();
  for (const [otherId, entry] of byOtherId) {
    let chamber = entry.chamber;
    if (chamber === null) {
      const cached = db.select().from(exhibitCache).where(eq(exhibitCache.id, otherId)).get();
      if (!cached) continue; // no cache row and no known chamber - nothing to route a resolve through
      chamber = cached.chamber;
    }
    toResolve.push({ id: otherId, chamber });
    isManualByOtherId.set(otherId, entry.isManual);
  }

  const resolved = await resolveExhibits(toResolve);
  // Promise.all (inside resolveExhibits) preserves input order, so
  // `toResolve` and `resolved` line up index-for-index.
  return resolved.map((r, i) => ({ ...r, isManual: isManualByOtherId.get(toResolve[i]!.id) ?? false }));
}

// Which side owns a manual connection between two exhibit ids, so a DELETE
// from either exhibit's Connections panel removes the right underlying row
// regardless of which side it was originally added from - a manual
// connection has no canonical owner from the UI's perspective, only from
// storage's (see exhibit_refs's own schema comment).
export function getManualConnectionOwner(aId: string, bId: string): { ownerId: string; chamber: string } | null {
  const row = db
    .select()
    .from(exhibitRefs)
    .where(
      and(
        eq(exhibitRefs.isManual, true),
        or(
          and(eq(exhibitRefs.sourceId, aId), eq(exhibitRefs.targetId, bId)),
          and(eq(exhibitRefs.sourceId, bId), eq(exhibitRefs.targetId, aId))
        )
      )
    )
    .get();
  if (!row) return null;
  return { ownerId: row.sourceId, chamber: row.sourceChamber };
}
