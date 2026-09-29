import { z } from "zod";
import type { FieldDefinition, RecordValue, TypeDefinition } from "@congress/shared-types";
import { activeFields } from "./operations.js";
import type { Stored } from "./casts.js";

// Pure: API values <-> stored SQLite values, and input validation built from
// a definition. Datetimes are ISO strings in the API, epoch ms at rest.

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
    case "enum":
    case "relation":
      return v === null ? null : String(v);
  }
}

export function encodeValue(f: FieldDefinition, value: RecordValue): Stored {
  switch (f.kind) {
    case "text":
    case "richtext":
      return typeof value === "string" ? value : "";
    case "boolean":
      return value ? 1 : 0;
    case "datetime":
      return typeof value === "string" ? Date.parse(value) : null;
    case "number":
      return typeof value === "number" ? value : null;
    case "enum":
    case "relation":
      return typeof value === "string" && value ? value : null;
  }
}

function fieldSchema(f: FieldDefinition, requireValue: boolean): z.ZodTypeAny {
  const required = requireValue && Boolean(f.options.required);
  switch (f.kind) {
    case "text":
      return required ? z.string().trim().min(1, `${f.label} is required`).max(MAX_TEXT) : z.string().max(MAX_TEXT);
    case "richtext":
      return required ? z.string().trim().min(1, `${f.label} is required`).max(MAX_TEXT) : z.string().max(MAX_TEXT);
    case "boolean":
      return z.boolean();
    case "datetime": {
      const s = z.string().refine((v) => Number.isFinite(Date.parse(v)), "not a date");
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
  }
}

// Values keyed by field slug. Create enforces `required`; patch only
// validates the fields it's given, but can't blank a required one either.
export function recordInputSchema(def: TypeDefinition, mode: "create" | "patch") {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of activeFields(def)) {
    const s = fieldSchema(f, true);
    shape[f.slug] = mode === "create" && f.options.required ? s : s.optional();
  }
  return z.object(shape).strict();
}

export function defaultValue(f: FieldDefinition): RecordValue {
  if (f.kind === "relation" && f.options.many) return [];
  return decodeValue(f, f.kind === "text" || f.kind === "richtext" ? "" : f.kind === "boolean" ? 0 : null);
}
