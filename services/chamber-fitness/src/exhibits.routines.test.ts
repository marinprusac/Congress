import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { workouts, settings } from "./db/schema.js";

vi.mock("./routines.js", async () => {
  const actual = await vi.importActual<typeof import("./routines.js")>("./routines.js");
  return { ...actual, listRoutines: vi.fn(), getRoutine: vi.fn() };
});

import { listRoutines, getRoutine } from "./routines.js";
import { search, resolve, toExhibitId } from "./exhibits.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => {
  db.run(sql`delete from workouts`);
  db.run(sql`delete from settings`);
  vi.mocked(listRoutines).mockReset();
  vi.mocked(getRoutine).mockReset();
});

function insertWorkout(title: string, startTime = new Date()) {
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
      exerciseNames: "",
      createdAt: startTime,
      updatedAt: startTime,
    })
    .returning()
    .get();
}

function configureHevyKey() {
  db.insert(settings).values({ id: 1, hevyApiKey: "fake-key" }).run();
}

describe("search (workout + routine dispatcher)", () => {
  it("merges a workout match and a routine match, ranked by score", async () => {
    configureHevyKey();
    const workout = insertWorkout("Push Day Log");
    vi.mocked(listRoutines).mockResolvedValue([
      { id: "r1", title: "Push Day", folderId: null, updatedAt: "", createdAt: "", exerciseCount: 0 },
    ]);

    const results = await search("push");

    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining([toExhibitId(workout.id), "routine-r1"]));
    expect(results.find((r) => r.id === "routine-r1")?.type).toBe("routine");
  });

  it("still returns workout results when no Hevy API key is configured", async () => {
    const workout = insertWorkout("Push Day Log");

    const results = await search("push");

    expect(results.map((r) => r.id)).toEqual([toExhibitId(workout.id)]);
  });

  it("still returns workout results when the routine source throws", async () => {
    configureHevyKey();
    const workout = insertWorkout("Push Day Log");
    vi.mocked(listRoutines).mockRejectedValue(new Error("Hevy is down"));

    const results = await search("push");

    expect(results.map((r) => r.id)).toEqual([toExhibitId(workout.id)]);
  });
});

describe("resolve (workout + routine dispatcher)", () => {
  it("resolves a mixed-prefix id list, recombining in input order", async () => {
    configureHevyKey();
    const workout = insertWorkout("Push Day Log");
    vi.mocked(getRoutine).mockResolvedValue({ id: "r1", title: "Push Day", folderId: null, updatedAt: "", createdAt: "", exercises: [] });

    const results = await resolve(["routine-r1", toExhibitId(workout.id), "workout-999999"]);

    expect(results).toEqual([
      { id: "routine-r1", name: "Push Day", url: "/fitness/routines/r1" },
      expect.objectContaining({ id: toExhibitId(workout.id) }),
      { id: "workout-999999", deleted: true },
    ]);
  });

  it("resolves an unresolvable routine id as deleted rather than throwing", async () => {
    configureHevyKey();
    vi.mocked(getRoutine).mockResolvedValue(null);

    const [result] = await resolve(["routine-missing"]);

    expect(result).toEqual({ id: "routine-missing", deleted: true });
  });
});
