import { and, eq, inArray } from "drizzle-orm";
import type { FieldDefinition, RecordDto, RecordValue, TypeDefinition } from "@congress/shared-types";
import { extractOutgoingExhibitRefs } from "@congress/chamber-kit";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { records, recordRefs } from "./db/schema.js";
import { getType, getTypeBySlug, type StoredType } from "./store.js";
import { activeFields } from "./operations.js";
import { isJoinField, quoteIdent } from "./ddl.js";
import { decodeValue, defaultValue, encodeValue, recordInputSchema } from "./codec.js";
import { ulid } from "./ulid.js";
import { syncExhibit } from "../exhibits.js";
import { publishEvent } from "../events.js";
import type { Stored } from "./casts.js";

// Generic CRUD over type tables. Every write re-syncs the exhibit cache and
// publishes <eventPrefix>.created|updated|deleted.

export const NAMESPACE = "e";
export const EVENT_SOURCE = "types";

export class RecordNotFoundError extends Error {}
export class RecordValidationError extends Error {
  constructor(public readonly issues: unknown) {
    super("invalid record");
  }
}
export class RecordConflictError extends Error {
  constructor(public readonly field: string) {
    super(`another record already has this ${field}`);
  }
}

type Row = Record<string, Stored>;

export function recordUrl(id: string): string {
  return `/${id}`;
}

export function titleOf(def: TypeDefinition, row: Row): string {
  const f = def.fields.find((x) => x.id === def.titleField);
  const title = f ? String(row[f.column] ?? "").trim() : "";
  return title || `Untitled ${def.label.toLowerCase()}`;
}

export function typeOfRecord(id: string): StoredType | undefined {
  const row = exhibitsDb.select().from(records).where(eq(records.id, id)).get();
  return row ? getType(row.typeId) : undefined;
}

export function readRow(def: TypeDefinition, id: string): Row | undefined {
  return exhibitsSqlite.prepare(`SELECT * FROM ${quoteIdent(def.tableName)} WHERE "id" = ?`).get(id) as Row | undefined;
}

function joinValues(f: FieldDefinition, id: string): string[] {
  return (
    exhibitsSqlite.prepare(`SELECT "to_id" FROM ${quoteIdent(f.column)} WHERE "from_id" = ? ORDER BY "position"`).all(id) as {
      to_id: string;
    }[]
  ).map((r) => r.to_id);
}

export function toDto(t: StoredType, row: Row): RecordDto {
  const values: Record<string, RecordValue> = {};
  for (const f of activeFields(t.definition)) {
    values[f.slug] = isJoinField(f) ? joinValues(f, String(row.id)) : decodeValue(f, row[f.column]);
  }
  return {
    id: String(row.id),
    type: t.definition.slug,
    typeVersion: t.version,
    values,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    provenance: row.source_binding ? { binding: String(row.source_binding), key: String(row.source_key) } : null,
  };
}

export function getRecord(id: string): RecordDto | null {
  const t = typeOfRecord(id);
  if (!t) return null;
  const row = readRow(t.definition, id);
  return row ? toDto(t, row) : null;
}

export function listRecords(typeSlug: string, opts: { limit?: number; offset?: number } = {}): RecordDto[] {
  const t = getTypeBySlug(typeSlug);
  if (!t) throw new RecordNotFoundError(`no type "${typeSlug}"`);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = exhibitsSqlite
    .prepare(`SELECT * FROM ${quoteIdent(t.definition.tableName)} ORDER BY "updated_at" DESC LIMIT ? OFFSET ?`)
    .all(limit, Math.max(opts.offset ?? 0, 0)) as Row[];
  return rows.map((r) => toDto(t, r));
}

function parseInput(def: TypeDefinition, mode: "create" | "patch", values: unknown): Record<string, RecordValue> {
  const parsed = recordInputSchema(def, mode).safeParse(values ?? {});
  if (!parsed.success) throw new RecordValidationError(parsed.error.flatten());
  return parsed.data as Record<string, RecordValue>;
}

function rethrowConflict(def: TypeDefinition, err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
    const column = /\.(\w+)$/.exec(e.message ?? "")?.[1];
    const f = def.fields.find((x) => x.column === column);
    throw new RecordConflictError(f?.slug ?? column ?? "value");
  }
  throw err;
}

function writeJoin(f: FieldDefinition, id: string, ids: string[]): void {
  exhibitsSqlite.prepare(`DELETE FROM ${quoteIdent(f.column)} WHERE "from_id" = ?`).run(id);
  const insert = exhibitsSqlite.prepare(`INSERT OR IGNORE INTO ${quoteIdent(f.column)} ("from_id", "to_id", "position") VALUES (?, ?, ?)`);
  ids.forEach((to, i) => insert.run(id, to, i));
}

export interface CreateOptions {
  actor?: string;
  id?: string;
  at?: Date;
  updatedAt?: Date;
  silent?: boolean;
}

export function createRecord(typeSlug: string, values: unknown, opts: CreateOptions = {}): RecordDto {
  const t = getTypeBySlug(typeSlug);
  if (!t) throw new RecordNotFoundError(`no type "${typeSlug}"`);
  const def = t.definition;
  const input = parseInput(def, "create", values);
  const at = opts.at ?? new Date();
  const id = opts.id ?? ulid(at.getTime());
  const updatedAt = opts.updatedAt ?? at;

  const cols = ["id", "created_at", "updated_at"];
  const params: Stored[] = [id, at.getTime(), updatedAt.getTime()];
  const fields = activeFields(def);
  for (const f of fields) {
    if (isJoinField(f)) continue;
    cols.push(f.column);
    params.push(encodeValue(f, input[f.slug] ?? defaultValue(f)));
  }

  try {
    exhibitsSqlite.transaction(() => {
      exhibitsDb.insert(records).values({ id, typeId: t.id, createdAt: at }).run();
      exhibitsSqlite
        .prepare(`INSERT INTO ${quoteIdent(def.tableName)} (${cols.map(quoteIdent).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .run(...params);
      for (const f of fields) if (isJoinField(f)) writeJoin(f, id, (input[f.slug] as string[] | undefined) ?? []);
    })();
  } catch (err) {
    rethrowConflict(def, err);
  }

  const dto = getRecord(id)!;
  syncRecordExhibit(t, id);
  if (!opts.silent) emit(t, "created", dto, opts.actor);
  return dto;
}

export function updateRecord(id: string, patch: unknown, opts: { actor?: string } = {}): RecordDto {
  const t = typeOfRecord(id);
  if (!t) throw new RecordNotFoundError(`no record ${id}`);
  const def = t.definition;
  const input = parseInput(def, "patch", patch);
  const fields = activeFields(def).filter((f) => f.slug in input);

  const sets: string[] = [`"updated_at" = ?`];
  const params: Stored[] = [Date.now()];
  for (const f of fields) {
    if (isJoinField(f)) continue;
    sets.push(`${quoteIdent(f.column)} = ?`);
    params.push(encodeValue(f, input[f.slug]!));
  }

  try {
    exhibitsSqlite.transaction(() => {
      const res = exhibitsSqlite.prepare(`UPDATE ${quoteIdent(def.tableName)} SET ${sets.join(", ")} WHERE "id" = ?`).run(...params, id);
      if (res.changes === 0) throw new RecordNotFoundError(`no record ${id}`);
      for (const f of fields) if (isJoinField(f)) writeJoin(f, id, input[f.slug] as string[]);
    })();
  } catch (err) {
    rethrowConflict(def, err);
  }

  const dto = getRecord(id)!;
  syncRecordExhibit(t, id);
  emit(t, "updated", dto, opts.actor, fields.map((f) => f.slug));
  return dto;
}

export function deleteRecord(id: string, opts: { actor?: string } = {}): void {
  const t = typeOfRecord(id);
  if (!t) throw new RecordNotFoundError(`no record ${id}`);
  const def = t.definition;
  const row = readRow(def, id);
  const dto = row ? toDto(t, row) : null;
  exhibitsSqlite.transaction(() => {
    exhibitsSqlite.prepare(`DELETE FROM ${quoteIdent(def.tableName)} WHERE "id" = ?`).run(id);
    for (const f of def.fields) if (isJoinField(f)) exhibitsSqlite.prepare(`DELETE FROM ${quoteIdent(f.column)} WHERE "from_id" = ?`).run(id);
    exhibitsDb.delete(recordRefs).where(eq(recordRefs.recordId, id)).run();
    exhibitsDb.delete(records).where(eq(records.id, id)).run();
  })();
  syncExhibit({ chamber: NAMESPACE, id, type: def.slug, name: "", url: "", deleted: true, outgoingRefs: [] });
  if (dto) emit(t, "deleted", dto, opts.actor);
}

export function manualRefs(id: string): string[] {
  return exhibitsDb
    .select({ target: recordRefs.targetExhibitId })
    .from(recordRefs)
    .where(eq(recordRefs.recordId, id))
    .all()
    .map((r) => r.target);
}

export function addManualRef(id: string, target: string): string[] | null {
  const t = typeOfRecord(id);
  if (!t || target === id) return null;
  exhibitsDb.insert(recordRefs).values({ recordId: id, targetExhibitId: target, createdAt: new Date() }).onConflictDoNothing().run();
  syncRecordExhibit(t, id);
  return manualRefs(id);
}

export function removeManualRef(id: string, target: string): string[] | null {
  const t = typeOfRecord(id);
  if (!t) return null;
  exhibitsDb.delete(recordRefs).where(and(eq(recordRefs.recordId, id), eq(recordRefs.targetExhibitId, target))).run();
  syncRecordExhibit(t, id);
  return manualRefs(id);
}

// Outgoing refs: tokens in richtext fields, relation values, manual refs.
export function outgoingRefs(t: StoredType, id: string, row: Row): string[] {
  const refs = new Set<string>();
  for (const f of activeFields(t.definition)) {
    if (f.kind === "richtext") for (const r of extractOutgoingExhibitRefs(String(row[f.column] ?? ""))) refs.add(r);
    else if (isJoinField(f)) for (const r of joinValues(f, id)) refs.add(r);
    else if (f.kind === "relation" && row[f.column]) refs.add(String(row[f.column]));
  }
  for (const r of manualRefs(id)) refs.add(r);
  refs.delete(id);
  return [...refs];
}

export function syncRecordExhibit(t: StoredType, id: string): void {
  const row = readRow(t.definition, id);
  if (!row) return;
  syncExhibit({
    chamber: NAMESPACE,
    id,
    type: t.definition.slug,
    name: titleOf(t.definition, row),
    url: recordUrl(id),
    outgoingRefs: outgoingRefs(t, id, row),
    manualRefs: manualRefs(id),
  });
}

function emit(t: StoredType, verb: "created" | "updated" | "deleted", dto: RecordDto, actor?: string, changed?: string[]) {
  const def = t.definition;
  const titleField = def.fields.find((f) => f.id === def.titleField);
  publishEvent({
    chamber: EVENT_SOURCE,
    type: `${def.eventPrefix}.${verb}`,
    payload: {
      recordId: dto.id,
      type: def.slug,
      title: (titleField && String(dto.values[titleField.slug] ?? "")) || "",
      url: `/e/${dto.id}`,
      ...(changed ? { changed } : {}),
    },
    ...(actor ? { actor } : {}),
  });
}

export function idsOfType(typeId: string): string[] {
  return exhibitsDb.select({ id: records.id }).from(records).where(eq(records.typeId, typeId)).all().map((r) => r.id);
}

export function existingRecordIds(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(exhibitsDb.select({ id: records.id }).from(records).where(inArray(records.id, ids)).all().map((r) => r.id));
}
