import { closeness, formatDuration, plainTextPreview } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import type { ItemSummary } from "./types.js";

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

// This Chamber's candidates for Congress's home feed (GET /api/feed, see
// server.ts's mountFeedRoute): which of its exhibits matter *right now*,
// each scored 0-100 with a short reason and an inline preview - feed items
// show their information, they're not just links. Replace this example rule
// (items touched in the last day) with whatever makes one of your exhibits
// urgent. Keep it pure so it can be unit-tested against a fixed `now`.
export function itemFeedCandidates(recent: ItemSummary[], now: Date): FeedCandidate[] {
  const items: FeedCandidate[] = [];
  for (const item of recent) {
    const age = now.getTime() - new Date(item.updatedAt).getTime();
    if (age < 0 || age > FRESH_WINDOW_MS) continue;
    items.push({
      kind: "exhibit",
      exhibitId: `item-${item.id}`,
      score: Math.round(10 + 20 * closeness(age, FRESH_WINDOW_MS)),
      reason: `Edited ${formatDuration(age)} ago`,
      preview: { body: plainTextPreview(item.body) },
    });
  }
  return items;
}
