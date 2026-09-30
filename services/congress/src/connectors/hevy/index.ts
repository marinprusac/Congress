import { ConnectorRefusedError, defineConnector } from "../contract.js";
import { closeHevyDb, runHevyMigrations } from "./db/client.js";
import { getHevySettings, getRoutineRow, getWorkoutRow, listRoutineRows, listWorkoutRows, routineExercises, routineRecord, updateHevySettings, workoutDetail, workoutRecord } from "./cache.js";
import { syncHevy } from "./sync.js";
import { updateRoutine } from "./routines.js";
import { hevyPanelRoutes } from "./routes.js";
import { registerHevyTools } from "./tools.js";
import { legacyFitnessSettings } from "../fitnessLegacy.js";

const refuse = (why: string) => Promise.reject(new ConnectorRefusedError(why));

// Hevy: workouts (read-only) and routines (renames and exercises go back to Hevy).
export const hevyConnector = defineConnector({
  name: "hevy",
  label: "Hevy",
  source: [
    {
      kind: "workout",
      label: "Workout",
      fields: [
        { slug: "title", kind: "text", label: "Title" },
        { slug: "start", kind: "datetime", label: "Start" },
        { slug: "end", kind: "datetime", label: "End" },
        { slug: "exercises", kind: "text", label: "Exercises" },
        { slug: "exerciseCount", kind: "number", label: "Exercise count" },
        { slug: "volumeKg", kind: "number", label: "Volume (kg)" },
      ],
      facts: [],
    },
    {
      kind: "routine",
      label: "Routine",
      fields: [
        { slug: "title", kind: "text", label: "Title" },
        { slug: "folder", kind: "text", label: "Folder" },
        { slug: "exercises", kind: "text", label: "Exercises" },
        { slug: "exerciseCount", kind: "number", label: "Exercise count" },
      ],
      facts: [],
    },
  ],
  events: [
    { type: "fitness.workout_synced", label: "Workout synced", description: "A new workout arrived from Hevy.", payloadFields: { workoutId: { type: "string" }, title: { type: "string" }, url: { type: "string" } } },
    {
      type: "fitness.sync_failing",
      label: "Hevy sync failing",
      description: "Hevy failed three syncs in a row.",
      payloadFields: { consecutiveFailures: { type: "number" }, lastError: { type: "string" } },
    },
  ],
  start() {
    runHevyMigrations();
    // Until the cutover the key lives in the Fitness Chamber: borrow it.
    if (!getHevySettings().apiKey) {
      const legacy = legacyFitnessSettings();
      if (legacy?.hevyApiKey) updateHevySettings({ apiKey: legacy.hevyApiKey });
    }
  },
  stop: () => closeHevyDb(),
  sync: (ctx) => syncHevy(ctx),
  intervalMs: () => 15 * 60_000,
  read: {
    get(kind, key) {
      if (kind === "workout") {
        const row = getWorkoutRow(key);
        return row ? workoutRecord(row) : null;
      }
      const row = kind === "routine" ? getRoutineRow(key) : undefined;
      return row ? routineRecord(row) : null;
    },
    list(kind, opts) {
      if (kind === "workout") return listWorkoutRows(opts).map(workoutRecord);
      return kind === "routine" ? listRoutineRows().map(routineRecord) : [];
    },
    async detail(_ctx, kind, key) {
      if (kind === "workout") return workoutDetail(key);
      const row = kind === "routine" ? getRoutineRow(key) : undefined;
      return row ? { key, title: row.title, folderId: row.folderId, exercises: routineExercises(row) } : null;
    },
  },
  push: {
    create: () => refuse("New routines are made in the routine editor"),
    async update(ctx, kind, key, patch) {
      if (kind !== "routine") throw new ConnectorRefusedError("Workouts are Hevy's; edit them there");
      if (typeof patch.title !== "string" || !patch.title.trim()) throw new ConnectorRefusedError("A routine needs a title");
      return updateRoutine(ctx, key, { title: patch.title.trim() });
    },
    delete: () => refuse("Hevy can't delete routines or workouts from here"),
    act: () => refuse("No Hevy actions"),
  },
  routes: (ctx) => hevyPanelRoutes(ctx),
  tools: (ctx, server) => registerHevyTools(ctx, server),
});
