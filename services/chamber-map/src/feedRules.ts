import type { FeedCandidate } from "@congress/shared-types";
import type { Visit } from "./types.js";

// Map's home-feed candidates: stays waiting to be classified are an explicit
// to-do; today's map and visits matter once the day has any; the place the
// owner is at right now surfaces on its own. Pure - `pending` is every
// pending visit, `today` every visit since local midnight.
export function mapFeedCandidates(input: { pending: Visit[]; today: Visit[] }): FeedCandidate[] {
  const items: FeedCandidate[] = [];

  const pending = input.pending.length;
  items.push(
    pending > 0 ? { kind: "view", viewId: "pending", score: 60, reason: `${pending} to classify` } : { kind: "view", viewId: "pending", score: 5 }
  );

  const known = input.today.filter((v) => v.status === "confirmed" || v.status === "adhoc");
  items.push(
    known.length > 0
      ? { kind: "view", viewId: "today-map", score: 35, reason: `${known.length} ${known.length === 1 ? "place" : "places"} today` }
      : { kind: "view", viewId: "today-map", score: 15 }
  );

  const current = known.find((v) => v.departedAt === null && v.placeId !== null);
  if (current) items.push({ kind: "exhibit", exhibitId: `place-${current.placeId}`, score: 45, reason: "You're here" });

  return items;
}
