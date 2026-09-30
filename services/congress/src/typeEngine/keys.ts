import { and, eq } from "drizzle-orm";
import type { KeyKind, TypeDefinition } from "@congress/shared-types";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { recordKeys } from "./db/schema.js";
import { activeFields } from "./operations.js";
import { quoteIdent } from "./ddl.js";
import { normalizeKey, splitKeyText } from "./keyValues.js";
import type { Stored } from "./casts.js";

// record_keys: every key field value, normalized, unique per type and kind.

export class KeyConflictError extends Error {
  constructor(
    public readonly field: string,
    public readonly kind: KeyKind,
    public readonly value: string
  ) {
    super(`another record already has the ${kind} ${value}`);
  }
}

interface KeyRow {
  kind: KeyKind;
  value: string;
  fieldId: string;
  fieldSlug: string;
}

// A key field's values, normalized and deduped within the record.
export function keysOf(def: TypeDefinition, row: Record<string, Stored>): KeyRow[] {
  const out = new Map<string, KeyRow>();
  for (const f of activeFields(def)) {
    const kind = f.options.key;
    if (!kind || f.kind !== "text") continue;
    for (const raw of splitKeyText(String(row[f.column] ?? ""))) {
      const value = normalizeKey(kind, raw);
      if (value && !out.has(`${kind}:${value}`)) out.set(`${kind}:${value}`, { kind, value, fieldId: f.id, fieldSlug: f.slug });
    }
  }
  return [...out.values()];
}

export function hasKeys(def: TypeDefinition): boolean {
  return activeFields(def).some((f) => f.kind === "text" && f.options.key);
}

// Call inside the record write's transaction; a clash throws and rolls it back.
export function writeKeys(typeId: string, def: TypeDefinition, id: string, row: Record<string, Stored>): void {
  exhibitsDb.delete(recordKeys).where(eq(recordKeys.recordId, id)).run();
  for (const k of keysOf(def, row)) {
    const taken = findByKey(typeId, k.kind, k.value);
    if (taken) throw new KeyConflictError(k.fieldSlug, k.kind, k.value);
    exhibitsDb.insert(recordKeys).values({ typeId, kind: k.kind, value: k.value, recordId: id, fieldId: k.fieldId }).run();
  }
}

export function deleteKeys(id: string): void {
  exhibitsDb.delete(recordKeys).where(eq(recordKeys.recordId, id)).run();
}

export function findByKey(typeId: string, kind: KeyKind, value: string): string | undefined {
  return exhibitsDb
    .select({ id: recordKeys.recordId })
    .from(recordKeys)
    .where(and(eq(recordKeys.typeId, typeId), eq(recordKeys.kind, kind), eq(recordKeys.value, value)))
    .get()?.id;
}

// Keys the definition implies for every record, and which of them clash.
function scan(def: TypeDefinition): { rows: { id: string; keys: KeyRow[] }[]; clashes: Map<string, number> } {
  const all = exhibitsSqlite.prepare(`SELECT * FROM ${quoteIdent(def.tableName)}`).all() as Record<string, Stored>[];
  const rows = all.map((r) => ({ id: String(r.id), keys: keysOf(def, r) }));
  const counts = new Map<string, number>();
  for (const r of rows) for (const k of r.keys) counts.set(`${k.kind} ${k.value}`, (counts.get(`${k.kind} ${k.value}`) ?? 0) + 1);
  return { rows, clashes: new Map([...counts].filter(([, n]) => n > 1)) };
}

// Preview/publish blockers: values more than one record shares.
export function keyClashes(def: TypeDefinition): { label: string; count: number }[] {
  if (!hasKeys(def)) return [];
  return [...scan(def).clashes].map(([key, n]) => ({ label: `records sharing the key ${key}`, count: n }));
}

// After a publish that changed which fields are keys; inside its transaction.
export function rebuildKeys(typeId: string, def: TypeDefinition): void {
  exhibitsDb.delete(recordKeys).where(eq(recordKeys.typeId, typeId)).run();
  const { rows } = scan(def);
  for (const r of rows) {
    for (const k of r.keys) {
      exhibitsDb.insert(recordKeys).values({ typeId, kind: k.kind, value: k.value, recordId: r.id, fieldId: k.fieldId }).run();
    }
  }
}

// Which active fields are keys, and of what; a change means rebuildKeys.
export function keySignature(def: TypeDefinition | undefined): string {
  if (!def) return "";
  return activeFields(def)
    .filter((f) => f.kind === "text" && f.options.key)
    .map((f) => `${f.id}:${f.options.key}`)
    .sort()
    .join();
}
