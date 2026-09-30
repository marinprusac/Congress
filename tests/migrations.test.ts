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
  { name: "chamber-map", load: () => import("../services/chamber-map/src/db/client.js") },
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

describe("type engine migrations", () => {
  it("apply cleanly to an empty exhibits database, twice", async () => {
    const path = join(dir, "exhibits.sqlite3");
    process.env.EXHIBITS_DB_PATH = path;
    vi.resetModules();
    const { runExhibitsMigrations, closeExhibitsDb } = await import("../services/congress/src/typeEngine/db/client.js");
    try {
      runExhibitsMigrations();
      runExhibitsMigrations();
      expect(statSync(path).size).toBeGreaterThan(0);
    } finally {
      closeExhibitsDb();
    }
  });
});

describe("connector migrations", () => {
  it("google calendar's cache applies cleanly, twice", async () => {
    process.env.CONNECTORS_DATA_DIR = join(dir, "connectors");
    vi.resetModules();
    const { runGcalMigrations, closeGcalDb } = await import("../services/congress/src/connectors/googleCalendar/db/client.js");
    try {
      runGcalMigrations();
      runGcalMigrations();
      expect(statSync(join(dir, "connectors", "google-calendar.sqlite3")).size).toBeGreaterThan(0);
    } finally {
      closeGcalDb();
    }
  });
});
