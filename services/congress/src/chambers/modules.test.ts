import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { listChambers } from "../registry.js";
import { loadChambers, stopChambers } from "./loader.js";
import { CHAMBER_MODULES } from "./modules.js";

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  await loadChambers(CHAMBER_MODULES, { envFor: () => ({}) });
});

afterAll(() => stopChambers());

describe("Chambers", () => {
  it("has none left: every one became a type, a connector and views", () => {
    expect(CHAMBER_MODULES).toEqual([]);
    expect(listChambers().filter((c) => c.status === "active")).toEqual([]);
  });
});
