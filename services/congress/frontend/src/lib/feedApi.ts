import type { FeedItem } from "@congress/shared-types";
import { parseJsonResponse as json } from "@congress/congress-ui";

export const feedQueryKey = ["congress", "feed"] as const;

export function fetchFeed(): Promise<FeedItem[]> {
  return fetch("/congress/feed")
    .then((res) => json<{ items: FeedItem[] }>(res))
    .then((body) => body.items);
}
