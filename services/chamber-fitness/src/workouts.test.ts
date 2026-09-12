import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { getWorkout } from "./workouts.js";
import { computeOneRepMax } from "./oneRepMax.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => db.run(sql`delete from workouts`));

function insertWorkoutRow(exercisesJson: string) {
  const startTime = new Date("2026-01-05T08:00:00Z");
  return db
    .insert(workouts)
    .values({
      hevyId: `hevy-${Date.now()}-${Math.random()}`,
      title: "Push Day",
      startTime,
      endTime: startTime,
      exerciseCount: 1,
      totalVolumeKg: null,
      exercisesJson,
      exerciseNames: "Bench Press",
      createdAt: startTime,
      updatedAt: startTime,
    })
    .returning()
    .get();
}

describe("getWorkout", () => {
  it("strips a legacy `type` key still present in exercisesJson and computes oneRepMax", async () => {
    const row = insertWorkoutRow(
      JSON.stringify([
        {
          name: "Bench Press",
          sets: [{ index: 0, type: "warmup", weightKg: 100, reps: 5, durationSeconds: null, distanceMeters: null, rpe: 8 }],
        },
      ])
    );

    const detail = await getWorkout(row.id);

    expect(detail?.exercises[0]?.sets[0]).toEqual({
      index: 0,
      weightKg: 100,
      reps: 5,
      durationSeconds: null,
      distanceMeters: null,
      rpe: 8,
      oneRepMax: computeOneRepMax(100, 5),
    });
    expect(detail?.exercises[0]?.sets[0]).not.toHaveProperty("type");
  });

  it("degrades to an empty exercise list rather than throwing on malformed exercisesJson", async () => {
    const row = insertWorkoutRow(JSON.stringify([{ name: "Bench Press", sets: [{ notEvenCloseToASet: true }] }]));

    const detail = await getWorkout(row.id);

    expect(detail?.exercises).toEqual([]);
  });

  it("returns null for a non-existent workout", async () => {
    expect(await getWorkout(999999)).toBeNull();
  });
});
