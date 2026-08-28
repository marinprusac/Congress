import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { searchWorkoutExhibits, resolveWorkoutExhibits, toExhibitId } from "./exhibits.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => db.run(sql`delete from workouts`));

function insertWorkout(title: string, exerciseNames = "") {
  const now = new Date();
  return db
    .insert(workouts)
    .values({
      hevyId: `hevy-${title}`,
      title,
      startTime: now,
      endTime: now,
      exerciseCount: 1,
      totalVolumeKg: null,
      exercisesJson: "[]",
      exerciseNames,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

describe("searchWorkoutExhibits", () => {
  it("matches on title", async () => {
    insertWorkout("Push Day");
    const results = await searchWorkoutExhibits("push");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Push Day");
  });

  it("matches on the denormalized exercise-names column even when the title doesn't mention them", async () => {
    insertWorkout("Morning Session", "Bench Press Overhead Press");
    const results = await searchWorkoutExhibits("bench press");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Morning Session");
  });

  it("finds nothing for an unrelated query", async () => {
    insertWorkout("Push Day");
    await expect(searchWorkoutExhibits("legs")).resolves.toEqual([]);
  });
});

describe("resolveWorkoutExhibits", () => {
  it("resolves an existing workout to its name/url", async () => {
    const row = insertWorkout("Push Day");
    const [result] = await resolveWorkoutExhibits([toExhibitId(row.id)]);
    expect(result).toMatchObject({ id: toExhibitId(row.id), name: "Push Day", url: `/fitness/workouts/${row.id}` });
  });

  it("resolves a non-existent workout id as deleted", async () => {
    const [result] = await resolveWorkoutExhibits(["workout-999999"]);
    expect(result).toEqual({ id: "workout-999999", deleted: true });
  });
});
