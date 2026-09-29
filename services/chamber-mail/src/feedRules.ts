import { closeness, formatDuration, plainTextPreview } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import { displayFrom } from "./gmail/mime.js";
import type { MessageSummary, Settings } from "./types.js";

export const MAX_FEED_THREADS = 8;

// Mail's home-feed candidates: unread inbox threads received within the
// window, newest scoring highest, Important/Starred nudged up. Primary only
// unless the owner opted into every category. Pure - `unread` is the
// cache's unread inbox messages, newest first.
export function mailFeedCandidates(
  unread: MessageSummary[],
  settings: Settings,
  accountLabels: Map<number, string>,
  now: Date
): FeedCandidate[] {
  const windowMs = settings.feedWindowHours * 60 * 60 * 1000;
  const threads = new Map<string, MessageSummary[]>();
  for (const message of unread) {
    const age = now.getTime() - new Date(message.date).getTime();
    if (age < 0 || age > windowMs) continue;
    if (!message.inInbox || !message.unread || message.labelIds.includes("SENT")) continue;
    if (!settings.includeAllCategories && message.category !== "primary") continue;
    const list = threads.get(message.exhibitId) ?? [];
    list.push(message);
    threads.set(message.exhibitId, list);
  }

  const multipleAccounts = accountLabels.size > 1;
  const items: FeedCandidate[] = [];
  for (const [exhibitId, list] of threads) {
    const latest = list.reduce((a, b) => (a.date >= b.date ? a : b));
    const age = now.getTime() - new Date(latest.date).getTime();
    const important = list.some((m) => m.labelIds.includes("IMPORTANT"));
    const starred = list.some((m) => m.labelIds.includes("STARRED"));
    const score = Math.min(75, Math.round(25 + 30 * closeness(age, windowMs) + (important ? 10 : 0) + (starred ? 10 : 0)));

    const fields = [displayFrom(latest.from).slice(0, 80)];
    if (list.length > 1) fields.push(`${list.length} unread`);
    if (multipleAccounts) {
      const label = accountLabels.get(latest.accountId);
      if (label) fields.push(label.slice(0, 80));
    }
    if (list.some((m) => m.hasAttachments)) fields.push("Attachment");

    items.push({
      kind: "exhibit",
      exhibitId,
      score,
      reason: starred ? "Starred, unread" : important ? "Important, unread" : `Unread · ${formatDuration(age)} ago`,
      preview: {
        title: latest.subject.slice(0, 200),
        time: { label: "Received", start: latest.date },
        fields: fields.slice(0, 4),
        body: plainTextPreview(latest.snippet),
      },
    });
  }
  return items.sort((a, b) => b.score - a.score).slice(0, MAX_FEED_THREADS);
}
