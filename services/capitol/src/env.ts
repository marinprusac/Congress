import "dotenv/config";
import { z } from "zod";

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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Failed to load environment configuration");
}

export const env = parsed.data;
