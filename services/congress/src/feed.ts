import { chamberFeedResponseSchema, type ChamberRegistryEntry, type FeedCandidate, type FeedItem, type FeedPreview } from "@congress/shared-types";
import { listChambers } from "./registry.js";
import { resolveExhibits } from "./exhibits.js";
import { chamberFetch } from "./chambers/runtime.js";
import { listLocalSources } from "./exhibitSources.js";

// The home "For You" feed. Every active Chamber is asked for its own scored
// candidates (GET /api/feed, chamber-kit's mountFeedRoute) - the domain
// knowledge of what's urgent stays in the Chamber - and this merges and
// ranks them. rankFeed is deliberately the one place a smarter ranker (e.g.
// Haiku re-ranking the same candidates) can slot in later.

// Short: the feed is fetched on every Home open, and a slow Chamber should
// cost its own candidates, not the whole feed.
const FEED_FAN_OUT_TIMEOUT_MS = 2_000;

// A declared view the Chamber didn't score (or a Chamber with no /api/feed
// at all) still shows up, just below anything actually time-relevant - the
// feed doubles as the way to reach a view.
export const DEFAULT_VIEW_SCORE = 10;

const MAX_ITEMS = 50;

async function fetchChamberCandidates(chamber: ChamberRegistryEntry, timeoutMs: number): Promise<FeedCandidate[]> {
  try {
    const res = await chamberFetch(chamber.name, "/feed", { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const parsed = chamberFeedResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.items : [];
  } catch {
    return [];
  }
}

export interface ChamberCandidates {
  chamber: Pick<ChamberRegistryEntry, "name" | "views">;
  candidates: FeedCandidate[];
}

type Unresolved =
  | Extract<FeedItem, { kind: "view" }>
  | { kind: "exhibit"; chamber: string; exhibitId: string; score: number; reason?: string; preview?: FeedPreview };

// Pure: merges every Chamber's candidates into one list sorted by score
// (ties keep registration order). Only views with a feed card take part -
// feed items show information inline, and a card-less view would be a bare
// link (those are reached through Search and the pinned row). Carded views
// a Chamber didn't score get DEFAULT_VIEW_SCORE; candidates naming a view
// the Chamber never declared (or one without a card) are dropped; an
// exhibit named twice keeps its best-scored candidate.
export function rankFeed(perChamber: ChamberCandidates[]): Unresolved[] {
  const items: Unresolved[] = [];
  const seenExhibits = new Map<string, Unresolved & { kind: "exhibit" }>();

  for (const { chamber, candidates } of perChamber) {
    const cardViews = chamber.views.filter((v) => v.card === true);
    const viewsById = new Map(cardViews.map((v) => [v.id, v]));
    const scoredViews = new Map<string, { score: number; reason?: string }>();

    for (const candidate of candidates) {
      if (candidate.kind === "view") {
        if (!viewsById.has(candidate.viewId)) continue;
        const prev = scoredViews.get(candidate.viewId);
        if (!prev || candidate.score > prev.score) scoredViews.set(candidate.viewId, { score: candidate.score, reason: candidate.reason });
      } else {
        const prev = seenExhibits.get(candidate.exhibitId);
        if (prev && prev.score >= candidate.score) continue;
        const item = {
          kind: "exhibit" as const,
          chamber: chamber.name,
          exhibitId: candidate.exhibitId,
          score: candidate.score,
          reason: candidate.reason,
          preview: candidate.preview,
        };
        if (prev) items.splice(items.indexOf(prev), 1, item);
        else items.push(item);
        seenExhibits.set(candidate.exhibitId, item);
      }
    }

    for (const view of cardViews) {
      const scored = scoredViews.get(view.id);
      items.push({
        kind: "view",
        chamber: chamber.name,
        viewId: view.id,
        label: view.label,
        fullPath: view.fullPath,
        score: scored?.score ?? DEFAULT_VIEW_SCORE,
        reason: scored?.reason,
      });
    }
  }

  // Array.prototype.sort is stable, so equal scores keep the order above.
  return items.sort((a, b) => b.score - a.score).slice(0, MAX_ITEMS);
}

export async function getFeed(opts: { timeoutMs?: number } = {}): Promise<FeedItem[]> {
  const timeoutMs = opts.timeoutMs ?? FEED_FAN_OUT_TIMEOUT_MS;
  const active = listChambers().filter((c) => c.status === "active");
  const perChamber: ChamberCandidates[] = await Promise.all(
    active.map(async (chamber) => ({ chamber, candidates: await fetchChamberCandidates(chamber, timeoutMs) }))
  );
  for (const source of listLocalSources()) {
    try {
      perChamber.unshift({ chamber: { name: source.namespace, views: [] }, candidates: source.feedCandidates(new Date()) });
    } catch (err) {
      console.warn(`[feed] ${source.namespace} failed: ${(err as Error).message}`);
    }
  }
  const ranked = rankFeed(perChamber);

  const exhibitRefs = ranked.flatMap((item) => (item.kind === "exhibit" ? [{ id: item.exhibitId, chamber: item.chamber }] : []));
  const resolved = new Map((await resolveExhibits(exhibitRefs)).map((r) => [r.id, r]));

  const items: FeedItem[] = [];
  for (const item of ranked) {
    if (item.kind === "view") {
      items.push(item);
      continue;
    }
    const hit = resolved.get(item.exhibitId);
    // Deleted or currently unresolvable exhibits just drop out of the feed.
    if (!hit || "deleted" in hit || "unavailable" in hit) continue;
    items.push({ ...item, name: hit.name, url: hit.url });
  }
  return items;
}
