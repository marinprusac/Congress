import type { FeedItem } from "@congress/shared-types";

// How an item sits in the feed: the one lead story, a view card (a figure), or a record.
export type FeedSlot = "lead" | "view" | "item";

// The lead is the first ranked record that carries a preview. A view card never leads:
// it is a figure, not a story.
export function feedSlots(items: readonly FeedItem[]): FeedSlot[] {
  let lead = -1;
  items.forEach((item, i) => {
    if (lead === -1 && item.kind === "exhibit" && item.preview) lead = i;
  });
  return items.map((item, i) => (i === lead ? "lead" : item.kind === "view" ? "view" : "item"));
}
