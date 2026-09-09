import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dateInputToIso, isoToDateInput } from "./dateInput.js";

// Regression coverage for the "notifications fire hours late" bug: a bare
// "YYYY-MM-DD" (what <input type="date"> produces) must resolve to local
// midnight, not UTC midnight - `new Date("2026-09-09")` alone silently
// picks the latter, which sent a task's overdue instant hours later than
// the picker's own local midnight for anyone east of UTC (2 hours during
// Zagreb's CEST).
// Frontend tsconfig has no Node types (browser code never sees `process`),
// so the TZ env mutation below goes through `globalThis` with an explicit
// `any` rather than a typed `process.env` reference.
const nodeProcess = (globalThis as { process?: { env: Record<string, string | undefined> } }).process!;

describe("dateInputToIso / isoToDateInput", () => {
  const originalTZ = nodeProcess.env.TZ;

  beforeEach(() => {
    // Simulates a browser in Zagreb during CEST (UTC+2) regardless of the
    // machine actually running the test.
    nodeProcess.env.TZ = "Europe/Zagreb";
  });

  afterEach(() => {
    nodeProcess.env.TZ = originalTZ;
  });

  it("resolves a date-only value to that day's local midnight, not UTC midnight", () => {
    const iso = dateInputToIso("2026-09-09");
    // Local midnight in Zagreb (UTC+2) is 22:00 UTC the day before - the
    // naive `new Date("2026-09-09")` (UTC midnight) would instead resolve
    // two hours later than this.
    expect(iso).toBe("2026-09-08T22:00:00.000Z");
  });

  it("round-trips back to the same calendar date the picker showed", () => {
    const iso = dateInputToIso("2026-09-09");
    expect(isoToDateInput(iso)).toBe("2026-09-09");
  });

  it("reads the local calendar date even when the UTC date differs", () => {
    // 2026-09-08T22:00:00.000Z is 2026-09-09 00:00 local in Zagreb - a
    // UTC-based `.slice(0, 10)` would wrongly report the 8th.
    expect(isoToDateInput("2026-09-08T22:00:00.000Z")).toBe("2026-09-09");
  });
});
