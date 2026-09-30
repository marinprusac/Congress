import { eq } from "drizzle-orm";
import type { Manifest, ChamberRegistryEntry, ChamberStatus, ChamberSubscription } from "@congress/shared-types";
import { db } from "./db/client.js";
import { chambers } from "./db/schema.js";
import { publishEvent } from "./events.js";
import { getModule } from "./chambers/runtime.js";

function toEntry(row: typeof chambers.$inferSelect): ChamberRegistryEntry {
  return {
    name: row.name,
    displayName: row.displayName,
    version: row.version,
    routes: JSON.parse(row.routesJson),
    views: JSON.parse(row.viewsJson),
    exhibitTypes: JSON.parse(row.exhibitTypesJson),
    events: JSON.parse(row.eventsJson),
    subscriptions: JSON.parse(row.subscriptionsJson),
    mcpUrl: row.mcpUrl ?? undefined,
    status: row.status as ChamberStatus,
    registeredAt: row.registeredAt.toISOString(),
  };
}

// getChamber() sits on every /api/:chamber/* request, so the handful of rows
// is cached in-process. Congress is the only writer, so every mutation below
// just updates the cache.
let cache: Map<string, ChamberRegistryEntry> | null = null;

function ensureCache(): Map<string, ChamberRegistryEntry> {
  if (!cache) {
    cache = new Map(db.select().from(chambers).orderBy(chambers.id).all().map((row) => [row.name, toEntry(row)]));
  }
  return cache;
}

function upsert(manifest: Manifest, status: "active" | "offline", subscriptions: ChamberSubscription[]): ChamberRegistryEntry {
  const existing = db.select().from(chambers).where(eq(chambers.name, manifest.name)).get();
  const values = {
    displayName: manifest.displayName,
    version: manifest.version,
    routesJson: JSON.stringify(manifest.routes),
    viewsJson: JSON.stringify(manifest.views ?? []),
    exhibitTypesJson: JSON.stringify(manifest.exhibitTypes ?? []),
    eventsJson: JSON.stringify(manifest.events),
    subscriptionsJson: JSON.stringify(subscriptions),
    // Legacy columns from when Chambers were separate processes.
    apiBase: "",
    healthUrl: "",
    mcpUrl: manifest.mcpUrl ?? null,
    // A manual detach survives restarts - only attachChamber clears it.
    status: existing?.status === "detached" ? ("detached" as const) : status,
  };

  const row = existing
    ? db.update(chambers).set(values).where(eq(chambers.name, manifest.name)).returning().get()
    : db.insert(chambers).values({ name: manifest.name, registeredAt: new Date(), ...values }).returning().get();
  if (!row) throw new Error("Failed to write chamber registry row");

  if (existing?.status === "offline" && status === "active") {
    publishEvent({ chamber: "congress", type: "congress.chamber_online", payload: { chamberName: manifest.name } });
  }
  if (existing?.status !== "offline" && status === "offline") {
    publishEvent({ chamber: "congress", type: "congress.chamber_offline", payload: { chamberName: manifest.name } });
  }

  const entry = toEntry(row);
  ensureCache().set(entry.name, entry);
  return entry;
}

// A Chamber module that started successfully inside Congress.
export function registerChamber(manifest: Manifest, subscriptions: ChamberSubscription[] = []): ChamberRegistryEntry {
  return upsert(manifest, "active", subscriptions);
}

// A Chamber module whose start() threw - kept listed so the owner sees it.
export function markChamberOffline(manifest: Manifest): ChamberRegistryEntry {
  return upsert(manifest, "offline", []);
}

function setStatus(name: string, status: ChamberStatus): ChamberRegistryEntry | null {
  const row = db.update(chambers).set({ status }).where(eq(chambers.name, name)).returning().get();
  if (!row) return null;
  const entry = toEntry(row);
  ensureCache().set(entry.name, entry);
  return entry;
}

// Manual owner override: takes a Chamber out of rotation (routing, API,
// feed, search, MCP) while its module stays loaded. Survives restarts.
export function detachChamber(name: string): ChamberRegistryEntry | null {
  return setStatus(name, "detached");
}

// Back to "active" only if its module actually loaded this boot.
export function attachChamber(name: string): ChamberRegistryEntry | null {
  return setStatus(name, getModule(name) ? "active" : "offline");
}

// Drops a retired Chamber's row for good (it became part of core).
export function forgetChamber(name: string): void {
  db.delete(chambers).where(eq(chambers.name, name)).run();
  ensureCache().delete(name);
}

export function listChambers(): ChamberRegistryEntry[] {
  return Array.from(ensureCache().values());
}

export function getChamber(name: string): ChamberRegistryEntry | null {
  return ensureCache().get(name) ?? null;
}
