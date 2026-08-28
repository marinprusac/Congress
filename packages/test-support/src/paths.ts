import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// packages/test-support/src -> repo root
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// createDb's runMigrations defaults to "./src/db/migrations", which is
// resolved against process.cwd() - the repo root under Vitest, not the
// service directory. Every test that migrates has to pass an absolute path
// instead, and this is the one place that builds it.
export function migrationsDir(service: string): string {
  return join(repoRoot, "services", service, "src", "db", "migrations");
}
