import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeChamberModule, makeManifest, migrationsDir } from "@congress/test-support";

// The registry publishes chamber_online/chamber_offline as a side effect;
// mocking the relay lets these tests assert on the publishes directly.
vi.mock("./events.js", () => ({ publishEvent: vi.fn() }));

import { publishEvent } from "./events.js";
import { db, runMigrations } from "./db/client.js";
import { chambers } from "./db/schema.js";
import { addModule } from "./chambers/runtime.js";
import { attachChamber, detachChamber, forgetChamber, getChamber, listChambers, markChamberOffline, registerChamber } from "./registry.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  vi.mocked(publishEvent).mockClear();
});

// registry.ts keeps an in-process cache every mutator writes through by
// hand, so every test asserts through getChamber()/listChambers() - the
// cached reads the gateway uses - and, where it matters, the table too.
function statusInDb(name: string): string | undefined {
  return db.select().from(chambers).all().find((row) => row.name === name)?.status;
}

describe("registerChamber", () => {
  it("inserts a new chamber as active and makes it immediately visible to the cached read", () => {
    const entry = registerChamber(makeManifest("alpha"));
    expect(entry.status).toBe("active");
    expect(getChamber("alpha")).toMatchObject({ name: "alpha", status: "active" });
  });

  it("updates an existing chamber in place rather than inserting a duplicate", () => {
    registerChamber(makeManifest("bravo"));
    registerChamber(makeManifest("bravo", { displayName: "Renamed", version: "0.2.0" }));

    expect(db.select().from(chambers).all().filter((r) => r.name === "bravo")).toHaveLength(1);
    expect(getChamber("bravo")).toMatchObject({ displayName: "Renamed", version: "0.2.0" });
  });

  it("does not clear a manual detach when Congress restarts and loads the chamber again", () => {
    registerChamber(makeManifest("charlie"));
    detachChamber("charlie");
    registerChamber(makeManifest("charlie"));

    expect(getChamber("charlie")?.status).toBe("detached");
    expect(statusInDb("charlie")).toBe("detached");
  });

  it("announces a chamber coming back from offline, but not an ordinary restart", () => {
    registerChamber(makeManifest("delta"));
    registerChamber(makeManifest("delta"));
    expect(publishEvent).not.toHaveBeenCalled();

    markChamberOffline(makeManifest("delta"));
    vi.mocked(publishEvent).mockClear();
    registerChamber(makeManifest("delta"));
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "congress.chamber_online", payload: { chamberName: "delta" } })
    );
  });

  it("stores the subscriptions and mcpUrl it was given", () => {
    registerChamber(makeManifest("echo", { mcpUrl: "http://127.0.0.1:3000/mcp/echo" }), [{ type: "tasks.due_soon" }]);
    expect(getChamber("echo")).toMatchObject({ subscriptions: [{ type: "tasks.due_soon" }], mcpUrl: "http://127.0.0.1:3000/mcp/echo" });
  });
});

describe("markChamberOffline", () => {
  it("lists a chamber that failed to start as offline and announces it once", () => {
    markChamberOffline(makeManifest("foxtrot"));
    markChamberOffline(makeManifest("foxtrot"));
    expect(getChamber("foxtrot")?.status).toBe("offline");
    expect(statusInDb("foxtrot")).toBe("offline");
    expect(vi.mocked(publishEvent).mock.calls.filter(([e]) => e.type === "congress.chamber_offline")).toHaveLength(1);
  });

  it("keeps a manual detach", () => {
    registerChamber(makeManifest("golf"));
    detachChamber("golf");
    markChamberOffline(makeManifest("golf"));
    expect(getChamber("golf")?.status).toBe("detached");
  });
});

describe("detachChamber / attachChamber", () => {
  it("round-trips through the cache for a loaded chamber", () => {
    addModule(makeFakeChamberModule("kilo"));
    registerChamber(makeManifest("kilo"));
    expect(detachChamber("kilo")?.status).toBe("detached");
    expect(getChamber("kilo")?.status).toBe("detached");
    expect(attachChamber("kilo")?.status).toBe("active");
    expect(getChamber("kilo")?.status).toBe("active");
  });

  it("attaches a chamber whose module never loaded as offline, not active", () => {
    markChamberOffline(makeManifest("lima"));
    detachChamber("lima");
    expect(attachChamber("lima")?.status).toBe("offline");
  });

  it("returns null for an unknown chamber", () => {
    expect(detachChamber("nope")).toBeNull();
    expect(attachChamber("nope")).toBeNull();
  });
});

describe("listChambers", () => {
  it("returns every chamber, including offline and detached ones", () => {
    registerChamber(makeManifest("papa"));
    registerChamber(makeManifest("quebec"));
    detachChamber("quebec");
    markChamberOffline(makeManifest("romeo"));
    const names = listChambers().map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["papa", "quebec", "romeo"]));
  });
});

describe("forgetChamber", () => {
  it("drops a retired Chamber's row and cache entry", () => {
    registerChamber(makeManifest("retired"));
    forgetChamber("retired");
    expect(getChamber("retired")).toBeNull();
    expect(db.select().from(chambers).all().map((r) => r.name)).not.toContain("retired");
  });
});
