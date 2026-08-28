import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { migrationsDir } from "@congress/test-support";

// Migrations are applied on service boot (createChamberBootstrap calls
// runMigrations before it listens), and the VPS redeploys by fast-forwarding
// main and restarting - so a migration that doesn't apply cleanly takes the
// service down in production with nothing having checked it first. This is
// the cheapest possible guard against that: every service's full migration
// chain, against an empty database, on every test run.
//
// Each entry is an explicit static import rather than a template-literal
// dynamic import so the bundler can resolve them without globbing.
const SERVICES: { name: string; load: () => Promise<DbClientModule> }[] = [
  { name: "congress", load: () => import("../services/congress/src/db/client.js") },
  { name: "chamber-notes", load: () => import("../services/chamber-notes/src/db/client.js") },
  { name: "chamber-calendar", load: () => import("../services/chamber-calendar/src/db/client.js") },
  { name: "chamber-documents", load: () => import("../services/chamber-documents/src/db/client.js") },
  { name: "chamber-tasks", load: () => import("../services/chamber-tasks/src/db/client.js") },
  { name: "chamber-capitol", load: () => import("../services/chamber-capitol/src/db/client.js") },
  { name: "chamber-logs", load: () => import("../services/chamber-logs/src/db/client.js") },
  { name: "chamber-automation", load: () => import("../services/chamber-automation/src/db/client.js") },
  { name: "chamber-map", load: () => import("../services/chamber-map/src/db/client.js") },
  { name: "chamber-deputy", load: () => import("../services/chamber-deputy/src/db/client.js") },
];

interface DbClientModule {
  runMigrations: (migrationsFolder?: string) => void;
  closeDb: () => void;
}

const dir = mkdtempSync(join(tmpdir(), "congress-migrations-"));

describe("migrations", () => {
  it.each(SERVICES)("$name applies cleanly to an empty database", async ({ name, load }) => {
    // Each service opens its SQLite handle at import time from env.DB_PATH,
    // so the path has to move before the module registry is reset and the
    // module re-evaluated.
    process.env.DB_PATH = join(dir, `${name}.sqlite3`);
    vi.resetModules();

    const { runMigrations, closeDb } = await load();
    try {
      runMigrations(migrationsDir(name));
      // Re-running is what actually happens on every boot after the first,
      // so the no-op path matters as much as the initial apply.
      runMigrations(migrationsDir(name));
      expect(statSync(join(dir, `${name}.sqlite3`)).size).toBeGreaterThan(0);
    } finally {
      closeDb();
    }
  });
});
