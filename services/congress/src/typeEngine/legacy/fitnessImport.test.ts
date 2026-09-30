import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir } from "@congress/test-support";
import { getChamber, registerChamber } from "../../registry.js";
import { db, runMigrations } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { startTypeEngine } from "../index.js";
import { createRecord, manualRefs } from "../records.js";
import { resolveLegacyAlias } from "../aliases.js";
import { getTypeBySlug } from "../store.js";
import { runHevyMigrations } from "../../connectors/hevy/db/client.js";
import { runHealthMigrations } from "../../connectors/health/db/client.js";
import { getHevySettings } from "../../connectors/hevy/cache.js";
import { countMetrics, getHealthSettings } from "../../connectors/health/store.js";
import { importLegacyFitness } from "./fitnessImport.js";

const bound = (type: string, binding: string, key: string, values: Record<string, unknown>) =>
  createRecord(type, values, { source: { binding, key }, fromSource: true }).id;
let from = "";
let push = "";
let legs = "";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runHevyMigrations();
  runHealthMigrations();
  startTypeEngine();
  push = bound("workout", "bnd_hevy_workout", "hevy-a", { title: "Push Day · Sep 5, 2026" });
  legs = bound("routine", "bnd_hevy_routine", "r1", { title: "Leg Day" });

  from = join(mkdtempSync(join(tmpdir(), "fitness-import-")), "fitness.sqlite3");
  const fit = new Database(from);
  fit.exec(`
    CREATE TABLE workouts (id INTEGER PRIMARY KEY, hevy_id TEXT);
    CREATE TABLE workout_refs (id INTEGER PRIMARY KEY, workout_id INTEGER, target_exhibit_id TEXT);
    CREATE TABLE health_metrics (id INTEGER PRIMARY KEY, metric_type TEXT, value REAL, unit TEXT, start_date INTEGER, end_date INTEGER, source_name TEXT, created_at INTEGER);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, hevy_api_key TEXT, health_ingest_token TEXT);
  `);
  fit.prepare("INSERT INTO workouts VALUES (3, 'hevy-a'), (4, 'hevy-gone')").run();
  fit.prepare("INSERT INTO workout_refs (workout_id, target_exhibit_id) VALUES (3, 'routine-r1')").run();
  const m = fit.prepare("INSERT INTO health_metrics (metric_type, value, unit, start_date, end_date, source_name, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0)");
  m.run("weight", 80, "kg", 1_000, 1_000);
  m.run("vo2Max", 41, "ml/(kg·min)", 2_000, 2_000);
  fit.prepare("INSERT INTO settings VALUES (1, 'hevy-key', 'ingest-token')").run();
  fit.close();

  registerChamber(makeManifest("fitness"));
  db.insert(exhibitRefs).values({ sourceId: "note-1", sourceChamber: "notes", targetId: "workout-3" }).run();
  db.insert(exhibitCache).values({ id: "workout-3", chamber: "fitness", type: "workout", name: "Push Day", url: "/workouts/3", updatedAt: new Date() }).run();
});

describe("the Fitness cutover", () => {
  it("keeps old ids working, moves links and health history, and turns the connectors on", () => {
    const stats = importLegacyFitness({ from });
    expect(stats).toEqual({ workoutAliases: 1, workoutsMissing: 1, routineAliases: 1, refs: 1, refsMissing: 0, exhibitRefsRewritten: 1, healthSamples: 2 });
    expect(resolveLegacyAlias("fitness", "workout-3")).toBe(push);
    expect(resolveLegacyAlias("fitness", "routine-r1")).toBe(legs);
    expect(manualRefs(push)).toEqual([legs]);
    expect(db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, "note-1")).get()?.targetId).toBe(push);
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.chamber, "fitness")).all()).toEqual([]);
    expect(countMetrics()).toBe(2);
    expect(getHevySettings()).toMatchObject({ apiKey: "hevy-key", publishEvents: true });
    expect(getHealthSettings()).toMatchObject({ ingestToken: "ingest-token", publishEvents: true });
    expect(getChamber("fitness")).toBeNull();
    expect(getTypeBySlug("workout")!.definition.hidden).toBe(false);
  });

  it("runs once", () => {
    expect(importLegacyFitness({ from }).skipped).toBe("already_ran");
  });
});
