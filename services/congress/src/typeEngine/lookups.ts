import type { AutoCreate, KeyKind, RecordValue } from "@congress/shared-types";
import { getTypeBySlug } from "./store.js";
import { activeFields } from "./operations.js";
import { findByKey } from "./keys.js";
import { normalizeKey } from "./keyValues.js";
import { createRecord, RecordConflictError, RecordNotFoundError, RecordValidationError } from "./records.js";

// Find a record by any of its keys (an email, a phone), or create one when the
// type's auto-create policy trusts where the key came from.

// owner: the owner or the AI in chat; corresponded: the owner wrote to them; seen: a source just saw it.
export type Evidence = "owner" | "corresponded" | "seen";

export interface LookupInput {
  keys: { kind: KeyKind; value: string }[];
  // Used only when creating; the title falls back to the first key.
  values?: Record<string, RecordValue>;
  evidence: Evidence;
  actor?: string;
}

export type LookupResult = { id: string; created: boolean } | { id: null; reason: "policy" };

const ALLOWED: Record<AutoCreate, Evidence[]> = {
  never: ["owner"],
  corresponded: ["owner", "corresponded"],
  any: ["owner", "corresponded", "seen"],
};

export function lookupOrCreate(slug: string, input: LookupInput): LookupResult {
  const t = getTypeBySlug(slug);
  if (!t) throw new RecordNotFoundError(`no type "${slug}"`);
  const def = t.definition;
  const keys = input.keys.flatMap((k) => {
    const value = normalizeKey(k.kind, k.value);
    return value ? [{ kind: k.kind, raw: k.value.trim(), value }] : [];
  });
  if (keys.length === 0) throw new RecordValidationError({ formErrors: ["no valid email or phone to look up"], fieldErrors: {} });

  const find = () => keys.map((k) => findByKey(t.id, k.kind, k.value)).find(Boolean);
  const found = find();
  if (found) return { id: found, created: false };
  if (!ALLOWED[def.autoCreate].includes(input.evidence)) return { id: null, reason: "policy" };

  const fields = activeFields(def);
  const values: Record<string, RecordValue> = { ...input.values };
  for (const kind of new Set(keys.map((k) => k.kind))) {
    const f = fields.find((x) => x.kind === "text" && x.options.key === kind);
    if (!f) throw new RecordValidationError({ formErrors: [`${def.label} has no ${kind} field`], fieldErrors: {} });
    const existing = typeof values[f.slug] === "string" ? String(values[f.slug]) : "";
    values[f.slug] = [existing, ...keys.filter((k) => k.kind === kind).map((k) => k.raw)].filter(Boolean).join("\n");
  }
  const title = fields.find((f) => f.id === def.titleField);
  if (title && !String(values[title.slug] ?? "").trim()) values[title.slug] = keys[0]!.raw;

  try {
    return { id: createRecord(slug, values, { actor: input.actor }).id, created: true };
  } catch (err) {
    // Someone else created it meanwhile.
    const again = err instanceof RecordConflictError ? find() : undefined;
    if (again) return { id: again, created: false };
    throw err;
  }
}
