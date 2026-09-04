import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { searchWorkoutExhibits, resolveWorkoutExhibits, toExhibitId } from "./exhibits.js";
import { formatWorkoutExhibitTitle } from "./workoutTitle.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => db.run(sql`delete from workouts`));

function insertWorkout(title: string, exerciseNames = "", startTime = new Date()) {
  return db
    .insert(workouts)
    .values({
      hevyId: `hevy-${title}-${startTime.getTime()}`,
      title,
      startTime,
      endTime: startTime,
      exerciseCount: 1,
      totalVolumeKg: null,
      exercisesJson: "[]",
      exerciseNames,
      createdAt: startTime,
      updatedAt: startTime,
    })
    .returning()
    .get();
}

describe("searchWorkoutExhibits", () => {
  it("matches on title, composing the exhibit name as title + date", async () => {
    const row = insertWorkout("Push Day");
    const results = await searchWorkoutExhibits("push");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe(formatWorkoutExhibitTitle("Push Day", row.startTime, 1));
  });

  it("matches on the denormalized exercise-names column even when the title doesn't mention them", async () => {
    const row = insertWorkout("Morning Session", "Bench Press Overhead Press");
    const results = await searchWorkoutExhibits("bench press");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe(formatWorkoutExhibitTitle("Morning Session", row.startTime, 1));
  });

  it("finds nothing for an unrelated query", async () => {
    insertWorkout("Push Day");
    await expect(searchWorkoutExhibits("legs")).resolves.toEqual([]);
  });

  it("numbers same-title workouts logged on the same day", async () => {
    const first = insertWorkout("Push Day", "", new Date("2026-01-05T08:00:00Z"));
    const second = insertWorkout("Push Day", "", new Date("2026-01-05T18:00:00Z"));
    const results = await searchWorkoutExhibits("push");
    const names = results.map((r) => r.name);
    expect(names).toContain(formatWorkoutExhibitTitle("Push Day", first.startTime, 1));
    expect(names).toContain(formatWorkoutExhibitTitle("Push Day", second.startTime, 2));
  });
});

describe("resolveWorkoutExhibits", () => {
  it("resolves an existing workout to its composed name/url", async () => {
    const row = insertWorkout("Push Day");
    const [result] = await resolveWorkoutExhibits([toExhibitId(row.id)]);
    expect(result).toMatchObject({
      id: toExhibitId(row.id),
      name: formatWorkoutExhibitTitle("Push Day", row.startTime, 1),
      url: `/fitness/workouts/${row.id}`,
    });
  });

  it("resolves a non-existent workout id as deleted", async () => {
    const [result] = await resolveWorkoutExhibits(["workout-999999"]);
    expect(result).toEqual({ id: "workout-999999", deleted: true });
  });
});
