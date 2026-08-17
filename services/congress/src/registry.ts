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
    apiBase: row.apiBase,
    mcpUrl: row.mcpUrl ?? undefined,
    healthUrl: row.healthUrl,
    contentFormat: row.contentFormat ?? undefined,
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
        apiBase: manifest.apiBase,
        mcpUrl: manifest.mcpUrl ?? null,
        healthUrl: manifest.healthUrl,
        contentFormat: manifest.contentFormat ?? null,
        status: "active",
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
        apiBase: manifest.apiBase,
        mcpUrl: manifest.mcpUrl ?? null,
        healthUrl: manifest.healthUrl,
        contentFormat: manifest.contentFormat ?? null,
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
    .set({ lastHeartbeatAt: new Date(), status: "active" })
    .where(eq(chambers.name, name))
    .run();

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
