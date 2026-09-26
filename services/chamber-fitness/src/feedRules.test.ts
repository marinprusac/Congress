import { describe, expect, it } from "vitest";
import type { WorkoutSummary } from "./types.js";
import { fitnessFeedCandidates } from "./feedRules.js";

const now = new Date("2026-09-27T18:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function workout(id: number, endedHoursAgo: number): WorkoutSummary {
  const end = new Date(now.getTime() - endedHoursAgo * HOUR);
  return {
    id,
    hevyId: `h${id}`,
    title: "Push",
    exhibitTitle: "Push · 27 Sep",
    startTime: new Date(end.getTime() - HOUR).toISOString(),
    endTime: end.toISOString(),
    exerciseCount: 5,
    totalVolumeKg: 1000,
  };
}

describe("fitnessFeedCandidates", () => {
  it("surfaces a workout finished within half a day", () => {
    const items = fitnessFeedCandidates({ recent: [workout(4, 2)], week: { workoutCount: 1, totalVolumeKg: 1000 } }, now);
    expect(items).toContainEqual({ kind: "exhibit", exhibitId: "workout-4", score: 50, reason: "Finished 2 h ago" });
    expect(items).toContainEqual({ kind: "view", viewId: "recent-workouts", score: 35 });
    expect(items).toContainEqual({ kind: "view", viewId: "week-stats", score: 30, reason: "1 workout this week" });
  });

  it("lets an older workout drop out and the cards sink on a quiet week", () => {
    const items = fitnessFeedCandidates({ recent: [workout(4, 30)], week: { workoutCount: 0, totalVolumeKg: 0 } }, now);
    expect(items.some((i) => i.kind === "exhibit")).toBe(false);
    expect(items).toContainEqual({ kind: "view", viewId: "week-stats", score: 12 });
  });

  it("copes with no workouts at all", () => {
    const items = fitnessFeedCandidates({ recent: [], week: { workoutCount: 0, totalVolumeKg: 0 } }, now);
    expect(items.map((i) => (i.kind === "view" ? i.viewId : i.exhibitId))).toEqual(["recent-workouts", "week-stats", "health-snapshot"]);
  });
});
