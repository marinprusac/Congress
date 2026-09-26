import { formatDuration } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import type { WorkoutSummary } from "./types.js";

const JUST_FINISHED_MS = 12 * 60 * 60 * 1000;

// Fitness's home-feed candidates: a workout finished in the last half day
// surfaces on its own; the Health view (Fitness's one real view - charts,
// not a list of exhibits) stays a low, always-reachable card. Pure -
// `recent` is listRecentWorkouts(), newest first.
export function fitnessFeedCandidates(recent: WorkoutSummary[], now: Date): FeedCandidate[] {
  const items: FeedCandidate[] = [];

  const latest = recent[0];
  const sinceLatest = latest ? now.getTime() - new Date(latest.endTime).getTime() : Infinity;
  if (latest !== undefined && sinceLatest >= 0 && sinceLatest <= JUST_FINISHED_MS) {
    items.push({ kind: "exhibit", exhibitId: `workout-${latest.id}`, score: 50, reason: `Finished ${formatDuration(sinceLatest)} ago` });
  }

  items.push({ kind: "view", viewId: "health", score: 15 });
  return items;
}
