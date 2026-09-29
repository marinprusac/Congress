import type { EnumOption, FieldKind } from "@congress/shared-types";

// Pure value conversion between field kinds, on stored (SQLite) values.
// Registered as the `te_cast` SQL function, so table rebuilds use it too.

export type Stored = string | number | null;

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "on", "x", "done", "✓"]);

export interface CastTarget {
  kind: FieldKind;
  integer?: boolean;
  options?: EnumOption[];
}

export function castStored(value: Stored, from: FieldKind, to: CastTarget): Stored {
  const text = asText(value, from);
  switch (to.kind) {
    case "text":
    case "richtext":
      return text;
    case "boolean":
      if (value === null) return 0;
      if (from === "boolean" || from === "number") return Number(value) !== 0 ? 1 : 0;
      if (from === "datetime") return 1;
      return TRUE_WORDS.has(text.trim().toLowerCase()) ? 1 : 0;
    case "number": {
      if (value === null) return null;
      const n = from === "boolean" || from === "datetime" || from === "number" ? Number(value) : Number(text.trim());
      if (text.trim() === "" || !Number.isFinite(n)) return null;
      return to.integer ? Math.round(n) : n;
    }
    case "datetime": {
      if (value === null) return null;
      if (from === "number" || from === "datetime") return Math.round(Number(value));
      if (from === "boolean") return null;
      const ms = Date.parse(text.trim());
      return Number.isFinite(ms) ? ms : null;
    }
    case "enum": {
      const t = text.trim().toLowerCase();
      if (!t) return null;
      const match = (to.options ?? []).find((o) => o.value.toLowerCase() === t || o.label.toLowerCase() === t);
      return match ? match.value : null;
    }
    case "relation":
      return typeof value === "string" && value ? value : null;
  }
}

function asText(value: Stored, from: FieldKind): string {
  if (value === null) return "";
  if (from === "boolean") return Number(value) ? "true" : "false";
  if (from === "datetime" && typeof value === "number") return new Date(value).toISOString();
  return String(value);
}

// SQL-callable form: te_cast(value, from, toJson).
export function sqlCast(value: unknown, from: unknown, toJson: unknown): Stored {
  const v = typeof value === "bigint" ? Number(value) : (value as Stored);
  return castStored(v ?? null, from as FieldKind, JSON.parse(String(toJson)) as CastTarget);
}
