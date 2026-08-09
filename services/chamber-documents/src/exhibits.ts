import { like, or, inArray, desc } from "drizzle-orm";
import type { ExhibitSearchResult, ExhibitResolveResult, ExhibitSyncRequest } from "@congress/shared-types";
import { db } from "./db/client.js";
import { documents } from "./db/schema.js";
import { env } from "./env.js";

const DOCUMENT_ID_PREFIX = "document-";

export function toExhibitId(documentId: number): string {
  return `${DOCUMENT_ID_PREFIX}${documentId}`;
}

function parseDocumentId(exhibitId: string): number | null {
  if (!exhibitId.startsWith(DOCUMENT_ID_PREFIX)) return null;
  const id = Number(exhibitId.slice(DOCUMENT_ID_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

// An empty query matches everything ("%%"), which combined with the
// most-recent-first ordering is exactly the "show me what's there" listing
// the picker wants before the user has typed anything.
export async function searchDocumentExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(documents)
    .where(or(like(documents.title, pattern), like(documents.filename, pattern)))
    .orderBy(desc(documents.updatedAt))
    .limit(limit)
    .all();
  return rows.map((row) => ({
    id: toExhibitId(row.id),
    type: "document",
    name: row.title,
    url: `/d/${row.id}`,
  }));
}

export async function resolveDocumentExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  const idToDocumentId = new Map<string, number>();
  for (const id of ids) {
    const documentId = parseDocumentId(id);
    if (documentId !== null) idToDocumentId.set(id, documentId);
  }

  const documentIds = [...idToDocumentId.values()];
  const rows = documentIds.length > 0 ? db.select().from(documents).where(inArray(documents.id, documentIds)).all() : [];
  const byDocumentId = new Map(rows.map((row) => [row.id, row]));

  return ids.map((id): ExhibitResolveResult => {
    const documentId = idToDocumentId.get(id);
    const row = documentId !== undefined ? byDocumentId.get(documentId) : undefined;
    if (!row) return { id, deleted: true };
    return { id, name: row.title, url: `/d/${row.id}` };
  });
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN,
  };
}

export async function pushExhibitSync(push: Omit<ExhibitSyncRequest, "chamber">): Promise<void> {
  try {
    const res = await fetch(`${env.CAPITOL_URL}/capitol/exhibits/sync`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chamber: "documents", ...push }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(`Exhibit sync rejected by Capitol: ${res.status}`);
    }
  } catch (err) {
    console.warn(`Exhibit sync failed: ${(err as Error).message}`);
  }
}
