import { eq, and, lt, sql } from "drizzle-orm";
import type { Manifest, ChamberRegistryEntry, ChamberStatus } from "@congress/shared-types";
import { db } from "./db/client.js";
import { chambers } from "./db/schema.js";

function toEntry(row: typeof chambers.$inferSelect): ChamberRegistryEntry {
  return {
    name: row.name,
    displayName: row.displayName,
    version: row.version,
    routes: JSON.parse(row.routesJson),
    widgets: JSON.parse(row.widgetsJson),
    events: JSON.parse(row.eventsJson),
    apiBase: row.apiBase,
    mcpUrl: row.mcpUrl ?? undefined,
    healthUrl: row.healthUrl,
    status: row.status as ChamberStatus,
    registeredAt: row.registeredAt.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
  };
}

export function registerChamber(manifest: Manifest): ChamberRegistryEntry {
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
  return toEntry(row);
}

export function deregisterChamber(name: string): ChamberRegistryEntry | null {
  const existing = db.select().from(chambers).where(eq(chambers.name, name)).get();
  if (!existing) return null;

  db.update(chambers).set({ status: "offline" }).where(eq(chambers.name, name)).run();

  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  return row ? toEntry(row) : null;
}

export function recordHeartbeat(name: string): ChamberRegistryEntry | null {
  const existing = db.select().from(chambers).where(eq(chambers.name, name)).get();
  if (!existing) return null;

  db.update(chambers)
    .set({
      lastHeartbeatAt: new Date(),
      // Still record freshness while detached, but a live heartbeat must
      // not itself clear a manual detach - only attachChamber does.
      status: existing.status === "detached" ? "detached" : "active",
    })
    .where(eq(chambers.name, name))
    .run();

  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  return row ? toEntry(row) : null;
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
  return row ? toEntry(row) : null;
}

// Clears a manual detach, immediately marking the Chamber active again. If
// it isn't actually reachable, the next heartbeat sweep will flip it back
// to "offline" same as any other Chamber.
export function attachChamber(name: string): ChamberRegistryEntry | null {
  const existing = db.select().from(chambers).where(eq(chambers.name, name)).get();
  if (!existing) return null;

  db.update(chambers).set({ status: "active" }).where(eq(chambers.name, name)).run();

  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  return row ? toEntry(row) : null;
}

export function listChambers(): ChamberRegistryEntry[] {
  const rows = db.select().from(chambers).orderBy(chambers.id).all();
  return rows.map(toEntry);
}

export function getChamber(name: string): ChamberRegistryEntry | null {
  const row = db.select().from(chambers).where(eq(chambers.name, name)).get();
  return row ? toEntry(row) : null;
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
  }

  return stale.map((row) => row.name);
}
