import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { eq, like, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { forgetChamber } from "../../registry.js";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { imports, recordRefs } from "../db/schema.js";
import { getTypeByPremadeKey, type StoredType } from "../store.js";
import { syncRecordExhibit } from "../records.js";
import { addLegacyAlias, aliasesForIds } from "../aliases.js";
import { quoteIdent } from "../ddl.js";
import { bindingId } from "../operations.js";
import { fitnessDbPath } from "../../connectors/fitnessLegacy.js";
import { getHevySettings, updateHevySettings } from "../../connectors/hevy/cache.js";
import { getHealthSettings, updateHealthSettings } from "../../connectors/health/store.js";
import { healthDb } from "../../connectors/health/db/client.js";
import { healthMetrics } from "../../connectors/health/db/schema.js";

// One-time cutover of the Fitness Chamber into Workout/Routine records and
// the health connector, read-only on its DB. Delete once it has run in production.

const KEY = "fitness-v1";
const CHAMBER = "fitness";

export interface FitnessImportStats {
  skipped?: "already_ran" | "no_source" | "no_type";
  workoutAliases: number;
  workoutsMissing: number;
  routineAliases: number;
  refs: number;
  refsMissing: number;
  exhibitRefsRewritten: number;
  healthSamples: number;
}

function boundKeys(t: StoredType, connector: string, kind: string): Map<string, string> {
  const rows = exhibitsSqlite
    .prepare(`SELECT "id", "source_key" FROM ${quoteIdent(t.definition.tableName)} WHERE "source_binding" = ?`)
    .all(bindingId(connector, kind)) as { id: string; source_key: string }[];
  return new Map(rows.map((r) => [r.source_key, r.id]));
}

export function importLegacyFitness(opts: { from?: string } = {}): FitnessImportStats {
  const stats: FitnessImportStats = { workoutAliases: 0, workoutsMissing: 0, routineAliases: 0, refs: 0, refsMissing: 0, exhibitRefsRewritten: 0, healthSamples: 0 };
  if (exhibitsDb.select().from(imports).where(eq(imports.key, KEY)).get()) return { ...stats, skipped: "already_ran" };
  const from = opts.from ?? fitnessDbPath();
  if (!existsSync(from)) return { ...stats, skipped: "no_source" };
  const workoutType = getTypeByPremadeKey("workout");
  const routineType = getTypeByPremadeKey("routine");
  if (!workoutType || !routineType) return { ...stats, skipped: "no_type" };

  const source = new Database(from, { readonly: true, fileMustExist: true });
  const workouts = source.prepare("SELECT id, hevy_id FROM workouts").all() as { id: number; hevy_id: string }[];
  const refs = source.prepare("SELECT workout_id, target_exhibit_id FROM workout_refs ORDER BY id").all() as { workout_id: number; target_exhibit_id: string }[];
  const samples = source.prepare("SELECT * FROM health_metrics").all() as {
    metric_type: string;
    value: number;
    unit: string;
    start_date: number;
    end_date: number;
    source_name: string | null;
    created_at: number;
  }[];
  const settingsRow = source.prepare("SELECT hevy_api_key, health_ingest_token FROM settings WHERE id = 1").get() as
    | { hevy_api_key: string | null; health_ingest_token: string | null }
    | undefined;
  source.close();

  // 1. Old exhibit ids: workout-<Chamber row id> (by its Hevy id), routine-<Hevy id>.
  const idFor = new Map<string, string>();
  const workoutRecords = boundKeys(workoutType, "hevy", "workout");
  for (const w of workouts) {
    const id = workoutRecords.get(w.hevy_id);
    if (id) idFor.set(`workout-${w.id}`, id);
    else stats.workoutsMissing++;
  }
  stats.workoutAliases = idFor.size;
  for (const [key, id] of boundKeys(routineType, "hevy", "routine")) idFor.set(`routine-${key}`, id);
  stats.routineAliases = idFor.size - stats.workoutAliases;

  exhibitsSqlite.transaction(() => {
    for (const [legacy, id] of idFor) addLegacyAlias(CHAMBER, legacy, id);
    // 2. Manual links from a workout's Connections panel.
    for (const ref of refs) {
      const recordId = idFor.get(`workout-${ref.workout_id}`);
      if (!recordId) {
        stats.refsMissing++;
        continue;
      }
      const target = idFor.get(ref.target_exhibit_id) ?? aliasesForIds([ref.target_exhibit_id]).get(ref.target_exhibit_id) ?? ref.target_exhibit_id;
      exhibitsDb.insert(recordRefs).values({ recordId, targetExhibitId: target, createdAt: new Date() }).onConflictDoNothing().run();
      stats.refs++;
    }
  })();

  // 3. Congress's DB: links to old ids and the Chamber's exhibit cache.
  db.transaction((tx) => {
    tx.delete(exhibitRefs).where(eq(exhibitRefs.sourceChamber, CHAMBER)).run();
    for (const r of tx.select().from(exhibitRefs).where(or(like(exhibitRefs.targetId, "workout-%"), like(exhibitRefs.targetId, "routine-%"))).all()) {
      const id = idFor.get(r.targetId);
      if (!id) continue;
      tx.update(exhibitRefs).set({ targetId: id }).where(eq(exhibitRefs.id, r.id)).run();
      stats.exhibitRefsRewritten++;
    }
    tx.delete(exhibitCache).where(eq(exhibitCache.chamber, CHAMBER)).run();
  });

  // 4. Apple Health history, then the connectors take over what the Chamber did.
  healthDb.transaction((tx) => {
    for (const s of samples) {
      const res = tx
        .insert(healthMetrics)
        .values({
          metricType: s.metric_type,
          value: s.value,
          unit: s.unit,
          startDate: new Date(s.start_date),
          endDate: new Date(s.end_date),
          sourceName: s.source_name,
          createdAt: new Date(s.created_at),
        })
        .onConflictDoNothing()
        .run();
      stats.healthSamples += res.changes;
    }
  });
  if (!getHevySettings().apiKey && settingsRow?.hevy_api_key) updateHevySettings({ apiKey: settingsRow.hevy_api_key });
  if (!getHealthSettings().ingestToken && settingsRow?.health_ingest_token) updateHealthSettings({ ingestToken: settingsRow.health_ingest_token });
  updateHevySettings({ publishEvents: true });
  updateHealthSettings({ publishEvents: true });

  forgetChamber(CHAMBER);
  for (const [legacy, id] of idFor) syncRecordExhibit(legacy.startsWith("workout-") ? workoutType : routineType, id);
  exhibitsDb.insert(imports).values({ key: KEY, ranAt: new Date(), statsJson: JSON.stringify(stats) }).onConflictDoNothing().run();
  return stats;
}
