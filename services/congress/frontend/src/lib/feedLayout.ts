import type { FeedItem } from "@congress/shared-types";

// How an item sits in the feed: the one lead story, or a record.
export type FeedSlot = "lead" | "item";

// The lead is the first ranked record that carries a preview.
export function feedSlots(items: readonly FeedItem[]): FeedSlot[] {
  let lead = -1;
  items.forEach((item, i) => {
    if (lead === -1 && item.preview) lead = i;
  });
  return items.map((item, i) => (i === lead ? "lead" : "item"));
}
