import { eq, inArray } from "drizzle-orm";
import type { ExhibitResolveResult, ExhibitSearchResult, FeedCandidate, ManifestEvent } from "@congress/shared-types";
import { scoreExhibitMatch } from "@congress/chamber-kit";
import type { LocalExhibitSource } from "../exhibitSources.js";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { records } from "./db/schema.js";
import { getType, listTypes } from "./store.js";
import { activeFields } from "./operations.js";
import { quoteIdent } from "./ddl.js";
import { addManualRef, NAMESPACE, readRow, recordUrl, removeManualRef, titleOf, typeOfRecord } from "./records.js";
import { feedCandidatesFor } from "./feedRules.js";
import type { Stored } from "./casts.js";

// The "e" exhibit namespace: every type's records, in-process.

const SEARCH_CANDIDATES = 200;
const RECENT_LIMIT = 10;

type Row = Record<string, Stored>;

function searchType(t: ReturnType<typeof listTypes>[number], query: string): ExhibitSearchResult[] {
  const def = t.definition;
  const table = quoteIdent(def.tableName);
  const title = def.fields.find((f) => f.id === def.titleField);
  const q = query.trim();
  if (!q) {
    const rows = exhibitsSqlite.prepare(`SELECT * FROM ${table} ORDER BY "updated_at" DESC LIMIT ?`).all(RECENT_LIMIT) as Row[];
    return rows.map((r) => ({ id: String(r.id), type: def.slug, name: titleOf(def, r), url: recordUrl(String(r.id)) }));
  }
  const searchable = activeFields(def).filter((f) => f.id === def.titleField || f.options.searchable);
  if (searchable.length === 0) return [];
  const where = searchable.map((f) => `${quoteIdent(f.column)} LIKE ? ESCAPE '\\'`).join(" OR ");
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = exhibitsSqlite
    .prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY "updated_at" DESC LIMIT ?`)
    .all(...searchable.map(() => pattern), SEARCH_CANDIDATES) as Row[];
  return rows
    .map((r) => ({
      id: String(r.id),
      type: def.slug,
      name: titleOf(def, r),
      url: recordUrl(String(r.id)),
      score: scoreExhibitMatch(
        q,
        searchable.map((f) => ({ text: String(r[f.column] ?? ""), isPrimary: f.id === title?.id }))
      ),
    }))
    .filter((r) => r.score > 0);
}

export const typeEngineSource: LocalExhibitSource = {
  namespace: NAMESPACE,

  search(query) {
    const results = listTypes().flatMap((t) => searchType(t, query));
    return query.trim() ? results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : results;
  },

  resolve(ids) {
    const owners = new Map(
      ids.length ? exhibitsDb.select().from(records).where(inArray(records.id, ids)).all().map((r) => [r.id, r.typeId]) : []
    );
    return ids.map((id): ExhibitResolveResult => {
      const t = owners.has(id) ? getType(owners.get(id)!) : undefined;
      const row = t && readRow(t.definition, id);
      if (!t || !row) return { id, deleted: true };
      return { id, name: titleOf(t.definition, row), url: recordUrl(id) };
    });
  },

  typeOf(id) {
    const row = exhibitsDb.select().from(records).where(eq(records.id, id)).get();
    return row ? (getType(row.typeId)?.definition.slug ?? null) : null;
  },

  chip(id) {
    const t = typeOfRecord(id);
    const row = t && readRow(t.definition, id);
    return t && row ? { id, name: titleOf(t.definition, row), url: recordUrl(id) } : null;
  },

  addManualRef,
  removeManualRef,

  feedCandidates(now): FeedCandidate[] {
    return listTypes().flatMap((t) =>
      feedCandidatesFor(
        t.definition,
        now,
        (sql, params) => exhibitsSqlite.prepare(sql).all(...params) as Row[],
        (row) => titleOf(t.definition, row)
      )
    );
  },
};

// Event catalog entries for every visible type (see eventCatalogSync.ts).
export function typeEventCatalog(): { name: string; events: ManifestEvent[] }[] {
  const events = listTypes().flatMap((t) => {
    const d = t.definition;
    const payloadFields = {
      recordId: { type: "string" as const, description: `The ${d.label.toLowerCase()}'s id` },
      title: { type: "string" as const, description: "Its title" },
      url: { type: "string" as const, description: "Link to open it" },
    };
    return (["created", "updated", "deleted"] as const).map((verb) => ({
      type: `${d.eventPrefix}.${verb}`,
      label: `${d.label} ${verb}`,
      payloadFields,
    }));
  });
  return [{ name: "types", events }];
}
