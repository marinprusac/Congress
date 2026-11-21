import { describe, expect, it } from "vitest";
import { formatBlockTime } from "./formatBlockTime";

const now = new Date(2026, 10, 21, 9, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

describe("formatBlockTime", () => {
  it("names today and tomorrow", () => {
    expect(formatBlockTime({ start: at(21, 14), allDay: true }, now)).toBe("Today");
    expect(formatBlockTime({ start: at(22, 14), allDay: true }, now)).toBe("Tomorrow");
  });

  it("shows a same-day range with one date", () => {
    const text = formatBlockTime({ start: at(21, 14), end: at(21, 15, 30) }, now);
    expect(text.startsWith("Today, ")).toBe(true);
    expect(text.match(/Today/g)).toHaveLength(1);
  });

  it("shows both ends when the range crosses days", () => {
    expect(formatBlockTime({ start: at(21, 22), end: at(22, 2) }, now)).toMatch(/^Today, .* – Tomorrow, /);
  });
});
