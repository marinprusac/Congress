import { describe, expect, it } from "vitest";
import { ulid, ULID_PATTERN } from "./ulid.js";

describe("ulid", () => {
  it("sorts by creation, even within one millisecond", () => {
    const ids = Array.from({ length: 50 }, () => ulid(1_700_000_000_000));
    expect(ids.every((id) => ULID_PATTERN.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
    expect(ulid(1_700_000_000_001) > ids.at(-1)!).toBe(true);
  });
});
