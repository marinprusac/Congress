import { loadEnv } from "./kit/env.js";
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
  // Files of `file` fields, one per upload, named by file id.
  EXHIBIT_FILES_DIR: z.string().default("./data/files"),
  // Each connector's own cache DB (connectors/<name>).
  CONNECTORS_DATA_DIR: z.string().default("./data/connectors"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  // Day boundaries for `date` fields when AI settings have no time zone.
  OWNER_TIMEZONE: z
    .string()
    .default("Europe/Zagreb")
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "OWNER_TIMEZONE must be an IANA time zone"),
  // Web Push is additive (the in-app notification center works without it),
  // so an unset keypair must never crash boot - sendWebPush no-ops with a
  // one-time warning and GET /congress/push/config reports publicKey: null.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:congress@example.com"),
  // Claude credentials for the AI engine (ai/engine.ts). Both optional, and
  // an empty string counts as unset: without either, `claude` falls back to
  // whatever `claude auth login` left for this OS user. CLAUDE_CODE_OAUTH_TOKEN
  // (from `claude setup-token`) bills the owner's subscription;
  // ANTHROPIC_API_KEY bills metered Console usage instead.
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  // Search API key for the AI's internet mode (mcp/webTools.ts, Brave Search). Unset: fetch_url only.
  WEB_SEARCH_API_KEY: z.string().optional(),
  // Google connector (connectors/google). Unset falls back to the Calendar
  // Chamber's .env, where these lived before the connector existed.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  // Where the credentials lived first; the retired Calendar Chamber's .env stays on the server.
  GOOGLE_OAUTH_FALLBACK_ENV_PATH: z.string().default("../chamber-calendar/.env"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = loadEnv(envSchema);
