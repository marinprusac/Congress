import { randomBytes } from "node:crypto";

// Lowercase ULIDs: 48-bit time + 80 random bits, Crockford base32. Sortable
// by creation time; `at` lets imports keep a record's original time.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function ulid(at: number = Date.now()): string {
  let time = "";
  let t = Math.max(0, Math.floor(at));
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
  return time + rand;
}

export const ULID_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;
