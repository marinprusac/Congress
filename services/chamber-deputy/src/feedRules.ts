import { closeness, formatDuration, plainTextPreview } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import type { DirectiveSummary } from "./types.js";

const SOON_WINDOW_MS = 60 * 60 * 1000;

// Deputy's home-feed candidates: an enabled directive whose own timer fires
// within the hour, so the owner can see (and adjust) what's about to run.
// Pure - `directives` is listDirectives()'s output (nextRunAt is derived).
export function deputyFeedCandidates(directives: DirectiveSummary[], now: Date): FeedCandidate[] {
  const items: FeedCandidate[] = [];
  for (const directive of directives) {
    if (!directive.enabled || !directive.nextRunAt) continue;
    const ms = new Date(directive.nextRunAt).getTime() - now.getTime();
    if (ms < 0 || ms > SOON_WINDOW_MS) continue;
    items.push({
      kind: "exhibit",
      exhibitId: `directive-${directive.id}`,
      score: Math.round(30 + 20 * closeness(ms, SOON_WINDOW_MS)),
      reason: `Runs in ${formatDuration(ms)}`,
      // What the feed shows inline: when it runs, and what it's going to do.
      preview: { time: { label: "Runs", start: directive.nextRunAt }, body: plainTextPreview(directive.body) },
    });
  }
  return items;
}
