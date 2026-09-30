import { WIKILINK_PATTERN } from "../../kit/wikilinks.js";
import type { Binding, FactCondition, FieldDefinition, FieldKind, RecordValue, TypeDefinition } from "@congress/shared-types";
import { parseExhibitToken } from "@congress/shared-types";
import type { SourceKind, SourceValue } from "../../connectors/contract.js";

// Pure: how a binding's source values map onto a type's fields and back.

type SourceField = SourceKind["fields"][number];

// Target kind -> source kinds it can hold.
const ACCEPTS: Record<FieldKind, FieldKind[]> = {
  text: ["text", "enum"],
  richtext: ["text", "richtext"],
  boolean: ["boolean"],
  datetime: ["datetime"],
  date: ["date", "datetime"],
  number: ["number"],
  enum: ["enum", "text"],
  relation: ["relation"],
  file: [],
};

export function fieldProblem(source: SourceField, target: FieldDefinition, mode: "sync" | "pull"): string | null {
  const name = `"${source.slug}" → "${target.slug}"`;
  if (source.kind === "relation") {
    if (target.kind !== "relation") return `${name}: a relation only maps to a relation`;
    if (source.target !== target.options.target) return `${name}: links ${source.target ?? "?"}, the field links ${target.options.target ?? "?"}`;
    if (Boolean(source.many) !== Boolean(target.options.many)) return `${name}: one vs many links`;
    return mode === "pull" ? null : `${name}: relations can only be pulled`;
  }
  if (source.many) return target.kind === "text" && mode === "pull" ? null : `${name}: a list only pulls into text`;
  if (!ACCEPTS[target.kind].includes(source.kind)) return `${name}: ${source.kind} can't fill a ${target.kind} field`;
  if (mode === "sync" && target.kind === "date" && source.kind === "datetime") return `${name}: a date can't be pushed as a time`;
  return null;
}

// Checks a binding against the connector's source schema (when it's running).
export function bindingProblems(def: TypeDefinition, b: Binding, kind: SourceKind | undefined, hasPush: boolean): string[] {
  if (!kind) return [`${b.connector} has no source kind "${b.kind}"`];
  const problems: string[] = [];
  const bySlug = new Map(kind.fields.map((f) => [f.slug, f]));
  const facts = new Set(kind.facts.map((f) => f.slug));
  for (const m of b.fields) {
    const source = bySlug.get(m.source);
    const target = def.fields.find((f) => f.id === m.target);
    if (!source) problems.push(`${b.connector} ${b.kind} has no field "${m.source}"`);
    else if (target) {
      const p = fieldProblem(source, target, m.mode);
      if (p) problems.push(p);
    }
  }
  const conditions = [...(b.lock ? [b.lock] : []), ...b.actions.flatMap((a) => [...a.when, ...a.unless])];
  for (const c of conditions) if (!facts.has(c.fact)) problems.push(`${b.connector} ${b.kind} has no fact "${c.fact}"`);
  const pushes = b.fields.some((m) => m.mode === "sync") || b.create || b.delete === "push" || b.actions.length > 0;
  if (pushes && !hasPush) problems.push(`${b.connector} can't write back; bind its fields as pull and delete as never`);
  return problems;
}

export function factHolds(c: FactCondition, facts: Record<string, SourceValue>): boolean {
  const v = facts[c.fact];
  return c.equals === undefined ? Boolean(v) : v === c.equals;
}

// "[[exhibit:e:01..|Ana]] lunch" -> "Ana lunch": what a plain-text source sees.
export function projectRich(rich: string): string {
  return rich.replace(WIKILINK_PATTERN, (match, rawTarget: string, rawAlias?: string) => {
    const parsed = parseExhibitToken(rawTarget?.trim() ?? "");
    if (!parsed) return match;
    return rawAlias?.trim() || parsed.id;
  });
}

// Source value -> record input value for `target` (trusted input form).
export function toTargetValue(value: SourceValue | undefined, target: FieldDefinition): RecordValue {
  if (value === undefined || value === null) {
    if (target.kind === "relation" && target.options.many) return [];
    if (target.kind === "text" || target.kind === "richtext") return "";
    return target.kind === "boolean" ? false : null;
  }
  if (Array.isArray(value)) return target.kind === "relation" ? value : value.join("\n");
  switch (target.kind) {
    case "text":
    case "richtext":
      return String(value);
    case "boolean":
      return Boolean(value);
    case "number":
      return typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : null;
    case "datetime":
    case "date": {
      const ms = typeof value === "number" ? value : Date.parse(String(value));
      if (target.kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    case "enum":
      return (target.options.options ?? []).some((o) => o.value === String(value)) ? String(value) : null;
    case "relation":
      return String(value);
    case "file":
      return null;
  }
}

// Record value -> what the source is sent.
export function toSourceValue(value: RecordValue | undefined, target: FieldDefinition): SourceValue {
  if (value === undefined) return null;
  if (target.kind === "richtext") return projectRich(String(value ?? ""));
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value.id;
  return value;
}

// Only the fields this binding maps, for the shadow and comparisons.
export function mappedValues(b: Binding, values: Record<string, SourceValue>): Record<string, SourceValue> {
  const out: Record<string, SourceValue> = {};
  for (const m of b.fields) out[m.source] = values[m.source] ?? null;
  return out;
}

export const sameValue = (a: SourceValue | undefined, b: SourceValue | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Locks {
  locked: string[];
  reason: string | null;
}

// Which fields the owner can't edit on a bound record; `facts` null = the
// source no longer has it (e.g. outside its sync window).
export function computeLocks(def: TypeDefinition, b: Binding, facts: Record<string, SourceValue> | null): Locks {
  const slug = (id: string) => def.fields.find((f) => f.id === id && !f.retired)?.slug;
  const pulled = b.fields.filter((m) => m.mode === "pull").map((m) => slug(m.target));
  const synced = b.fields.filter((m) => m.mode === "sync").map((m) => slug(m.target));
  const clean = (xs: (string | undefined)[]) => xs.filter((x): x is string => Boolean(x));
  if (!facts) return { locked: clean([...pulled, ...synced]), reason: `No longer in ${b.label}, so it can't be edited here` };
  if (b.lock && !factHolds(b.lock, facts)) return { locked: clean([...pulled, ...synced]), reason: `Read-only in ${b.label}` };
  return { locked: clean(pulled), reason: null };
}

export function availableActions(b: Binding, facts: Record<string, SourceValue> | null) {
  if (!facts) return [];
  return b.actions.filter((a) => a.when.every((c) => factHolds(c, facts)) && !a.unless.some((c) => factHolds(c, facts)));
}
