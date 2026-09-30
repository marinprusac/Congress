import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client.js")>()),
  fetchWorkoutEventsPage: vi.fn(),
  fetchWorkout: vi.fn(),
  fetchRoutinesPage: vi.fn(),
  fetchRoutineFolders: vi.fn(),
  createRoutine: vi.fn(),
  updateRoutine: vi.fn(),
}));

import { createRoutine as hevyCreate, fetchRoutineFolders, fetchRoutinesPage, fetchWorkoutEventsPage, updateRoutine as hevyUpdate } from "./client.js";
import { hevyDb, runHevyMigrations } from "./db/client.js";
import { getHevySettings, getRoutineRow, getWorkoutRow, routineRecord, updateHevySettings, workoutDetail, workoutRecord } from "./cache.js";
import { syncHevy } from "./sync.js";
import { createRoutine } from "./routines.js";
import { hevyConnector } from "./index.js";
import type { ConnectorContext } from "../contract.js";
import { setOwnerZoneForTests } from "../../typeEngine/zone.js";

const changes: { kind: string; key: string; deleted: boolean; quiet: boolean }[] = [];
const published: { type: string; payload: Record<string, unknown> }[] = [];
const ctx = {
  name: "hevy",
  google: { accounts: () => [], fetch: async () => undefined },
  people: { find: () => null, resolve: () => null },
  records: { idFor: (kind: string, key: string) => `rec-${kind}-${key}` },
  emitChange: (kind: string, key: string, deleted = false, quiet = false) => changes.push({ kind, key, deleted, quiet }),
  publish: (type: string, payload: Record<string, unknown>) => published.push({ type, payload }),
  syncNow: () => {},
  reschedule: () => {},
} as ConnectorContext;

const set = (weight: number, reps: number) => ({ index: 0, weight_kg: weight, reps });
const workout = (id: string, title: string, sets = [set(100, 5)]) => ({
  id,
  title,
  start_time: "2026-09-05T08:00:00Z",
  end_time: "2026-09-05T09:00:00Z",
  exercises: [{ title: "Bench Press", sets }],
});
const routine = (id: string, title: string, updated = "u1") => ({
  id,
  title,
  folder_id: 7,
  updated_at: updated,
  exercises: [{ exercise_template_id: "T1", title: "Squat", sets: [{ type: "normal", reps: 5, weight_kg: 80 }] }],
});
let events: unknown[] = [];
let routinesList: unknown[] = [];

beforeAll(() => {
  runHevyMigrations();
  setOwnerZoneForTests("Europe/Zagreb");
});

beforeEach(() => {
  for (const t of ["workouts", "routines", "folders", "settings"]) hevyDb.run(sql.raw(`delete from ${t}`));
  changes.length = 0;
  published.length = 0;
  events = [];
  routinesList = [];
  updateHevySettings({ apiKey: "key" });
  vi.mocked(fetchWorkoutEventsPage).mockImplementation(async () => ({ events, pageCount: 1 }));
  vi.mocked(fetchRoutinesPage).mockImplementation(async () => ({ routines: routinesList, pageCount: 1 }));
  vi.mocked(fetchRoutineFolders).mockResolvedValue({ folders: [{ id: 7, index: 0, title: "Strength" }], pageCount: 1 });
});

describe("hevy sync", () => {
  it("backfills quietly, then announces new workouts once allowed", async () => {
    events = [{ type: "updated", workout: workout("w1", "Push Day"), updated_at: "2026-09-05T09:00:00Z" }];
    routinesList = [routine("r1", "Leg Day")];
    expect(await syncHevy(ctx)).toEqual({ changed: 2, error: null });
    expect(changes.every((c) => c.quiet)).toBe(true);
    expect(workoutRecord(getWorkoutRow("w1")!).values).toMatchObject({ title: "Push Day · Sep 5, 2026", exercises: "Bench Press", exerciseCount: 1, volumeKg: 500 });
    expect(routineRecord(getRoutineRow("r1")!).values).toEqual({ title: "Leg Day", folder: "Strength", exercises: "Squat × 1", exerciseCount: 1 });
    expect(workoutDetail("w1")?.exercises[0]?.sets[0]).toMatchObject({ weightKg: 100, reps: 5, oneRepMax: expect.closeTo(116.67, 1) });

    updateHevySettings({ publishEvents: true });
    events = [{ type: "updated", workout: workout("w2", "Pull Day"), updated_at: "2026-09-06T09:00:00Z" }];
    changes.length = 0;
    await syncHevy(ctx);
    expect(changes).toEqual([{ kind: "workout", key: "w2", deleted: false, quiet: false }]);
    expect(published).toEqual([{ type: "fitness.workout_synced", payload: { workoutId: "rec-workout-w2", title: "Pull Day", url: "/e/rec-workout-w2" } }]);
    expect(getHevySettings().cursor).toBe("2026-09-06T09:00:00Z");
  });

  it("deletes a deleted workout and a routine gone from Hevy", async () => {
    events = [{ type: "updated", workout: workout("w1", "Push Day"), updated_at: "t1" }];
    routinesList = [routine("r1", "Leg Day"), routine("r2", "Arms")];
    await syncHevy(ctx);
    events = [{ type: "deleted", id: "w1", deleted_at: "t2" }];
    routinesList = [routine("r1", "Leg Day")];
    changes.length = 0;
    await syncHevy(ctx);
    expect(changes).toEqual([
      { kind: "workout", key: "w1", deleted: true, quiet: false },
      { kind: "routine", key: "r2", deleted: true, quiet: false },
    ]);
    expect(getWorkoutRow("w1")).toBeUndefined();
  });

  it("alerts once when Hevy keeps failing", async () => {
    updateHevySettings({ publishEvents: true });
    vi.mocked(fetchWorkoutEventsPage).mockRejectedValue(new Error("Hevy down"));
    for (let i = 0; i < 4; i++) await syncHevy(ctx);
    expect(published.map((p) => p.type)).toEqual(["fitness.sync_failing"]);
    expect(getHevySettings()).toMatchObject({ consecutiveFailures: 4, lastError: "Hevy down" });
  });
});

describe("routines", () => {
  it("renames through Hevy with the exercises it has", async () => {
    routinesList = [routine("r1", "Leg Day")];
    await syncHevy(ctx);
    vi.mocked(hevyUpdate).mockImplementation(async (_k, _id, body) => ({ ...routine("r1", (body as { title: string }).title, "u2") }));
    const rec = await hevyConnector.push!.update(ctx, "routine", "r1", { title: "Legs" });
    expect(rec.values.title).toBe("Legs");
    expect(vi.mocked(hevyUpdate).mock.calls[0]![2]).toMatchObject({ title: "Legs", exercises: [{ exercise_template_id: "T1", sets: [{ type: "normal", reps: 5, weight_kg: 80 }] }] });
  });

  it("finds a created routine Hevy didn't echo, without taking an existing one", async () => {
    routinesList = [routine("r1", "Leg Day")];
    await syncHevy(ctx);
    vi.mocked(hevyCreate).mockResolvedValue(null);
    routinesList = [routine("r1", "Leg Day"), routine("r9", "Leg Day")];
    const rec = await createRoutine(ctx, { title: "Leg Day", folderId: 7, exercises: [{ exerciseTemplateId: "T1", supersetId: null, restSeconds: null, sets: [] }] });
    expect(rec.key).toBe("r9");
    expect(vi.mocked(hevyCreate)).toHaveBeenCalledTimes(1);
  });

  it("refuses to edit workouts or delete anything", async () => {
    await expect(hevyConnector.push!.update(ctx, "workout", "w1", { title: "x" })).rejects.toThrow(/Hevy's/);
    await expect(hevyConnector.push!.delete(ctx, "routine", "r1")).rejects.toThrow();
  });
});
