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
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = loadEnv(envSchema);
