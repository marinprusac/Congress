import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

// No Claude credentials here any more - Deputy runs its directives through
// Congress's own AI (POST /congress/ai/run), so ANTHROPIC_API_KEY /
// CLAUDE_CODE_OAUTH_TOKEN belong in Congress's env (services/congress/.env).
export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8018),
    DB_PATH: z.string().default("./data/deputy.sqlite3"),
  })
);
