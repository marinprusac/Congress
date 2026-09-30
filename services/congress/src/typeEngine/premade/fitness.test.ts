import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../connectors/hevy/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connectors/hevy/client.js")>()),
  fetchWorkoutEventsPage: vi.fn(async () => ({
    events: [
      {
        type: "updated",
        updated_at: "t1",
        workout: { id: "w1", title: "Push Day", start_time: "2026-09-05T08:00:00Z", end_time: "2026-09-05T09:00:00Z", exercises: [{ title: "Bench Press", sets: [{ weight_kg: 60, reps: 10 }] }] },
      },
    ],
    pageCount: 1,
  })),
  fetchRoutinesPage: vi.fn(async () => ({
    routines: [{ id: "r1", title: "Leg Day", folder_id: null, updated_at: "u1", exercises: [{ exercise_template_id: "T1", title: "Squat", sets: [{ type: "normal", reps: 5 }] }] }],
    pageCount: 1,
  })),
  fetchRoutineFolders: vi.fn(async () => ({ folders: [], pageCount: 1 })),
}));

import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { onEventPublished, type PublishedEvent } from "../../events.js";
import { startTypeEngine } from "../index.js";
import { getTypeBySlug } from "../store.js";
import { createRecord, listRecords, RecordLockedError } from "../records.js";
import { liveDetail, startBindings, stopBindings, withBinding } from "../bindings/runtime.js";
import { startConnectors, stopConnectors } from "../../connectors/registry.js";
import { hevyConnector } from "../../connectors/hevy/index.js";
import { runHevyMigrations } from "../../connectors/hevy/db/client.js";
import { updateHevySettings } from "../../connectors/hevy/cache.js";

const events: PublishedEvent[] = [];
onEventPublished((e) => events.push(e));

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  runHevyMigrations();
  updateHevySettings({ apiKey: "key" });
  startBindings();
  await startConnectors([hevyConnector]);
  await vi.waitFor(() => expect(listRecords("routine")).toHaveLength(1));
});

afterAll(async () => {
  stopBindings();
  await stopConnectors();
});

describe("the Workout and Routine premades bound to Hevy", () => {
  it("mirror Hevy quietly, hidden until the cutover", () => {
    expect(getTypeBySlug("workout")!.definition.hidden).toBe(true);
    const [w] = listRecords("workout");
    expect(w!.values).toMatchObject({ exercises: "Bench Press", exercise_count: 1, volume_kg: 600, start: "2026-09-05T08:00:00.000Z" });
    expect(String(w!.values.title)).toMatch(/^Push Day · Sep 5, 2026$/);
    expect(listRecords("routine")[0]!.values).toMatchObject({ title: "Leg Day", exercises: "Squat × 1" });
    expect(events.filter((e) => /^(workout|routine)\./.test(e.type))).toEqual([]);
  });

  it("only come from Hevy, with their sets read live", async () => {
    expect(() => createRecord("workout", { title: "Mine" }, { actor: "me" })).toThrow(RecordLockedError);
    const w = listRecords("workout")[0]!;
    expect(withBinding(w).binding).toMatchObject({ detail: true, locked: expect.arrayContaining(["title", "start"]) });
    expect(await liveDetail(w.id)).toMatchObject({ exercises: [{ name: "Bench Press", sets: [{ weightKg: 60, reps: 10, oneRepMax: 80 }] }] });
  });
});
