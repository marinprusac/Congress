import { asc, eq, isNotNull, lt, and } from "drizzle-orm";
import { DASHBOARD_MAX_CARDS, dashboardBlockSchema, type DashboardBlock, type DashboardCard, type DashboardCardInput, type ResolvedDashboardBlock } from "@congress/shared-types";
import { db } from "./db/client.js";
import { dashboardCards } from "./db/schema.js";
import { getCachedChamber } from "./records.js";
import { resolveRecords } from "./records.js";

// The home dashboard. Only the AI changes it (the dashboard_* MCP tools); the
// owner just reads it.

type Row = typeof dashboardCards.$inferSelect;

export class DashboardError extends Error {}

function blocksOf(row: Row): DashboardBlock[] {
  // Stored blocks that no longer parse (a schema change) are skipped, not fatal.
  return (row.blocksJson as unknown[]).flatMap((b) => {
    const parsed = dashboardBlockSchema.safeParse(b);
    return parsed.success ? [parsed.data] : [];
  });
}

export function sweepExpiredCards(now = Date.now()): void {
  db.delete(dashboardCards).where(and(isNotNull(dashboardCards.expiresAt), lt(dashboardCards.expiresAt, new Date(now)))).run();
}

function liveRows(now: number): Row[] {
  sweepExpiredCards(now);
  return db.select().from(dashboardCards).orderBy(asc(dashboardCards.position), asc(dashboardCards.id)).all();
}

// Cards as the browser shows them, record blocks resolved to their current name.
export async function listDashboard(now = Date.now()): Promise<DashboardCard[]> {
  const rows = liveRows(now);
  const ids = [...new Set(rows.flatMap((r) => blocksOf(r).flatMap((b) => (b.type === "record" ? [b.id] : []))))];
  const resolved = new Map((await resolveRecords(ids.map((id) => ({ id, chamber: getCachedChamber(id) ?? "e" })))).map((r) => [r.id, r]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    kicker: row.kicker,
    color: (row.color as DashboardCard["color"]) ?? null,
    size: row.size === "wide" ? "wide" : "normal",
    blocks: blocksOf(row).map((b): ResolvedDashboardBlock => {
      if (b.type !== "record") return b;
      const hit = resolved.get(b.id);
      const ok = hit && "name" in hit && !("deleted" in hit) && !("unavailable" in hit);
      return { ...b, record: ok ? { name: hit.name, url: hit.url, chamber: hit.chamber, type: hit.type } : null };
    }),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

// What the AI sees: the stored cards as it wrote them.
export function listDashboardForAi(now = Date.now()) {
  return liveRows(now).map((r) => ({
    id: r.id,
    title: r.title,
    kicker: r.kicker,
    color: r.color,
    size: r.size,
    blocks: blocksOf(r),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export function addCard(input: DashboardCardInput, position: "top" | "bottom" = "top", now = Date.now()): number {
  const rows = liveRows(now);
  if (rows.length >= DASHBOARD_MAX_CARDS) throw new DashboardError(`The dashboard holds at most ${DASHBOARD_MAX_CARDS} cards - remove one first.`);
  const positions = rows.map((r) => r.position);
  const at = position === "top" ? Math.min(0, ...positions) - 1 : Math.max(0, ...positions) + 1;
  const date = new Date(now);
  return db
    .insert(dashboardCards)
    .values({
      title: input.title,
      kicker: input.kicker ?? null,
      color: input.color ?? null,
      size: input.size ?? "normal",
      blocksJson: input.blocks,
      position: at,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdAt: date,
      updatedAt: date,
    })
    .returning({ id: dashboardCards.id })
    .get().id;
}

// Fields left out stay as they are; `kicker`/`color`/`expiresAt` accept null to clear.
export function updateCard(id: number, patch: Partial<Omit<DashboardCardInput, "kicker" | "color">> & { kicker?: string | null; color?: DashboardCardInput["color"] | null }, now = Date.now()): boolean {
  const set: Partial<typeof dashboardCards.$inferInsert> = { updatedAt: new Date(now) };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.kicker !== undefined) set.kicker = patch.kicker;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.size !== undefined) set.size = patch.size;
  if (patch.blocks !== undefined) set.blocksJson = patch.blocks;
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  return db.update(dashboardCards).set(set).where(eq(dashboardCards.id, id)).run().changes > 0;
}

export function removeCards(ids: number[]): number {
  let n = 0;
  for (const id of ids) n += db.delete(dashboardCards).where(eq(dashboardCards.id, id)).run().changes;
  return n;
}

// Puts the named cards first, in that order; the rest keep their order after them.
export function reorderCards(ids: number[], now = Date.now()): void {
  const rest = liveRows(now).map((r) => r.id).filter((id) => !ids.includes(id));
  [...ids, ...rest].forEach((id, i) => db.update(dashboardCards).set({ position: i }).where(eq(dashboardCards.id, id)).run());
}
