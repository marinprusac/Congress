import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "../db/client.js";
import { workouts, settings } from "../db/schema.js";

vi.mock("./client.js", async () => {
  const actual = await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, fetchWorkoutEventsPage: vi.fn(), fetchWorkout: vi.fn() };
});
vi.mock("../events.js", () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }));

import { fetchWorkoutEventsPage } from "./client.js";
import { publishEvent } from "../events.js";
import { processHevyEvents, doPoll } from "./poller.js";
import { getSyncState } from "./pollState.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => {
  db.run(sql`delete from workouts`);
  db.run(sql`delete from workout_refs`);
  db.run(sql`delete from settings`);
  vi.mocked(fetchWorkoutEventsPage).mockReset();
  vi.mocked(publishEvent).mockClear();
});

function fakeWorkout(id: string, title: string) {
  return {
    id,
    title,
    start_time: "2026-08-25T10:00:00.000Z",
    end_time: "2026-08-25T11:00:00.000Z",
    exercises: [{ title: "Bench Press", sets: [{ index: 0, type: "normal", weight_kg: 60, reps: 8, rpe: 8 }] }],
  };
}

describe("processHevyEvents", () => {
  it("inserts a new workout for an 'updated' event with an embedded workout, computing total volume", async () => {
    const event = { type: "updated", workout: fakeWorkout("hevy-1", "Push Day"), updated_at: "2026-08-25T11:05:00.000Z" };

    const { latestTimestamp } = await processHevyEvents([event], "fake-key");

    expect(latestTimestamp).toBe("2026-08-25T11:05:00.000Z");
    const rows = db.select().from(workouts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Push Day");
    expect(rows[0]?.totalVolumeKg).toBe(480);
  });

  it("updates the existing row in place for a repeated hevyId, rather than duplicating", async () => {
    await processHevyEvents([{ type: "updated", workout: fakeWorkout("hevy-1", "Push Day"), updated_at: "t1" }], "k");
    await processHevyEvents(
      [{ type: "updated", workout: fakeWorkout("hevy-1", "Push Day (renamed)"), updated_at: "t2" }],
      "k"
    );

    const rows = db.select().from(workouts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Push Day (renamed)");
  });

  it("removes the row for a 'deleted' event", async () => {
    await processHevyEvents([{ type: "updated", workout: fakeWorkout("hevy-1", "Push Day"), updated_at: "t1" }], "k");
    await processHevyEvents([{ type: "deleted", id: "hevy-1", deleted_at: "t2" }], "k");

    expect(db.select().from(workouts).all()).toHaveLength(0);
  });

  it("advances latestTimestamp to the newest event timestamp actually seen, regardless of fetch order", async () => {
    const older = { type: "updated", workout: fakeWorkout("hevy-1", "A"), updated_at: "2026-08-20T00:00:00.000Z" };
    const newer = { type: "updated", workout: fakeWorkout("hevy-2", "B"), updated_at: "2026-08-25T00:00:00.000Z" };

    const { latestTimestamp } = await processHevyEvents([older, newer], "k");

    expect(latestTimestamp).toBe("2026-08-25T00:00:00.000Z");
  });

  it("publishes fitness.workout_synced only for a newly-created workout, not a later update", async () => {
    await processHevyEvents([{ type: "updated", workout: fakeWorkout("hevy-1", "Push Day"), updated_at: "t1" }], "k");
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "fitness.workout_synced" }));

    vi.mocked(publishEvent).mockClear();
    await processHevyEvents(
      [{ type: "updated", workout: fakeWorkout("hevy-1", "Push Day v2"), updated_at: "t2" }],
      "k"
    );
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("doPoll failure threshold", () => {
  it("publishes fitness.sync_failing only once the failure streak crosses the threshold, then resets after a success", async () => {
    db.insert(settings).values({ id: 1, hevyApiKey: "fake-key" }).run();
    vi.mocked(fetchWorkoutEventsPage).mockRejectedValue(new Error("boom"));

    await doPoll();
    await doPoll();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(getSyncState().consecutiveFailures).toBe(2);

    await doPoll();
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "fitness.sync_failing" }));
    expect(getSyncState().consecutiveFailures).toBe(3);

    vi.mocked(publishEvent).mockClear();
    vi.mocked(fetchWorkoutEventsPage).mockResolvedValue({ events: [], pageCount: 1 });
    await doPoll();
    expect(getSyncState().consecutiveFailures).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
