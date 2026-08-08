import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8011),
  HOST: z.string().default("127.0.0.1"),
  CONGRESS_INTERNAL_TOKEN: z.string().min(1, "CONGRESS_INTERNAL_TOKEN must be set"),
  CAPITOL_URL: z.string().url().default("http://127.0.0.1:3000"),
  DB_PATH: z.string().default("./data/notes.sqlite3"),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Failed to load environment configuration");
}

export const env = parsed.data;
