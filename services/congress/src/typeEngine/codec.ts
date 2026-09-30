import { z } from "zod";
import type { FieldDefinition, RecordValue, TypeDefinition } from "@congress/shared-types";
import { activeFields } from "./operations.js";
import type { Stored } from "./casts.js";
import { DATE_PATTERN, dayOf, isValidDate } from "./zone.js";
import { cleanKeyText, invalidKeyValues } from "./keyValues.js";

// Pure: API values <-> stored SQLite values, and input validation built from
// a definition. Datetimes are ISO strings in the API, epoch ms at rest; dates
// are YYYY-MM-DD both ways; a file is its id at rest (records.ts expands it).

const MAX_TEXT = 200_000;

export function decodeValue(f: FieldDefinition, stored: Stored | undefined): RecordValue {
  const v = stored ?? null;
  switch (f.kind) {
    case "text":
    case "richtext":
      return v === null ? "" : String(v);
    case "boolean":
      return Number(v) === 1;
    case "datetime":
      return v === null ? null : new Date(Number(v)).toISOString();
    case "number":
      return v === null ? null : Number(v);
    case "date":
    case "enum":
    case "relation":
    case "file":
      return v === null ? null : String(v);
  }
}

export function encodeValue(f: FieldDefinition, value: RecordValue): Stored {
  switch (f.kind) {
    case "text":
      if (typeof value !== "string") return "";
      return f.options.key ? cleanKeyText(value) : value;
    case "richtext":
      return typeof value === "string" ? value : "";
    case "boolean":
      return value ? 1 : 0;
    case "datetime":
      return typeof value === "string" ? Date.parse(value) : null;
    case "date": {
      if (typeof value !== "string") return null;
      if (DATE_PATTERN.test(value)) return isValidDate(value) ? value : null;
      // A full timestamp (lenient MCP input) names its day in the owner's zone.
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? dayOf(ms) : null;
    }
    case "number":
      return typeof value === "number" ? value : null;
    case "enum":
    case "relation":
    case "file":
      return typeof value === "string" && value ? value : null;
  }
}

function fieldSchema(f: FieldDefinition, requireValue: boolean): z.ZodTypeAny {
  const required = requireValue && Boolean(f.options.required);
  switch (f.kind) {
    case "text": {
      const s = required ? z.string().trim().min(1, `${f.label} is required`).max(MAX_TEXT) : z.string().max(MAX_TEXT);
      const kind = f.options.key;
      if (!kind) return s;
      return s.superRefine((v, ctx) => {
        const bad = invalidKeyValues(kind, v);
        if (bad.length) ctx.addIssue({ code: "custom", message: `not ${kind === "email" ? "an email" : "a phone number"}: ${bad.join(", ")}` });
      });
    }
    case "richtext":
      return required ? z.string().trim().min(1, `${f.label} is required`).max(MAX_TEXT) : z.string().max(MAX_TEXT);
    case "boolean":
      return z.boolean();
    case "datetime": {
      const s = z.string().refine((v) => Number.isFinite(Date.parse(v)), "not a date");
      return required ? s : s.nullable();
    }
    case "date": {
      // YYYY-MM-DD must be a real day (Date.parse rolls 02-30 into March).
      const s = z.string().refine((v) => (DATE_PATTERN.test(v) ? isValidDate(v) : Number.isFinite(Date.parse(v))), "not a date (YYYY-MM-DD)");
      return required ? s : s.nullable();
    }
    case "number": {
      const n = f.options.integer ? z.number().int() : z.number().finite();
      return required ? n : n.nullable();
    }
    case "enum": {
      const values = (f.options.options ?? []).map((o) => o.value);
      const e = z.string().refine((v) => values.includes(v), `must be one of ${values.join(", ")}`);
      return required ? e : e.nullable();
    }
    case "relation":
      if (f.options.many) return z.array(z.string().min(1)).max(500);
      return required ? z.string().min(1) : z.string().min(1).nullable();
    case "file":
      return required ? z.string().min(1) : z.string().min(1).nullable();
  }
}

// Values keyed by field slug. Create enforces `required`; patch only
// validates the fields it's given, but can't blank a required one either.
// Readonly fields are engine-written, so only trusted callers (imports) pass them.
export function recordInputSchema(def: TypeDefinition, mode: "create" | "patch", opts: { includeReadonly?: boolean } = {}) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of activeFields(def)) {
    if (f.options.readonly && !opts.includeReadonly) continue;
    const s = fieldSchema(f, true);
    shape[f.slug] = mode === "create" && f.options.required ? s : s.optional();
  }
  return z.object(shape).strict();
}

export function defaultValue(f: FieldDefinition): RecordValue {
  if (f.kind === "relation" && f.options.many) return [];
  return decodeValue(f, f.kind === "text" || f.kind === "richtext" ? "" : f.kind === "boolean" ? 0 : null);
}
