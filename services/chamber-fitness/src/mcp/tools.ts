import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listWorkouts, getWorkout } from "../workouts.js";
import { listHealthMetrics, getLatestHealthMetrics } from "../healthMetrics.js";
import { healthMetricTypeSchema, routineSetInputSchema, routineExerciseInputSchema } from "../types.js";
import { RoutinesError, listRoutines, getRoutine, createRoutine, updateRoutine, listRoutineFolders, searchExerciseTemplates } from "../routines.js";
import { HevyApiError } from "../hevy/client.js";

// A RoutinesError carries a stable, named `code` (e.g. `hevy_not_configured`)
// that's safe to branch on; anything else (almost always a HevyApiError from
// a failed Hevy request) is a one-off failure whose actual cause only shows
// up in its message - collapsing it to a bare "unknown_error" (as this used
// to) turns every write rejection into an unfixable black box for whoever's
// calling the tool. Surface the real status/message instead.
export function routineToolError(err: unknown): { error: string; status?: number; message: string } {
  if (err instanceof RoutinesError) return { error: err.code, message: err.message };
  if (err instanceof HevyApiError) return { error: "hevy_api_error", status: err.status, message: err.message };
  return { error: "unknown_error", message: err instanceof Error ? err.message : String(err) };
}

const routineSetInputZod = z.object({
  type: routineSetInputSchema.shape.type,
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  repRangeStart: z.number().int().nullable(),
  repRangeEnd: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  distanceMeters: z.number().nullable(),
});
const routineExerciseInputZod = z.object({
  exerciseTemplateId: routineExerciseInputSchema.shape.exerciseTemplateId,
  supersetId: z.number().int().nullable(),
  restSeconds: z.number().int().nullable(),
  sets: z.array(routineSetInputZod),
});

// Workouts/health metrics stay read-only here - Hevy, not this Chamber, is
// where a workout is logged, and Apple Health (via the owner's Shortcut) is
// the sole source of health-metric writes. Routines are the one Hevy-backed
// resource this Chamber can write to - see routines.ts. No delete_routine
// tool: Hevy's API has no delete endpoint for routines at all.
export function registerTools(server: McpServer) {
  server.registerTool(
    "list_workouts",
    {
      title: "List Workouts",
      description: "List synced workouts, most recent first.",
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async ({ limit }) => textResult(await listWorkouts(limit))
  );

  server.registerTool(
    "get_workout",
    {
      title: "Get Workout",
      description: "Get a single workout's full exercise/set detail by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const workout = await getWorkout(id);
      if (!workout) return textResult({ error: "not_found", id });
      return textResult(workout);
    }
  );

  server.registerTool(
    "list_health_metrics",
    {
      title: "List Health Metrics",
      description: "List recorded Apple Health samples, optionally filtered by type, most recent first.",
      inputSchema: {
        metricType: healthMetricTypeSchema.optional(),
        since: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ metricType, since, limit }) =>
      textResult(await listHealthMetrics({ metricType, since: since ? new Date(since) : undefined, limit }))
  );

  server.registerTool(
    "get_latest_health_metrics",
    {
      title: "Get Latest Health Metrics",
      description: "Get the most recent value recorded for each tracked Apple Health metric type (weight, VO2max, active/resting energy, sleep).",
      inputSchema: {},
    },
    async () => textResult(await getLatestHealthMetrics())
  );

  server.registerTool(
    "list_routines",
    {
      title: "List Routines",
      description: "List Hevy workout routines (templates), live from Hevy.",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await listRoutines());
      } catch (err) {
        return textResult(routineToolError(err));
      }
    }
  );

  server.registerTool(
    "get_routine",
    {
      title: "Get Routine",
      description: "Get a single Hevy routine's full exercise/set detail by its Hevy id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const routine = await getRoutine(id);
        if (!routine) return textResult({ error: "not_found", id });
        return textResult(routine);
      } catch (err) {
        return textResult(routineToolError(err));
      }
    }
  );

  server.registerTool(
    "search_exercise_templates",
    {
      title: "Search Exercise Templates",
      description:
        "Search Hevy's exercise library by name to find the exerciseTemplateId values create_routine/update_routine need - an exercise can't be added to a routine by guessing an id. Empty query returns the full catalog.",
      inputSchema: { query: z.string().optional() },
    },
    async ({ query }) => {
      try {
        return textResult(await searchExerciseTemplates(query ?? ""));
      } catch (err) {
        return textResult(routineToolError(err));
      }
    }
  );

  server.registerTool(
    "list_routine_folders",
    {
      title: "List Routine Folders",
      description: "List Hevy routine folders - use to find a valid folderId for create_routine (optional; routines can also have no folder).",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await listRoutineFolders());
      } catch (err) {
        return textResult(routineToolError(err));
      }
    }
  );

  server.registerTool(
    "create_routine",
    {
      title: "Create Routine",
      description: "Create a new Hevy workout routine (template). Hevy has no delete endpoint - creating a routine is permanent.",
      inputSchema: {
        title: z.string().min(1),
        folderId: z.number().int().nullable(),
        exercises: z.array(routineExerciseInputZod),
      },
    },
    async (input) => {
      try {
        return textResult(await createRoutine(input));
      } catch (err) {
        return textResult(routineToolError(err));
      }
    }
  );

  server.registerTool(
    "update_routine",
    {
      title: "Update Routine",
      description: "Replace a routine's title and full exercise/set list (Hevy's update is a full replace, not a partial patch - send every exercise/set, not just the changed ones).",
      inputSchema: {
        id: z.string(),
        title: z.string().min(1),
        exercises: z.array(routineExerciseInputZod),
      },
    },
    async ({ id, ...input }) => {
      try {
        const routine = await updateRoutine(id, input);
        if (!routine) return textResult({ error: "not_found", id });
        return textResult(routine);
      } catch (err) {
        return textResult(routineToolError(err));
      }
    }
  );
}
