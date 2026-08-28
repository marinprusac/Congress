import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeManifest, migrationsDir } from "@congress/test-support";

// The registry publishes chamber_online/chamber_offline as a side effect;
// mocking the relay keeps these tests off the network and lets them assert
// on the publishes directly. (registry.ts and events.ts import each other,
// so this also keeps that cycle out of the picture.)
vi.mock("./events.js", () => ({ publishEvent: vi.fn() }));

import { publishEvent } from "./events.js";
import { db, runMigrations } from "./db/client.js";
import { chambers } from "./db/schema.js";
import {
  attachChamber,
  deregisterChamber,
  detachChamber,
  getChamber,
  listChambers,
  recordHeartbeat,
  registerChamber,
  sweepStaleChambers,
} from "./registry.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  vi.mocked(publishEvent).mockClear();
});

// registry.ts keeps an in-process Map cache that every mutator has to write
// through by hand - nothing ever invalidates it, and Congress is the only
// writer of this table. That makes a missed write-through invisible until a
// proxied request reads a stale status, which is the single most likely way
// a change here breaks the gateway. Every test below therefore asserts
// through getChamber()/listChambers() (the cached reads the gateway itself
// uses) rather than by re-querying the table.
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
    registerChamber(makeManifest("bravo", "http://127.0.0.1:9", { displayName: "Renamed", version: "0.2.0" }));

    expect(db.select().from(chambers).all().filter((r) => r.name === "bravo")).toHaveLength(1);
    expect(getChamber("bravo")).toMatchObject({ displayName: "Renamed", version: "0.2.0" });
  });

  it("does not clear a manual detach when the chamber restarts and re-registers", () => {
    // A redeploy restarts every service; that must not silently undo an
    // owner's decision to take one out of rotation.
    registerChamber(makeManifest("charlie"));
    detachChamber("charlie");
    registerChamber(makeManifest("charlie"));

    expect(getChamber("charlie")?.status).toBe("detached");
    expect(statusInDb("charlie")).toBe("detached");
  });

  it("announces a chamber coming back from offline, but not an ordinary re-register", () => {
    registerChamber(makeManifest("delta"));
    registerChamber(makeManifest("delta"));
    expect(publishEvent).not.toHaveBeenCalled();

    deregisterChamber("delta");
    registerChamber(makeManifest("delta"));
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "congress.chamber_online", payload: { chamberName: "delta", priority: "low" } })
    );
  });

  it("stores the subscriptions sent with the registration", () => {
    registerChamber(makeManifest("echo"), [{ type: "tasks.due_soon", minPriority: "high" }]);
    expect(getChamber("echo")?.subscriptions).toEqual([{ type: "tasks.due_soon", minPriority: "high" }]);
  });
});

describe("recordHeartbeat", () => {
  it("returns null for a chamber that was never registered", () => {
    expect(recordHeartbeat("never-seen")).toBeNull();
  });

  it("records freshness and keeps the chamber active", () => {
    registerChamber(makeManifest("foxtrot"));
    const entry = recordHeartbeat("foxtrot");
    expect(entry?.status).toBe("active");
    expect(entry?.lastHeartbeatAt).not.toBeNull();
    expect(getChamber("foxtrot")?.lastHeartbeatAt).toBe(entry?.lastHeartbeatAt);
  });

  it("does not let a live heartbeat clear a manual detach", () => {
    registerChamber(makeManifest("golf"));
    detachChamber("golf");
    recordHeartbeat("golf");
    expect(getChamber("golf")?.status).toBe("detached");
  });

  it("brings an offline chamber back and announces it", () => {
    registerChamber(makeManifest("hotel"));
    deregisterChamber("hotel");
    recordHeartbeat("hotel");

    expect(getChamber("hotel")?.status).toBe("active");
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "congress.chamber_online", payload: { chamberName: "hotel", priority: "low" } })
    );
  });

  it("replaces the subscription list wholesale, including with an empty one", () => {
    // A still-true empty subscription genuinely means "nothing to relay
    // right now" - keeping the previous list would keep relaying events the
    // Chamber has since stopped caring about.
    registerChamber(makeManifest("india"), [{ type: "tasks.due_soon" }]);
    recordHeartbeat("india", []);
    expect(getChamber("india")?.subscriptions).toEqual([]);
  });
});

describe("deregisterChamber", () => {
  it("marks the chamber offline and updates the cached read", () => {
    registerChamber(makeManifest("juliet"));
    expect(deregisterChamber("juliet")?.status).toBe("offline");
    expect(getChamber("juliet")?.status).toBe("offline");
  });

  it("returns null for an unknown chamber", () => {
    expect(deregisterChamber("never-seen-either")).toBeNull();
  });
});

describe("detachChamber / attachChamber", () => {
  it("round-trips through the cache", () => {
    registerChamber(makeManifest("kilo"));
    expect(detachChamber("kilo")?.status).toBe("detached");
    expect(getChamber("kilo")?.status).toBe("detached");
    expect(attachChamber("kilo")?.status).toBe("active");
    expect(getChamber("kilo")?.status).toBe("active");
  });

  it("returns null for an unknown chamber", () => {
    expect(detachChamber("nope")).toBeNull();
    expect(attachChamber("nope")).toBeNull();
  });
});

describe("sweepStaleChambers", () => {
  it("marks a chamber that has never heartbeated offline, falling back to its registration time", () => {
    // coalesce(lastHeartbeatAt, registeredAt): a chamber that registered and
    // then died before its first beat has a null lastHeartbeatAt, and must
    // still be swept rather than staying active forever.
    registerChamber(makeManifest("lima"));
    db.update(chambers)
      .set({ registeredAt: new Date(Date.now() - 60_000), lastHeartbeatAt: null })
      .where(eq(chambers.name, "lima"))
      .run();
    // The cache still holds the pre-update row; the sweep re-reads the table
    // itself, which is what makes this an honest test of the write-through.
    expect(sweepStaleChambers(30_000)).toContain("lima");
    expect(getChamber("lima")?.status).toBe("offline");
  });

  it("leaves a recently-heartbeated chamber alone", () => {
    registerChamber(makeManifest("mike"));
    recordHeartbeat("mike");
    expect(sweepStaleChambers(30_000)).not.toContain("mike");
    expect(getChamber("mike")?.status).toBe("active");
  });

  it("does not sweep a detached chamber, since the sweep only ever considers active ones", () => {
    registerChamber(makeManifest("november"));
    detachChamber("november");
    db.update(chambers).set({ registeredAt: new Date(0), lastHeartbeatAt: null }).where(eq(chambers.name, "november")).run();
    expect(sweepStaleChambers(30_000)).not.toContain("november");
    expect(getChamber("november")?.status).toBe("detached");
  });

  it("announces each swept chamber at high priority", () => {
    registerChamber(makeManifest("oscar"));
    db.update(chambers).set({ registeredAt: new Date(0), lastHeartbeatAt: null }).where(eq(chambers.name, "oscar")).run();
    sweepStaleChambers(30_000);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "congress.chamber_offline",
        payload: { chamberName: "oscar", priority: "high" },
      })
    );
  });

  it("returns an empty list and publishes nothing when everything is fresh", () => {
    expect(sweepStaleChambers(10 * 60 * 1000)).toEqual([]);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("listChambers", () => {
  it("returns every registered chamber, including offline and detached ones", () => {
    registerChamber(makeManifest("papa"));
    registerChamber(makeManifest("quebec"));
    detachChamber("quebec");
    const names = listChambers().map((c) => c.name);
    expect(names).toContain("papa");
    expect(names).toContain("quebec");
  });
});
