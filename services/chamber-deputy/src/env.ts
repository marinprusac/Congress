import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8018),
    DB_PATH: z.string().default("./data/deputy.sqlite3"),
    // Both optional, and not .min(1) - an empty string (the seeded .env's
    // default, same "leave it blank" convention as every other Chamber's
    // placeholder secrets) is treated as "not set" by engine.ts's own
    // truthiness check, not rejected at load time.
    //
    // Deputy defaults to the owner's own Claude subscription rather than
    // metered API billing (docs/deputy-chamber-plan.md §5). The supported
    // way to do that for an unattended service is CLAUDE_CODE_OAUTH_TOKEN -
    // a one-year token from `claude setup-token`, generated on any machine
    // with a browser (not necessarily this one) and pasted here; it's the
    // officially documented mechanism for "script/CI, no interactive login
    // available". If neither this nor ANTHROPIC_API_KEY is set, `claude`
    // falls back to whatever ambient credential store `claude auth login`
    // left for this OS user (what local dev typically relies on instead).
    // Set ANTHROPIC_API_KEY if isolated, metered Console billing is
    // preferred over subscription usage. Everything else Deputy needs
    // (checkup interval, chat idle window, budget cap, model) is a
    // Settings-page field (settings.ts), not an env var, so it's cheap to
    // change without a redeploy.
    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  })
);
