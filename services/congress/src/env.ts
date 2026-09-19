import { loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Capitol's own shape - unrelated to chamberEnvSchema (that's for Chambers
// registering with Capitol; Capitol has no CAPITOL_URL/heartbeat-client
// fields of its own, and adds auth fields no Chamber needs).
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  CONGRESS_INTERNAL_TOKEN: z.string().min(1, "CONGRESS_INTERNAL_TOKEN must be set"),
  CONGRESS_MASTER_PASSWORD_HASH: z
    .string()
    .length(64, "CONGRESS_MASTER_PASSWORD_HASH must be a 64-char sha256 hex digest"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  DB_PATH: z.string().default("./data/capitol.sqlite3"),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  HEARTBEAT_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  // Web Push is additive (the in-app notification center works without it),
  // so an unset keypair must never crash boot - sendWebPush no-ops with a
  // one-time warning and GET /congress/push/config reports publicKey: null.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:congress@example.com"),
  // One-time import of the retired Capitol/Logs Chambers' own SQLite files -
  // see legacyImport.ts. Unset/missing files are simply skipped.
  LEGACY_CAPITOL_DB_PATH: z.string().default("../chamber-capitol/data/capitol.sqlite3"),
  LEGACY_LOGS_DB_PATH: z.string().default("../chamber-logs/data/logs.sqlite3"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = loadEnv(envSchema);
