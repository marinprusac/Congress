import type { FeedCandidate, ManifestView } from "@congress/shared-types";
import type { Visit } from "./types.js";

// The Map's feed, pure: today's map card (its view source is "map", as the
// Chamber's was, so pins keep working) and the Place you're at right now.
export const MAP_VIEWS: ManifestView[] = [
  { id: "today-map", label: "Today", card: true, fullPath: "/" },
  { id: "pending", label: "Visits to classify", fullPath: "/pending" },
];

export function mapFeed(today: Visit[]): { source: string; views: ManifestView[]; candidates: FeedCandidate[] }[] {
  const known = today.filter((v) => v.status === "confirmed" || v.status === "adhoc");
  const card: FeedCandidate =
    known.length > 0
      ? { kind: "view", viewId: "today-map", score: 35, reason: `${known.length} ${known.length === 1 ? "place" : "places"} today` }
      : { kind: "view", viewId: "today-map", score: 15 };
  const current = known.find((v) => v.departedAt === null && v.placeId !== null);
  const here: FeedCandidate[] = current
    ? [
        {
          kind: "exhibit",
          exhibitId: current.placeId!,
          score: 45,
          reason: "You're here",
          preview: { title: current.placeName ?? undefined, time: { label: "Since", start: current.arrivedAt } },
        },
      ]
    : [];
  return [
    { source: "map", views: MAP_VIEWS, candidates: [card] },
    { source: "e", views: [], candidates: here },
  ];
}
