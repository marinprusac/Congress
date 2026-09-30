import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../../kit/mcp.js";
import type { ConnectorContext } from "../contract.js";
import { getRecord } from "../../typeEngine/records.js";
import { listFolders } from "./cache.js";
import { createRoutine, searchExerciseTemplates, updateRoutine } from "./routines.js";
import { routineExerciseInputSchema } from "./types.js";

async function safe(fn: () => Promise<unknown>) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    return mcpTextResult({ error: (err as Error).message });
  }
}

const exercisesInput = z.array(routineExerciseInputSchema).min(1).describe("Every exercise, in order (exerciseTemplateId from hevy_search_exercise_templates)");

// Hevy tools that aren't the generic routine/workout record ones.
export function registerHevyTools(ctx: ConnectorContext, server: McpServer): void {
  server.registerTool(
    "hevy_search_exercise_templates",
    { title: "Search Hevy exercises", description: "Hevy exercise templates by name (their ids go into a routine's exercises).", inputSchema: { query: z.string() } },
    ({ query }) => safe(async () => (await searchExerciseTemplates(query)).slice(0, 30))
  );

  server.registerTool(
    "hevy_list_routine_folders",
    { title: "List Hevy routine folders", description: "Routine folders (a routine's folder is set when it's created and can't change).", inputSchema: {} },
    () => safe(async () => listFolders())
  );

  server.registerTool(
    "hevy_create_routine",
    {
      title: "Create Hevy routine",
      description: "Create a routine in Hevy (it becomes a Routine record). Hevy can't delete routines, so check list_routines first and never retry blindly.",
      inputSchema: { title: z.string().min(1), folderId: z.number().int().nullable(), exercises: exercisesInput },
    },
    (input) =>
      safe(async () => {
        const rec = await createRoutine(ctx, input);
        return { recordId: ctx.records.idFor("routine", rec.key), ...rec.values };
      })
  );

  server.registerTool(
    "hevy_set_routine_exercises",
    {
      title: "Set a routine's exercises",
      description: "Replace a Routine record's exercises in Hevy (read_routine shows the current ones). Rename it with update_routine.",
      inputSchema: { id: z.string().min(1).describe("The Routine record's id"), exercises: exercisesInput },
    },
    ({ id, exercises }) =>
      safe(async () => {
        const key = getRecord(id)?.provenance?.key;
        if (!key) throw new Error(`No Hevy routine behind ${id}`);
        return (await updateRoutine(ctx, key, { exercises })).values;
      })
  );
}
