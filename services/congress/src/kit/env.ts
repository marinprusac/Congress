import "dotenv/config";
import { z } from "zod";

// Congress's own env, parsed from process.env.
export function loadEnv<TSchema extends z.ZodTypeAny>(schema: TSchema): z.infer<TSchema> {
  return parseOrThrow(schema, process.env, "environment");
}

function parseOrThrow<TSchema extends z.ZodTypeAny>(schema: TSchema, source: unknown, label: string): z.infer<TSchema> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    console.error(`Invalid ${label} configuration:`);
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error(`Failed to load ${label} configuration`);
  }
  return parsed.data;
}
