import { formatDuration } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import type { WeekStats } from "./workouts.js";
import type { WorkoutSummary } from "./types.js";

const JUST_FINISHED_MS = 12 * 60 * 60 * 1000;

// Fitness's home-feed candidates: a workout finished in the last half day
// surfaces on its own (and lifts the recent-workouts card); the week's
// stats card rises once the week has any training in it. Health stays a
// low, always-reachable card. Pure - `recent` is listRecentWorkouts().
export function fitnessFeedCandidates(input: { recent: WorkoutSummary[]; week: WeekStats }, now: Date): FeedCandidate[] {
  const items: FeedCandidate[] = [];

  const latest = input.recent[0];
  const sinceLatest = latest ? now.getTime() - new Date(latest.endTime).getTime() : Infinity;
  const justFinished = latest !== undefined && sinceLatest >= 0 && sinceLatest <= JUST_FINISHED_MS;
  if (justFinished) {
    items.push({ kind: "exhibit", exhibitId: `workout-${latest.id}`, score: 50, reason: `Finished ${formatDuration(sinceLatest)} ago` });
  }

  items.push({ kind: "view", viewId: "recent-workouts", score: justFinished ? 35 : 15 });
  items.push(
    input.week.workoutCount > 0
      ? { kind: "view", viewId: "week-stats", score: 30, reason: `${input.week.workoutCount} ${input.week.workoutCount === 1 ? "workout" : "workouts"} this week` }
      : { kind: "view", viewId: "week-stats", score: 12 }
  );
  items.push({ kind: "view", viewId: "health-snapshot", score: 15 });
  return items;
}
