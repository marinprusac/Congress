import type { KeyKind } from "@congress/shared-types";

// Pure: key fields hold one value per line; keys are their normalized forms.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitKeyText(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

// The lookup form of one value, or null when it isn't a valid email/phone.
export function normalizeKey(kind: KeyKind, raw: string): string | null {
  const v = raw.trim();
  if (kind === "email") {
    const email = v.toLowerCase();
    return EMAIL.test(email) ? email : null;
  }
  const digits = v.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 20) return null;
  if (v.startsWith("+")) return `+${digits}`;
  return digits.startsWith("00") ? `+${digits.slice(2)}` : digits;
}

// Stored text: one trimmed value per line, as written.
export function cleanKeyText(text: string): string {
  return splitKeyText(text).join("\n");
}

export function invalidKeyValues(kind: KeyKind, text: string): string[] {
  return splitKeyText(text).filter((v) => normalizeKey(kind, v) === null);
}
