import { describe, expect, it } from "vitest";
import type { DirectiveSummary } from "./types.js";
import { deputyFeedCandidates } from "./feedRules.js";

const now = new Date("2026-09-27T12:00:00.000Z");
const MIN = 60 * 1000;

function directive(id: number, nextRunInMin: number | null, enabled = true): DirectiveSummary {
  return {
    id,
    title: `Directive ${id}`,
    body: "",
    enabled,
    scheduleType: "interval",
    intervalMs: 60 * MIN,
    scheduleHour: null,
    scheduleMinute: null,
    scheduleDayOfWeek: null,
    scheduleTimeZone: null,
    triggerEventType: null,
    nextRunAt: nextRunInMin === null ? null : new Date(now.getTime() + nextRunInMin * MIN).toISOString(),
    scheduleCycleStart: null,
    lastRunAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("deputyFeedCandidates", () => {
  it("surfaces an enabled directive due within the hour, sooner ranking higher", () => {
    const items = deputyFeedCandidates([directive(1, 50), directive(2, 5)], now);
    expect(items.map((i) => i.kind === "exhibit" && i.exhibitId)).toEqual(["directive-1", "directive-2"]);
    expect(items[1]!.score).toBeGreaterThan(items[0]!.score);
    expect(items[1]!.reason).toBe("Runs in 5 min");
  });

  it("shows when it runs and its instructions inline", () => {
    const d = { ...directive(1, 10), body: "Check the **soil** sensors and water if dry." };
    expect(deputyFeedCandidates([d], now)[0]).toMatchObject({
      preview: { time: { label: "Runs", start: d.nextRunAt }, body: "Check the soil sensors and water if dry." },
    });
  });

  it("leaves out disabled, manual-only, overdue and later directives", () => {
    expect(deputyFeedCandidates([directive(1, 5, false), directive(2, null), directive(3, -5), directive(4, 90)], now)).toEqual([]);
  });
});
