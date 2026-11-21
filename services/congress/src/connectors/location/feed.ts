import type { FeedCandidate } from "@congress/shared-types";
import type { Visit } from "./types.js";

// The location connector's feed, pure: the Place you're at right now.
export function mapFeed(today: Visit[]): { source: string; candidates: FeedCandidate[] }[] {
  const known = today.filter((v) => v.status === "confirmed" || v.status === "adhoc");
  const current = known.find((v) => v.departedAt === null && v.placeId !== null);
  const here: FeedCandidate[] = current
    ? [
        {
          kind: "record",
          recordId: current.placeId!,
          score: 45,
          reason: "You're here",
          preview: { title: current.placeName ?? undefined, time: { label: "Since", start: current.arrivedAt } },
        },
      ]
    : [];
  return [{ source: "e", candidates: here }];
}
