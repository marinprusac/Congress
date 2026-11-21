import type { FeedCandidate, FeedItem, FeedPreview } from "@congress/shared-types";
import { resolveRecords } from "./records.js";
import { listLocalSources } from "./recordSources.js";
import { listConnectors } from "./connectors/runtime.js";

// The home "For You" feed. Every source (record types, connectors) supplies
// its own scored candidates and this merges and ranks them. rankFeed is
// deliberately the one place a smarter ranker (e.g. Haiku re-ranking the same
// candidates) can slot in later.

const MAX_ITEMS = 50;

export interface ChamberCandidates {
  chamber: { name: string };
  candidates: FeedCandidate[];
}

type Unresolved = { kind: "record"; chamber: string; recordId: string; score: number; reason?: string; preview?: FeedPreview };

// Pure: merges every source's candidates into one list sorted by score
// (ties keep registration order); a record named twice keeps its best-scored
// candidate.
export function rankFeed(perChamber: ChamberCandidates[]): Unresolved[] {
  const items: Unresolved[] = [];
  const seenRecords = new Map<string, Unresolved>();

  for (const { chamber, candidates } of perChamber) {
    for (const candidate of candidates) {
      const prev = seenRecords.get(candidate.recordId);
      if (prev && prev.score >= candidate.score) continue;
      const item = {
        kind: "record" as const,
        chamber: chamber.name,
        recordId: candidate.recordId,
        score: candidate.score,
        reason: candidate.reason,
        preview: candidate.preview,
      };
      if (prev) items.splice(items.indexOf(prev), 1, item);
      else items.push(item);
      seenRecords.set(candidate.recordId, item);
    }
  }

  // Array.prototype.sort is stable, so equal scores keep the order above.
  return items.sort((a, b) => b.score - a.score).slice(0, MAX_ITEMS);
}

export async function getFeed(): Promise<FeedItem[]> {
  const perChamber: ChamberCandidates[] = [];
  for (const source of listLocalSources()) {
    try {
      perChamber.unshift({ chamber: { name: source.namespace }, candidates: source.feedCandidates(new Date()) });
    } catch (err) {
      console.warn(`[feed] ${source.namespace} failed: ${(err as Error).message}`);
    }
  }
  for (const c of listConnectors()) {
    try {
      for (const out of (await c.feed?.(new Date())) ?? []) perChamber.push({ chamber: { name: out.source }, candidates: out.candidates });
    } catch (err) {
      console.warn(`[feed] connector ${c.name} failed: ${(err as Error).message}`);
    }
  }
  const ranked = rankFeed(perChamber);

  const refs = ranked.flatMap((item) => [{ id: item.recordId, chamber: item.chamber }]);
  const resolved = new Map((await resolveRecords(refs)).map((r) => [r.id, r]));

  const items: FeedItem[] = [];
  for (const item of ranked) {
    const hit = resolved.get(item.recordId);
    // Deleted or currently unresolvable records just drop out of the feed.
    if (!hit || "deleted" in hit || "unavailable" in hit) continue;
    items.push({ ...item, name: hit.name, url: hit.url, type: hit.type });
  }
  return items;
}
