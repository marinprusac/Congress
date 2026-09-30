import { randomBytes } from "node:crypto";

// Lowercase ULIDs: 48-bit time + 80 random bits, Crockford base32. Sortable
// by creation time; `at` lets imports keep a record's original time.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

let lastTime = -1;
let lastRand: number[] = [];

// Within one millisecond the random part counts up, so ids still sort by creation.
function nextRand(t: number): number[] {
  if (t === lastTime) {
    const next = [...lastRand];
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i]! < 31) {
        next[i]!++;
        break;
      }
      next[i] = 0;
    }
    lastRand = next;
    return next;
  }
  const bytes = randomBytes(16);
  lastTime = t;
  lastRand = [...bytes].map((b) => b % 32);
  // Leave headroom so counting up doesn't wrap.
  lastRand[0] = lastRand[0]! % 16;
  return lastRand;
}

export function ulid(at: number = Date.now()): string {
  let time = "";
  let t = Math.max(0, Math.floor(at));
  const rand = nextRand(t);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + rand.map((d) => ALPHABET[d]).join("");
}

export const ULID_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;
