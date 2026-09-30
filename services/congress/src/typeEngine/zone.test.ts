import { describe, expect, it } from "vitest";
import { addDays, dayOf, endOfDay, isValidDate, startOfDay } from "./zone.js";

const TZ = "Europe/Zagreb";
const iso = (ms: number) => new Date(ms).toISOString();

describe("owner-zone day math", () => {
  it("names the local day of an instant (local and UTC midnight agree)", () => {
    expect(dayOf(Date.parse("2026-03-12T23:00:00Z"), TZ)).toBe("2026-03-13");
    expect(dayOf(Date.parse("2026-09-13T00:00:00Z"), TZ)).toBe("2026-09-13");
    expect(dayOf(Date.parse("2026-09-13T21:59:59Z"), TZ)).toBe("2026-09-13");
    expect(dayOf(Date.parse("2026-09-13T22:00:00Z"), TZ)).toBe("2026-09-14");
  });

  it("ends a day at the next local midnight, across both DST switches", () => {
    expect(iso(endOfDay("2026-03-13", TZ))).toBe("2026-03-13T23:00:00.000Z");
    expect(iso(endOfDay("2026-09-13", TZ))).toBe("2026-09-13T22:00:00.000Z");
    // 29 Mar: 02:00 CET -> 03:00 CEST; the 30th starts at 00:00 CEST.
    expect(iso(endOfDay("2026-03-29", TZ))).toBe("2026-03-29T22:00:00.000Z");
    // 25 Oct: 03:00 CEST -> 02:00 CET; the 26th starts at 00:00 CET.
    expect(iso(endOfDay("2026-10-25", TZ))).toBe("2026-10-25T23:00:00.000Z");
    expect(iso(startOfDay("2026-03-29", TZ))).toBe("2026-03-28T23:00:00.000Z");
  });

  it("follows whatever zone it's given", () => {
    expect(iso(endOfDay("2026-09-13", "UTC"))).toBe("2026-09-14T00:00:00.000Z");
  });

  it("validates real calendar days and steps across months", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-9-1")).toBe(false);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
