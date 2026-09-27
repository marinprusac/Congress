import "dotenv/config";
import { z } from "zod";

// Congress's own env. Chambers use defineChamberEnv below instead.
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

// A Chamber's config, parsed from the source Congress hands it (its own .env)
// rather than the shared process.env, so two Chambers' keys never collide.
// Reading `env` before `init` throws - except under Vitest, where a Chamber's
// own tests fall back to process.env (set up by @congress/test-support).
export function defineChamberEnv<TSchema extends z.ZodTypeAny>(chamber: string, schema: TSchema) {
  let values: z.infer<TSchema> | null = null;

  function init(source: Record<string, string | undefined>): void {
    values = parseOrThrow(schema, source, `${chamber} Chamber`);
  }

  function current(): z.infer<TSchema> {
    if (values) return values;
    if (process.env.VITEST) return (values = parseOrThrow(schema, process.env, `${chamber} Chamber`));
    throw new Error(`[${chamber}] config read before init`);
  }

  const env = new Proxy({} as z.infer<TSchema>, {
    get: (_target, prop) => (current() as Record<PropertyKey, unknown>)[prop],
  });

  return { env, initEnv: init };
}
