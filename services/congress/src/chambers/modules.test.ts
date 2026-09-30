import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { listChambers } from "../registry.js";
import { chamberFetch } from "./runtime.js";
import { loadChambers, stopChambers } from "./loader.js";
import { CHAMBER_MODULES } from "./modules.js";

// Every real Chamber, started together in this one process - each with its
// own SQLite file, the way Congress runs them in production.
const dataDir = mkdtempSync(join(tmpdir(), "congress-chambers-"));

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  // Pollers point at nothing reachable; their failures are logged, not fatal.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await loadChambers(CHAMBER_MODULES, {
    envFor: (m) => ({
      DB_PATH: join(dataDir, `${m.manifest.name}.sqlite3`),
      FILES_DIR: join(dataDir, "documents-files"),
      TRACCAR_URL: "http://127.0.0.1:9",
      TRACCAR_TOKEN: "token",
      TRACCAR_DEVICE_ID: "1",
    }),
  });
});

afterAll(async () => {
  await stopChambers();
  vi.restoreAllMocks();
});

describe("every Chamber in one process", () => {
  it("starts all seven", () => {
    const active = listChambers().filter((c) => c.status === "active").map((c) => c.name);
    expect(active.sort()).toEqual(["calendar", "documents", "fitness", "mail", "map", "tasks", "whatsapp"]);
  });

  it("keeps WhatsApp out of Search and the feed", async () => {
    expect((await chamberFetch("whatsapp", "/exhibits/search?q=")).status).toBe(404);
    expect((await chamberFetch("whatsapp", "/feed")).status).toBe(404);
  });

  it.each(["calendar", "documents", "tasks", "map", "fitness", "mail"])("serves %s's exhibit search in-process", async (name) => {
    const res = await chamberFetch(name, "/exhibits/search?q=");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ results: expect.any(Array) });
  });

  it("keeps each Chamber's data in its own file", async () => {
    const created = await chamberFetch("tasks", "/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Only in tasks" }),
    });
    expect(created.status).toBe(201);
    const documents = (await (await chamberFetch("documents", "/exhibits/search?q=Only")).json()) as { results: unknown[] };
    expect(documents.results).toEqual([]);
    const tasks = (await (await chamberFetch("tasks", "/exhibits/search?q=Only")).json()) as { results: { name: string }[] };
    expect(tasks.results.map((r) => r.name)).toEqual(["Only in tasks"]);
  });
});
