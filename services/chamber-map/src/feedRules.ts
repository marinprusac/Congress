import type { FeedCandidate } from "@congress/shared-types";
import type { Visit } from "./types.js";

// Map's home-feed candidates: today's map (its one carded view - a real map
// preview) matters once the day has any places in it, and the place the
// owner is at right now surfaces on its own, showing since when. The
// classify queue ("Visits to classify") has no feed card, so it's reached
// through Search and the pinned row rather than the feed. Pure - `today` is
// every visit since local midnight.
export function mapFeedCandidates(input: { today: Visit[] }): FeedCandidate[] {
  const items: FeedCandidate[] = [];

  const known = input.today.filter((v) => v.status === "confirmed" || v.status === "adhoc");
  items.push(
    known.length > 0
      ? { kind: "view", viewId: "today-map", score: 35, reason: `${known.length} ${known.length === 1 ? "place" : "places"} today` }
      : { kind: "view", viewId: "today-map", score: 15 }
  );

  const current = known.find((v) => v.departedAt === null && v.placeId !== null);
  if (current) {
    items.push({
      kind: "exhibit",
      exhibitId: `place-${current.placeId}`,
      score: 45,
      reason: "You're here",
      preview: { title: current.placeName ?? undefined, time: { label: "Since", start: current.arrivedAt } },
    });
  }

  return items;
}
