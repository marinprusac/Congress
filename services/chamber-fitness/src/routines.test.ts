import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { settings } from "./db/schema.js";

vi.mock("./hevy/client.js", async () => {
  const actual = await vi.importActual<typeof import("./hevy/client.js")>("./hevy/client.js");
  return {
    ...actual,
    fetchRoutinesPage: vi.fn(),
    fetchRoutine: vi.fn(),
    createRoutine: vi.fn(),
    updateRoutine: vi.fn(),
  };
});

import { fetchRoutinesPage, fetchRoutine, createRoutine as hevyCreateRoutine } from "./hevy/client.js";
import { RoutinesError, listRoutines, getRoutine, createRoutine } from "./routines.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => {
  db.run(sql`delete from settings`);
  db.insert(settings).values({ id: 1, hevyApiKey: "fake-key" }).run();
  vi.mocked(fetchRoutinesPage).mockReset();
  vi.mocked(fetchRoutine).mockReset();
  vi.mocked(hevyCreateRoutine).mockReset();
});

function fakeRoutine(id: string, title: string) {
  return { id, title, folder_id: null, updated_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", exercises: [] };
}

describe("createRoutine", () => {
  it("returns the routine directly when Hevy echoes it back", async () => {
    vi.mocked(hevyCreateRoutine).mockResolvedValue(fakeRoutine("r1", "Push Day"));

    const routine = await createRoutine({ title: "Push Day", folderId: null, exercises: [] });

    expect(routine.id).toBe("r1");
  });

  it("recovers the created routine by title when Hevy's 201 body is empty", async () => {
    vi.mocked(hevyCreateRoutine).mockResolvedValue(null);
    vi.mocked(fetchRoutinesPage).mockResolvedValue({ routines: [fakeRoutine("r2", "Leg Day")], pageCount: 1 });
    vi.mocked(fetchRoutine).mockResolvedValue(fakeRoutine("r2", "Leg Day"));

    const routine = await createRoutine({ title: "Leg Day", folderId: null, exercises: [] });

    expect(routine.id).toBe("r2");
  });

  it("throws routine_created_but_not_found rather than retrying when no title match exists", async () => {
    vi.mocked(hevyCreateRoutine).mockResolvedValue(null);
    vi.mocked(fetchRoutinesPage).mockResolvedValue({ routines: [], pageCount: 1 });

    await expect(createRoutine({ title: "Leg Day", folderId: null, exercises: [] })).rejects.toMatchObject({
      code: "routine_created_but_not_found",
    });
    expect(hevyCreateRoutine).toHaveBeenCalledTimes(1);
  });
});

describe("requireApiKey (via listRoutines/getRoutine)", () => {
  it("throws hevy_not_configured when no API key is set", async () => {
    db.run(sql`delete from settings`);

    await expect(listRoutines()).rejects.toMatchObject({ code: "hevy_not_configured" });
  });

  it("returns null for a 404 from Hevy rather than throwing", async () => {
    const { HevyApiError } = await vi.importActual<typeof import("./hevy/client.js")>("./hevy/client.js");
    vi.mocked(fetchRoutine).mockRejectedValue(new HevyApiError("not found", 404));

    expect(await getRoutine("missing")).toBeNull();
  });
});

describe("RoutinesError", () => {
  it("carries a distinguishable code", () => {
    const err = new RoutinesError("hevy_not_configured");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("hevy_not_configured");
  });
});
