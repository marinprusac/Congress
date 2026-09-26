import { describe, expect, it } from "vitest";
import { formatPreviewTime } from "./formatPreviewTime.js";

// Built from local-time components so the expectations hold in any time
// zone the tests run in - the function formats in the local zone too.
const now = new Date(2026, 8, 27, 12, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).toISOString();
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

describe("formatPreviewTime", () => {
  it("labels a same-day range with Today and one date", () => {
    expect(formatPreviewTime({ start: at(27, 14), end: at(27, 15, 30) }, now)).toBe(`Today ${clock(at(27, 14))} – ${clock(at(27, 15, 30))}`);
  });

  it("prefixes the Chamber's label and says Tomorrow", () => {
    expect(formatPreviewTime({ label: "Due", start: at(28, 9) }, now)).toBe(`Due Tomorrow ${clock(at(28, 9))}`);
  });

  it("repeats the day when a range crosses midnight", () => {
    expect(formatPreviewTime({ start: at(27, 23), end: at(28, 1) }, now)).toBe(`Today ${clock(at(27, 23))} – Tomorrow ${clock(at(28, 1))}`);
  });

  it("reads an all-day date as a local date, not UTC midnight", () => {
    expect(formatPreviewTime({ start: "2026-09-27", end: "2026-09-28", allDay: true }, now)).toBe("Today");
  });
});
