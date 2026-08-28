import { eq, and, lt, sql } from "drizzle-orm";
import type { Manifest, ChamberRegistryEntry, ChamberStatus, ChamberSubscription } from "@congress/shared-types";
import { db } from "./db/client.js";
import { chambers } from "./db/schema.js";
import { publishEvent } from "./events.js";

function toEntry(row: typeof chambers.$inferSelect): ChamberRegistryEntry {
  return {
    name: row.name,
    displayName: row.displayName,
    version: row.version,
    routes: JSON.parse(row.routesJson),
    widgets: JSON.parse(row.widgetsJson),
    events: JSON.parse(row.eventsJson),
    subscriptions: JSON.parse(row.subscriptionsJson),
    apiBase: row.apiBase,
    mcpUrl: row.mcpUrl ?? undefined,
    healthUrl: row.healthUrl,
    status: row.status as ChamberStatus,
    registeredAt: row.registeredAt.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
  };
}

// The registry is a handful of rows that change only on registration,
// heartbeat, detach/attach and the stale-sweep - but getChamber() sits on
// every single proxied request (every static asset, every /api/:chamber/*
// call), each of which used to cost a SELECT plus four JSON.parse calls for
// a table that's essentially never written. Cached in-process and kept in
// sync by every function below that mutates a row, rather than invalidated
// and re-read - Congress is the only process that ever writes this table,
// so there's no other writer to miss. Insertion order is preserved on
// `Map.set()` of an existing key, so listChambers() below stays consistent
// with the old `orderBy(chambers.id)` without needing to track it separately.
let cache: Map<string, ChamberRegistryEntry> | null = null;

function ensureCache(): Map<string, ChamberRegistryEntry> {
  if (!cache) {
    cache = new Map(db.select().from(chambers).orderBy(chambers.id).all().map((row) => [row.name, toEntry(row)]));
  }
  return cache;
}

export function registerChamber(manifest: Manifest, subscriptions: ChamberSubscription[] = []): ChamberRegistryEntry {
  const now = new Date();
  const existing = db.select().from(chambers).where(eq(chambers.name, manifest.name)).get();

  if (existing) {
    db.update(chambers)
      .set({
        displayName: manifest.displayName,
        version: manifest.version,
        routesJson: JSON.stringify(manifest.routes),
        widgetsJson: JSON.stringify(manifest.widgets),
        eventsJson: JSON.stringify(manifest.events),
        subscriptionsJson: JSON.stringify(subscriptions),
        apiBase: manifest.apiBase,
        mcpUrl: manifest.mcpUrl ?? null,
        healthUrl: manifest.healthUrl,
        // A re-registering Chamber (e.g. restarting) shouldn't silently
        // undo a manual detach - only attachChamber clears it.
        status: existing.status === "detached" ? "detached" : "active",
      })
      .where(eq(chambers.name, manifest.name))
      .run();
  } else {
    db.insert(chambers)
      .values({
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version,
        routesJson: JSON.stringify(manifest.routes),
        widgetsJson: JSON.stringify(manifest.widgets),
        eventsJson: JSON.stringify(manifest.events),
        subscriptionsJson: JSON.stringify(subscriptions),
        apiBase: manifest.apiBase,
        mcpUrl: manifest.mcpUrl ?? null,
        healthUrl: manifest.healthUrl,
        status: "active",
        registeredAt: now,
      })
      .run();
  }

  const row = db.select().from(chambers).where(eq(chambers.name, manifest.name)).get();
  if (!row) throw new Error("Failed to read back registered chamber");
  if (existing && existing.status === "offline") {
    publishEvent({
      chamber: "congress",
      type: "congress.chamber_online",
      payload: { chamberName: manifest.name, priority: "low" },
    });
  }
  const entry = toEntry(row);
  ensureCache().set(entry.name, entry);
  return entry;
}

export function deregisterChamber(name: string): ChamberRegistryEntry | null {
  const existing = db.select().from(chambers).where(eq(chambers.name, name)).get();
  if (!existing) return null;

  db.update(chambers).set({ status: "offline" }).where(eq(chambers.name, name)).run();

  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  const entry = row ? toEntry(row) : null;
  if (entry) ensureCache().set(entry.name, entry);
  return entry;
}

// Fires on every Chamber's heartbeat interval, forever - down from three
// statements (a SELECT to check existence, the UPDATE, a second SELECT to
// read the row back) to one. The existence/status pre-check now reads the
// in-memory registry cache instead of a DB round trip (see ensureCache
// above), and `.returning()` collapses the write and the read-back into a
// single UPDATE.
export function recordHeartbeat(name: string, subscriptions?: ChamberSubscription[]): ChamberRegistryEntry | null {
  const existing = ensureCache().get(name);
  if (!existing) return null;

  const row = db
    .update(chambers)
    .set({
      lastHeartbeatAt: new Date(),
      // Still record freshness while detached, but a live heartbeat must
      // not itself clear a manual detach - only attachChamber does.
      status: existing.status === "detached" ? "detached" : "active",
      // Always refreshed on a heartbeat that provides it (even to an empty
      // list) - a still-true empty subscription genuinely means "nothing
      // to relay right now", not "leave the old list alone".
      ...(subscriptions !== undefined ? { subscriptionsJson: JSON.stringify(subscriptions) } : {}),
    })
    .where(eq(chambers.name, name))
    .returning()
    .get();

  if (existing.status === "offline") {
    publishEvent({
      chamber: "congress",
      type: "congress.chamber_online",
      payload: { chamberName: name, priority: "low" },
    });
  }
  const entry = row ? toEntry(row) : null;
  if (entry) ensureCache().set(entry.name, entry);
  return entry;
}

// Manual owner override: take a Chamber out of gateway rotation (frontend
// routing, /api/:chamber/* proxying) without deregistering it - distinct
// from the heartbeat-driven "offline" status so it sticks even while the
// Chamber's own process keeps heartbeating. Only attachChamber clears it.
export function detachChamber(name: string): ChamberRegistryEntry | null {
  const existing = db.select().from(chambers).where(eq(chambers.name, name)).get();
  if (!existing) return null;

  db.update(chambers).set({ status: "detached" }).where(eq(chambers.name, name)).run();

  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  const entry = row ? toEntry(row) : null;
  if (entry) ensureCache().set(entry.name, entry);
  return entry;
}

// Clears a manual detach, immediately marking the Chamber active again. If
// it isn't actually reachable, the next heartbeat sweep will flip it back
// to "offline" same as any other Chamber.
export function attachChamber(name: string): ChamberRegistryEntry | null {
  const existing = db.select().from(chambers).where(eq(chambers.name, name)).get();
  if (!existing) return null;

  db.update(chambers).set({ status: "active" }).where(eq(chambers.name, name)).run();

  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  const entry = row ? toEntry(row) : null;
  if (entry) ensureCache().set(entry.name, entry);
  return entry;
}

export function listChambers(): ChamberRegistryEntry[] {
  return Array.from(ensureCache().values());
}

export function getChamber(name: string): ChamberRegistryEntry | null {
  return ensureCache().get(name) ?? null;
}

export function sweepStaleChambers(timeoutMs: number): string[] {
  const cutoffMs = Date.now() - timeoutMs;
  const stale = db
    .select()
    .from(chambers)
    .where(
      and(
        eq(chambers.status, "active"),
        lt(sql`coalesce(${chambers.lastHeartbeatAt}, ${chambers.registeredAt})`, cutoffMs)
      )
    )
    .all();

  if (stale.length === 0) return [];

  for (const row of stale) {
    db.update(chambers).set({ status: "offline" }).where(eq(chambers.name, row.name)).run();
    ensureCache().set(row.name, toEntry({ ...row, status: "offline" }));
    publishEvent({
      chamber: "congress",
      type: "congress.chamber_offline",
      payload: { chamberName: row.name, priority: "high" },
    });
  }

  return stale.map((row) => row.name);
}
