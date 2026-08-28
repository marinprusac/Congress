import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listWorkouts, getWorkout } from "../workouts.js";

// Read-only tools only - Hevy, not this Chamber, is where a workout is
// created or edited, so there are no write tools here (unlike the
// scaffold's generic create_item/update_item).
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
}
