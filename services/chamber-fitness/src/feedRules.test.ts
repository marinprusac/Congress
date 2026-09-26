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
    const items = fitnessFeedCandidates([workout(4, 2)], now);
    expect(items).toContainEqual({
      kind: "exhibit",
      exhibitId: "workout-4",
      score: 50,
      reason: "Finished 2 h ago",
      preview: {
        title: "Push · 27 Sep",
        time: { start: "2026-09-27T15:00:00.000Z", end: "2026-09-27T16:00:00.000Z" },
        fields: ["5 exercises", "1,000 kg"],
      },
    });
  });

  it("lets an older workout drop out", () => {
    expect(fitnessFeedCandidates([workout(4, 30)], now).some((i) => i.kind === "exhibit")).toBe(false);
  });

  it("always offers the Health view, and nothing else when there's no recent workout", () => {
    expect(fitnessFeedCandidates([], now)).toEqual([{ kind: "view", viewId: "health", score: 15 }]);
  });
});
