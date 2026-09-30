import type { FeedCandidate, FeedPreview, FeedRule, TypeDefinition } from "@congress/shared-types";
import { closeness, plainTextPreview } from "@congress/chamber-kit";
import { quoteIdent } from "./ddl.js";
import { decodeValue, encodeValue } from "./codec.js";
import type { Stored } from "./casts.js";
import { dayOf, endOfDay } from "./zone.js";

// Pure: declarative feed rules compiled to SQL + scoring. A type's rules are
// its Chamber-free replacement for a hand-written feedRules.ts.

const HOUR = 3_600_000;
const PER_RULE_LIMIT = 20;

export interface CompiledRule {
  where: string;
  params: Stored[];
  score(row: Record<string, Stored>): number;
}

export function compileFeedRule(def: TypeDefinition, rule: FeedRule, now: Date): CompiledRule {
  const field = (id: string) => {
    const f = def.fields.find((x) => x.id === id && !x.retired);
    if (!f) throw new Error(`feed rule field ${id} is gone`);
    return f;
  };
  const t = now.getTime();
  const clauses: string[] = [];
  const params: Stored[] = [];
  let score = (_row: Record<string, Stored>) => rule.score;

  const w = rule.when;
  switch (w.op) {
    case "within_next": {
      const f = field(w.field);
      const col = quoteIdent(f.column);
      const windowMs = w.hours * HOUR;
      // A date is due until its day ends: in the window when that end is.
      if (f.kind === "date") {
        clauses.push(`${col} IS NOT NULL AND ${col} >= ? AND ${col} < ?`);
        params.push(dayOf(t), dayOf(t + windowMs));
      } else {
        clauses.push(`${col} IS NOT NULL AND ${col} >= ? AND ${col} <= ?`);
        params.push(t, t + windowMs);
      }
      const instant = (row: Record<string, Stored>) => (f.kind === "date" ? endOfDay(String(row[f.column])) : Number(row[f.column]));
      // Sooner scores higher, down to 70% of the rule's score at the edge.
      score = (row) => Math.round(rule.score * (0.7 + 0.3 * closeness(instant(row) - t, windowMs)));
      break;
    }
    case "within_last": {
      const f = field(w.field);
      const col = quoteIdent(f.column);
      const windowMs = w.hours * HOUR;
      clauses.push(`${col} IS NOT NULL AND ${col} <= ? AND ${col} >= ?`);
      if (f.kind === "date") params.push(dayOf(t), dayOf(t - windowMs));
      else params.push(t, t - windowMs);
      const instant = (row: Record<string, Stored>) => (f.kind === "date" ? endOfDay(String(row[f.column])) : Number(row[f.column]));
      score = (row) => Math.round(rule.score * (0.7 + 0.3 * closeness(t - instant(row), windowMs)));
      break;
    }
    case "overdue": {
      const f = field(w.field);
      const col = quoteIdent(f.column);
      clauses.push(`${col} IS NOT NULL AND ${col} < ?`);
      params.push(f.kind === "date" ? dayOf(t) : t);
      break;
    }
    case "eq": {
      const f = field(w.field);
      clauses.push(`${quoteIdent(f.column)} = ?`);
      params.push(encodeValue(f, w.value));
      break;
    }
    case "is_set": {
      const f = field(w.field);
      const col = quoteIdent(f.column);
      clauses.push(f.kind === "text" || f.kind === "richtext" ? `${col} <> ''` : f.kind === "boolean" ? `${col} = 1` : `${col} IS NOT NULL`);
      break;
    }
    case "updated_within":
      clauses.push(`"updated_at" >= ?`);
      params.push(t - w.hours * HOUR);
      break;
    case "ongoing": {
      const start = field(w.field);
      const end = field(w.end);
      const [s, e] = [quoteIdent(start.column), quoteIdent(end.column)];
      clauses.push(`${s} IS NOT NULL AND ${s} <= ? AND ${e} IS NOT NULL AND ${e} > ?`);
      params.push(start.kind === "date" ? dayOf(t) : t, end.kind === "date" ? dayOf(t) : t);
      break;
    }
  }
  const extra = andClauses(def, rule.and);
  clauses.push(...extra.clauses);
  params.push(...extra.params);
  return { where: clauses.join(" AND "), params, score };
}

export type Condition = NonNullable<FeedRule["and"]>[number];

// `and` conditions (field = value, null = unset) as SQL; shared with time triggers.
export function andClauses(def: TypeDefinition, conditions: Condition[] | undefined): { clauses: string[]; params: Stored[] } {
  const clauses: string[] = [];
  const params: Stored[] = [];
  for (const c of conditions ?? []) {
    const f = def.fields.find((x) => x.id === c.field && !x.retired);
    if (!f) throw new Error(`condition field ${c.field} is gone`);
    const encoded = c.value === null ? null : encodeValue(f, c.value);
    if (encoded === null) clauses.push(`${quoteIdent(f.column)} IS NULL`);
    else {
      clauses.push(`${quoteIdent(f.column)} = ?`);
      params.push(encoded);
    }
  }
  return { clauses, params };
}

export function previewFor(def: TypeDefinition, rule: FeedRule, row: Record<string, Stored>, title: string): FeedPreview {
  const preview: FeedPreview = { title: title.slice(0, 200) };
  const fields: string[] = [];
  for (const id of rule.preview ?? []) {
    const f = def.fields.find((x) => x.id === id && !x.retired);
    if (!f) continue;
    const value = decodeValue(f, row[f.column]);
    if (value === null || value === "") continue;
    if (f.kind === "datetime" && !preview.time) preview.time = { label: f.label.slice(0, 20), start: String(value) };
    else if (f.kind === "date" && !preview.time) preview.time = { label: f.label.slice(0, 20), start: String(value), allDay: true };
    else if (f.kind === "file") continue;
    else if (f.kind === "richtext" && !preview.body) preview.body = (plainTextPreview(String(value)) ?? "").slice(0, 400) || undefined;
    else if (f.kind === "boolean") fields.push(`${f.label}: ${value ? "yes" : "no"}`);
    else if (f.kind === "enum") fields.push(f.options.options?.find((o) => o.value === value)?.label ?? String(value));
    else if (f.id !== def.titleField) fields.push(String(value).slice(0, 80));
  }
  if (fields.length) preview.fields = fields.slice(0, 4);
  const range = timeRangeOf(def, row);
  if (range) preview.time = range;
  return preview;
}

// A type's paired start/end (all-day aware), as a feed time.
function timeRangeOf(def: TypeDefinition, row: Record<string, Stored>): FeedPreview["time"] | undefined {
  const r = def.layout.timeRange;
  if (!r) return undefined;
  const start = def.fields.find((f) => f.id === r.start && !f.retired);
  const end = def.fields.find((f) => f.id === r.end && !f.retired);
  const allDayField = r.allDay ? def.fields.find((f) => f.id === r.allDay && !f.retired) : undefined;
  if (!start) return undefined;
  const s = decodeValue(start, row[start.column]);
  if (s === null || s === "") return undefined;
  const e = end ? decodeValue(end, row[end.column]) : null;
  const allDay = start.kind === "date" || (allDayField ? decodeValue(allDayField, row[allDayField.column]) === true : false);
  return { start: String(s), ...(e ? { end: String(e) } : {}), ...(allDay ? { allDay: true } : {}) };
}

export type RowQuery = (sql: string, params: Stored[]) => Record<string, Stored>[];

export function feedCandidatesFor(
  def: TypeDefinition,
  now: Date,
  query: RowQuery,
  titleOf: (row: Record<string, Stored>) => string
): FeedCandidate[] {
  const out: FeedCandidate[] = [];
  for (const rule of def.feedRules) {
    let compiled: CompiledRule;
    try {
      compiled = compileFeedRule(def, rule, now);
    } catch {
      continue;
    }
    const rows = query(
      `SELECT * FROM ${quoteIdent(def.tableName)} WHERE ${compiled.where} ORDER BY "updated_at" DESC LIMIT ${PER_RULE_LIMIT}`,
      compiled.params
    );
    for (const row of rows) {
      out.push({
        kind: "exhibit",
        exhibitId: String(row.id),
        score: Math.max(0, Math.min(100, compiled.score(row))),
        ...(rule.reason ? { reason: rule.reason } : {}),
        preview: previewFor(def, rule, row, titleOf(row)),
      });
    }
  }
  return out;
}
