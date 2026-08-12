import { randomUUID } from "node:crypto";
import { eq, and, isNull, desc } from "drizzle-orm";
import type {
  CreateShareRequest,
  UpdateShareRequest,
  ShareSummary,
  ShareClosureEntry,
  ExhibitSharingEntry,
} from "@congress/shared-types";
import { db } from "./db/client.js";
import { shares, exhibitCache, exhibitRefs } from "./db/schema.js";
import { resolveOneLive } from "./exhibits.js";

const MAX_DEPTH_CEILING = 10;
const MAX_CLOSURE_NODES = 500;

export type ShareRow = typeof shares.$inferSelect;

function toSummary(row: ShareRow): ShareSummary {
  return {
    token: row.id,
    rootId: row.rootId,
    rootChamber: row.rootChamber,
    maxDepth: row.maxDepth,
    permission: row.permission,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    lastAccessedAt: row.lastAccessedAt ? row.lastAccessedAt.toISOString() : null,
  };
}

export function createShare(input: CreateShareRequest): ShareSummary {
  const now = new Date();
  const row = {
    id: randomUUID(),
    rootId: input.rootId,
    rootChamber: input.rootChamber,
    maxDepth: Math.min(Math.max(input.maxDepth, 0), MAX_DEPTH_CEILING),
    permission: input.permission,
    label: input.label ?? "",
    createdAt: now,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    revokedAt: null,
    lastAccessedAt: null,
  };
  db.insert(shares).values(row).run();
  return toSummary(row as ShareRow);
}

export function listShares(): ShareSummary[] {
  return db.select().from(shares).all().map(toSummary);
}

// Shares rooted exactly at this exhibit - what a "Share" button on that
// exhibit's own view page manages. Deliberately excludes shares that merely
// reach this exhibit by inheritance (those belong to a different root and
// aren't this exhibit's to edit/revoke).
export function listSharesForRoot(rootId: string): ShareSummary[] {
  return db.select().from(shares).where(eq(shares.rootId, rootId)).orderBy(desc(shares.createdAt)).all().map(toSummary);
}

// Every share whose closure reaches this exhibit - its own root shares
// (direct: true, including inactive ones, same as listSharesForRoot) plus
// any other active share that merely passes through it via inheritance
// (direct: false). Powers the exhibit's "Share" popover so a share created
// on an ancestor exhibit can be found and edited from a descendant's own
// page too, not just from the ancestor's.
export async function listSharesForExhibit(id: string): Promise<ShareSummary[]> {
  const direct = listSharesForRoot(id).map((s) => ({ ...s, direct: true }));

  const activeShares = db.select().from(shares).where(isNull(shares.revokedAt)).all().filter(isShareActive);
  const inherited: ShareSummary[] = [];
  for (const share of activeShares) {
    if (share.rootId === id) continue;
    const entry = await isExhibitInShare(share, id);
    if (entry && entry.depth > 0) {
      inherited.push({ ...toSummary(share), direct: false });
    }
  }

  return [...direct, ...inherited];
}

export function updateShare(token: string, input: UpdateShareRequest): ShareSummary | null {
  const existing = getShareRow(token);
  if (!existing) return null;

  const next = {
    permission: input.permission ?? existing.permission,
    maxDepth:
      input.maxDepth !== undefined ? Math.min(Math.max(input.maxDepth, 0), MAX_DEPTH_CEILING) : existing.maxDepth,
    label: input.label !== undefined ? input.label : existing.label,
    expiresAt:
      input.expiresAt === undefined ? existing.expiresAt : input.expiresAt === null ? null : new Date(input.expiresAt),
  };

  db.update(shares).set(next).where(eq(shares.id, token)).run();
  return toSummary({ ...existing, ...next });
}

export function revokeShare(token: string): boolean {
  const result = db
    .update(shares)
    .set({ revokedAt: new Date() })
    .where(and(eq(shares.id, token), isNull(shares.revokedAt)))
    .run();
  return result.changes > 0;
}

export function getShareRow(token: string): ShareRow | undefined {
  return db.select().from(shares).where(eq(shares.id, token)).get();
}

export function isShareActive(share: ShareRow): boolean {
  if (share.revokedAt) return false;
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export function touchShareAccess(token: string): void {
  db.update(shares).set({ lastAccessedAt: new Date() }).where(eq(shares.id, token)).run();
}

interface ClosureNodeMeta {
  chamber: string;
  type: string;
  name: string;
}

function cachedNodeMeta(id: string): ClosureNodeMeta | null {
  const cached = db.select().from(exhibitCache).where(eq(exhibitCache.id, id)).get();
  if (!cached || cached.deleted) return null;
  return { chamber: cached.chamber, type: cached.type, name: cached.name };
}

// Only used for the share's root, whose chamber the owner supplied
// explicitly at share-creation time and so is trustworthy. BFS children are
// resolved cache-only (see cachedNodeMeta) - we have no verified chamber for
// them (exhibit_refs only records the *source's* chamber), and guessing
// would risk a live /exhibits/resolve call against the wrong chamber, which
// could come back "not found" and mis-sync an unrelated exhibit as deleted.
async function resolveRootMeta(id: string, chamber: string): Promise<ClosureNodeMeta | null> {
  const cached = cachedNodeMeta(id);
  if (cached) return cached;

  const live = await resolveOneLive(id, chamber);
  if ("deleted" in live || "unavailable" in live) return null;
  const backfilled = cachedNodeMeta(id);
  return { chamber: live.chamber, type: backfilled?.type ?? "", name: live.name };
}

// BFS over exhibit_refs from the share's root, up to share.maxDepth hops.
// Computed live on every call - nothing about the closure is cached, so an
// exhibit newly referenced by an already-shared exhibit is included the
// very next time this runs, with no re-share action needed.
//
// A target id with no exhibit_cache row (never synced/resolved anywhere)
// can't have its owning chamber inferred and is skipped - in practice this
// doesn't arise, since a chamber syncs on every create and a [[ reference
// can only target something that already exists.
export async function computeShareClosure(share: ShareRow): Promise<ShareClosureEntry[]> {
  const rootMeta = await resolveRootMeta(share.rootId, share.rootChamber);
  if (!rootMeta) return [];

  const depthById = new Map<string, number>([[share.rootId, 0]]);
  const entries: ShareClosureEntry[] = [
    { id: share.rootId, chamber: rootMeta.chamber, type: rootMeta.type, name: rootMeta.name, depth: 0 },
  ];

  let frontier = [share.rootId];
  let depth = 0;

  while (frontier.length > 0 && depth < share.maxDepth && depthById.size < MAX_CLOSURE_NODES) {
    const nextFrontier: string[] = [];

    for (const sourceId of frontier) {
      const outgoing = db
        .select({ targetId: exhibitRefs.targetId })
        .from(exhibitRefs)
        .where(eq(exhibitRefs.sourceId, sourceId))
        .all();

      for (const { targetId } of outgoing) {
        if (depthById.has(targetId) || depthById.size >= MAX_CLOSURE_NODES) continue;

        const meta = cachedNodeMeta(targetId);
        if (!meta) continue;

        depthById.set(targetId, depth + 1);
        entries.push({ id: targetId, chamber: meta.chamber, type: meta.type, name: meta.name, depth: depth + 1 });
        nextFrontier.push(targetId);
      }
    }

    frontier = nextFrontier;
    depth += 1;
  }

  return entries;
}

export async function isExhibitInShare(share: ShareRow, id: string): Promise<ShareClosureEntry | null> {
  const closure = await computeShareClosure(share);
  return closure.find((e) => e.id === id) ?? null;
}

export async function getExhibitSharing(id: string): Promise<ExhibitSharingEntry[]> {
  const activeShares = db.select().from(shares).where(isNull(shares.revokedAt)).all().filter(isShareActive);

  const results: ExhibitSharingEntry[] = [];
  for (const share of activeShares) {
    const entry = await isExhibitInShare(share, id);
    if (entry) {
      results.push({ token: share.id, label: share.label, permission: share.permission, direct: entry.depth === 0 });
    }
  }
  return results;
}
