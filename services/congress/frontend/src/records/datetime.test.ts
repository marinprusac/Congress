import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./datetime.js";

describe("datetime-local conversion", () => {
  it("round-trips through the local wall clock", () => {
    const iso = new Date(2026, 8, 30, 14, 5).toISOString();
    expect(toLocalInput(iso)).toBe("2026-09-30T14:05");
    expect(fromLocalInput("2026-09-30T14:05")).toBe(iso);
  });

  it("treats empty and invalid values as unset", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("garbage")).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("nope")).toBeNull();
  });
});
