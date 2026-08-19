import { eq } from "drizzle-orm";
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

export async function getBacklinks(id: string): Promise<ExhibitRefEntry[]> {
  const rows = db.select().from(exhibitRefs).where(eq(exhibitRefs.targetId, id)).all();
  const refs = rows.map((r) => ({ id: r.sourceId, chamber: r.sourceChamber }));
  const resolved = await resolveExhibits(refs);
  // Promise.all (inside resolveExhibits) preserves input order, so `rows`
  // and `resolved` line up index-for-index.
  return resolved.map((r, i) => ({ ...r, isManual: rows[i]!.isManual }));
}

// Unlike getBacklinks, a target's chamber is never recorded in exhibit_refs
// (only the source's is - see the schema comment), so this can only resolve
// against exhibit_cache and must skip a target with no cache row instead of
// guessing a chamber for a live resolve. In practice this doesn't arise: a
// chamber syncs on every create, and a "[[" reference can only target
// something that already exists.
export async function getFrontlinks(id: string): Promise<ExhibitRefEntry[]> {
  const rows = db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, id)).all();
  const results: ExhibitRefEntry[] = [];
  for (const { targetId, isManual } of rows) {
    const cached = db.select().from(exhibitCache).where(eq(exhibitCache.id, targetId)).get();
    if (!cached) continue;
    results.push(
      cached.deleted
        ? { id: targetId, chamber: cached.chamber, deleted: true, isManual }
        : { id: targetId, chamber: cached.chamber, name: cached.name, url: cached.url, isManual }
    );
  }
  return results;
}
