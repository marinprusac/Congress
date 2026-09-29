import { loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Congress's own env. Each Chamber's config comes from its own .env instead
// (see chambers/loader.ts).
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  CONGRESS_INTERNAL_TOKEN: z.string().min(1, "CONGRESS_INTERNAL_TOKEN must be set"),
  CONGRESS_MASTER_PASSWORD_HASH: z
    .string()
    .length(64, "CONGRESS_MASTER_PASSWORD_HASH must be a 64-char sha256 hex digest"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  DB_PATH: z.string().default("./data/capitol.sqlite3"),
  // Runtime exhibit types: definitions plus one real table per type.
  EXHIBITS_DB_PATH: z.string().default("./data/exhibits.sqlite3"),
  // One-time Notes Chamber -> Note type import (typeEngine/legacy/notesImport.ts).
  NOTES_IMPORT_ENABLED: z.enum(["true", "false"]).default("false"),
  LEGACY_NOTES_DB_PATH: z.string().optional(),
  // Web Push is additive (the in-app notification center works without it),
  // so an unset keypair must never crash boot - sendWebPush no-ops with a
  // one-time warning and GET /congress/push/config reports publicKey: null.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:congress@example.com"),
  // One-time import of the retired Logs Chamber's own SQLite file -
  // see legacyImport.ts. Unset/missing files are simply skipped.
  LEGACY_LOGS_DB_PATH: z.string().default("../chamber-logs/data/logs.sqlite3"),
  // Claude credentials for the AI engine (ai/engine.ts). Both optional, and
  // an empty string counts as unset: without either, `claude` falls back to
  // whatever `claude auth login` left for this OS user. CLAUDE_CODE_OAUTH_TOKEN
  // (from `claude setup-token`) bills the owner's subscription;
  // ANTHROPIC_API_KEY bills metered Console usage instead.
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  // One-time import of Deputy's AI settings row (context prompt, model,
  // budget) from before the engine moved here - see ai/legacyImport.ts.
  LEGACY_DEPUTY_DB_PATH: z.string().default("../chamber-deputy/data/deputy.sqlite3"),
  // Google connector (connectors/google). Unset falls back to the Calendar
  // Chamber's .env, where these lived before the connector existed.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  GOOGLE_OAUTH_FALLBACK_ENV_PATH: z.string().default("../chamber-calendar/.env"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = loadEnv(envSchema);
