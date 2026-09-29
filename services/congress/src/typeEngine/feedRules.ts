import type { FeedCandidate, FeedPreview, FeedRule, TypeDefinition } from "@congress/shared-types";
import { closeness, plainTextPreview } from "@congress/chamber-kit";
import { quoteIdent } from "./ddl.js";
import { decodeValue, encodeValue } from "./codec.js";
import type { Stored } from "./casts.js";

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
      const col = quoteIdent(field(w.field).column);
      const windowMs = w.hours * HOUR;
      clauses.push(`${col} IS NOT NULL AND ${col} >= ? AND ${col} <= ?`);
      params.push(t, t + windowMs);
      // Sooner scores higher, down to 70% of the rule's score at the edge.
      score = (row) => Math.round(rule.score * (0.7 + 0.3 * closeness(Number(row[field(w.field).column]) - t, windowMs)));
      break;
    }
    case "overdue": {
      const col = quoteIdent(field(w.field).column);
      clauses.push(`${col} IS NOT NULL AND ${col} < ?`);
      params.push(t);
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
  }
  for (const c of rule.and ?? []) {
    const f = field(c.field);
    const encoded = c.value === null ? null : encodeValue(f, c.value);
    if (encoded === null) clauses.push(`${quoteIdent(f.column)} IS NULL`);
    else {
      clauses.push(`${quoteIdent(f.column)} = ?`);
      params.push(encoded);
    }
  }
  return { where: clauses.join(" AND "), params, score };
}

export function previewFor(def: TypeDefinition, rule: FeedRule, row: Record<string, Stored>, title: string): FeedPreview {
  const preview: FeedPreview = { title: title.slice(0, 200) };
  const fields: string[] = [];
  for (const id of rule.preview ?? []) {
    const f = def.fields.find((x) => x.id === id && !x.retired);
    if (!f) continue;
    const value = decodeValue(f, row[f.column]);
    if (value === null || value === "") continue;
    if (f.kind === "datetime" && !preview.time) preview.time = { start: String(value) };
    else if (f.kind === "richtext" && !preview.body) preview.body = (plainTextPreview(String(value)) ?? "").slice(0, 400) || undefined;
    else if (f.kind === "boolean") fields.push(`${f.label}: ${value ? "yes" : "no"}`);
    else if (f.kind === "enum") fields.push(f.options.options?.find((o) => o.value === value)?.label ?? String(value));
    else if (f.id !== def.titleField) fields.push(String(value).slice(0, 80));
  }
  if (fields.length) preview.fields = fields.slice(0, 4);
  return preview;
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
