import type { KeyKind } from "@congress/shared-types";

// A key field's lines (server: typeEngine/keyValues.ts decides; this only
// keeps half-typed values out of autosave).

export function isValidKey(kind: KeyKind, raw: string): boolean {
  const v = raw.trim();
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const digits = v.replace(/\D/g, "").length;
  return digits >= 5 && digits <= 20;
}

export function toLines(value: string): string[] {
  return value.split("\n");
}

// What gets saved: the valid, non-empty lines.
export function savedText(kind: KeyKind, lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter((l) => l && isValidKey(kind, l))
    .join("\n");
}

export function keyHref(kind: KeyKind, value: string): string {
  return kind === "email" ? `mailto:${value.trim()}` : `tel:${value.replace(/[^\d+]/g, "")}`;
}
