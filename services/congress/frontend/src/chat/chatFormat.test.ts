import { describe, expect, it } from "vitest";
import { dayLabel, durationLabel, layoutMarkers, listStamp, stringifyToolValue, toolLabel } from "./chatFormat.js";

describe("toolLabel", () => {
  it("splits MCP tool names into chamber and a readable action", () => {
    expect(toolLabel("mcp__notes__create_note")).toEqual({ chamber: "notes", label: "Create note" });
    expect(toolLabel("mcp__congress__search_exhibits")).toEqual({ chamber: "congress", label: "Search exhibits" });
    expect(toolLabel("weird")).toEqual({ chamber: null, label: "Weird" });
    expect(toolLabel("ToolSearch")).toEqual({ chamber: null, label: "Load tools" });
  });
});

describe("dates", () => {
  const now = new Date(2026, 8, 27, 15, 0);

  it("labels days relative to today", () => {
    expect(dayLabel(new Date(2026, 8, 27, 9), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 26, 23), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2025, 0, 2), now)).toMatch(/2025/);
  });

  it("gives compact list stamps", () => {
    expect(listStamp(new Date(now.getTime() - 30_000), now)).toBe("now");
    expect(listStamp(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m");
    expect(listStamp(new Date(2026, 8, 26, 10), now)).toBe("Yesterday");
  });

  it("formats durations", () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(400)).toBe("<1s");
    expect(durationLabel(4200)).toBe("4s");
    expect(durationLabel(125_000)).toBe("2m 5s");
  });
});

describe("layoutMarkers", () => {
  it("marks a new day and each change of speaker or long gap", () => {
    const at = (h: number, m: number) => new Date(2026, 8, 27, h, m).toISOString();
    const markers = layoutMarkers([
      { role: "user", createdAt: new Date(2026, 8, 26, 22, 0).toISOString() },
      { role: "user", createdAt: at(9, 0) },
      { role: "user", createdAt: at(9, 1) },
      { role: "assistant", createdAt: at(9, 2) },
      { role: "assistant", createdAt: at(9, 30) },
    ]);
    expect(markers.map((m) => [m.day !== null, m.stamp])).toEqual([
      [true, true],
      [true, true],
      [false, false],
      [false, true],
      [false, true],
    ]);
  });
});

describe("stringifyToolValue", () => {
  it("pretty-prints JSON carried in text blocks and clips long output", () => {
    expect(stringifyToolValue([{ type: "text", text: '{"a":1}' }])).toBe('{\n  "a": 1\n}');
    expect(stringifyToolValue("x".repeat(10), 4)).toBe("xxxx\n…");
  });
});
