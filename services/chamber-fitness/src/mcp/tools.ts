import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listWorkouts, getWorkout } from "../workouts.js";
import { listHealthMetrics, getLatestHealthMetrics } from "../healthMetrics.js";
import { healthMetricTypeSchema } from "../types.js";

// Read-only tools only - Hevy, not this Chamber, is where a workout is
// created or edited, and Apple Health (via the owner's Shortcut) is the
// sole source of health-metric writes, so there are no write tools here
// (unlike the scaffold's generic create_item/update_item).
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
}
