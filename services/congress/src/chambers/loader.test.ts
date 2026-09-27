import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getCongressHost } from "@congress/chamber-kit";
import { makeFakeChamberModule, migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { getChamber } from "../registry.js";
import { loadChamber, loadChambers, readChamberEnv, stopChambers } from "./loader.js";
import { getModule, listModules } from "./runtime.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

afterEach(async () => {
  await stopChambers();
  vi.restoreAllMocks();
});

const noEnv = { envFor: () => ({}) };

describe("loadChambers", () => {
  it("starts every chamber, registers it active with its /mcp/<name> url, and installs the host", async () => {
    await loadChambers([makeFakeChamberModule("one"), makeFakeChamberModule("two")], noEnv);
    expect(getChamber("one")).toMatchObject({ status: "active", mcpUrl: "http://127.0.0.1:3000/mcp/one" });
    expect(getModule("two")).not.toBeNull();
    expect(getCongressHost()).not.toBeNull();
  });

  it("marks a chamber whose start() throws offline and keeps booting the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = vi.fn();
    const broken = makeFakeChamberModule("broken-start", {
      start: () => {
        throw new Error("TRACCAR_URL must be set");
      },
      stop,
    });
    await loadChambers([broken, makeFakeChamberModule("after-broken")], noEnv);

    expect(getChamber("broken-start")?.status).toBe("offline");
    expect(getModule("broken-start")).toBeNull();
    // Whatever it half-started (timers, an open DB) is torn down again.
    expect(stop).toHaveBeenCalled();
    expect(getChamber("after-broken")?.status).toBe("active");
  });

  it("marks a chamber whose config fails validation offline", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = makeFakeChamberModule("bad-config");
    fake.initEnv = () => {
      throw new Error("Failed to load bad-config Chamber configuration");
    };
    expect(await loadChamber(fake, noEnv)).toBe(false);
    expect(getChamber("bad-config")?.status).toBe("offline");
  });

  it("refuses a chamber named after one of the shell's own routes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const start = vi.fn();
    expect(await loadChamber(makeFakeChamberModule("search", { start }), noEnv)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(getChamber("search")).toBeNull();
  });

  it("hands each chamber its own config, never another's", async () => {
    const seen: Record<string, Record<string, string | undefined>> = {};
    const withEnv = (name: string) => {
      const fake = makeFakeChamberModule(name);
      fake.initEnv = (source) => void (seen[name] = source);
      return fake;
    };
    await loadChambers([withEnv("cfg-a"), withEnv("cfg-b")], { envFor: (m) => ({ OWNER: m.manifest.name }) });
    expect(seen).toEqual({ "cfg-a": { OWNER: "cfg-a" }, "cfg-b": { OWNER: "cfg-b" } });
  });
});

describe("stopChambers", () => {
  it("stops every loaded chamber even if one throws, and unloads them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stopA = vi.fn(() => {
      throw new Error("stuck");
    });
    const stopB = vi.fn();
    await loadChambers([makeFakeChamberModule("stop-a", { stop: stopA }), makeFakeChamberModule("stop-b", { stop: stopB })], noEnv);
    await stopChambers();
    expect(stopA).toHaveBeenCalled();
    expect(stopB).toHaveBeenCalled();
    expect(listModules()).toEqual([]);
  });
});

describe("readChamberEnv", () => {
  it("parses the chamber's own .env without touching process.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "chamber-env-"));
    writeFileSync(join(dir, ".env"), "TRACCAR_URL=http://traccar.local\nDB_PATH=./data/map.sqlite3\n");
    expect(readChamberEnv(dir)).toEqual({ TRACCAR_URL: "http://traccar.local", DB_PATH: "./data/map.sqlite3" });
    expect(process.env.TRACCAR_URL).not.toBe("http://traccar.local");
  });

  it("is empty for a chamber with no .env", () => {
    expect(readChamberEnv(mkdtempSync(join(tmpdir(), "chamber-env-")))).toEqual({});
  });
});
