import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../../src/types";
import {
  addMinutesToLocalInput,
  buildAgendaTimeline,
  durationPx,
  fineTimeFromDelta,
  formatGapDuration,
  gapHeightPx,
  minutesBetween,
  nextHalfHourSlot,
  snapToHalfHour,
} from "./datetime";
import type { AgendaClusterEntry, AgendaDateEntry, AgendaGapEntry } from "./datetime";

let nextId = 0;

// Deliberately plain (offset-less) ISO strings throughout this file - both
// dayKey() (slices event.start) and buildAgendaTimeline's own window-bound
// Date math treat those as local time, so fixtures and window bounds stay
// mutually consistent regardless of the machine's own time zone.
function makeEvent(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "start" | "end">): CalendarEvent {
  nextId += 1;
  return {
    id: `evt-${nextId}`,
    accountId: 1,
    calendarId: "cal-1",
    calendarSummary: "Test",
    calendarColor: null,
    title: "Event",
    description: null,
    location: null,
    descriptionRich: null,
    locationRich: null,
    allDay: false,
    htmlLink: null,
    editable: true,
    attendance: { isInvitation: false, responseStatus: null, notAttending: false },
    ...partial,
  };
}

describe("buildAgendaTimeline - day visibility", () => {
  const windowStartMs = new Date("2030-01-01T00:00:00").getTime();
  const windowEndMs = new Date("2030-01-04T00:00:00").getTime(); // Jan 1, 2, 3
  const window = { nowMs: windowStartMs - 1, windowStartMs, windowEndMs };

  it("merges the idle span across an empty day into one gap, with each day's header riding inside it at its own midnight point", () => {
    const events = [
      makeEvent({ start: "2030-01-01T09:00:00", end: "2030-01-01T10:00:00" }),
      // Jan 2 has no events at all.
      makeEvent({ start: "2030-01-03T09:00:00", end: "2030-01-03T10:00:00" }),
    ];

    const timeline = buildAgendaTimeline(events, window);

    // Only the very first day (Jan 1, with no preceding gap to embed into)
    // gets a standalone header - Jan 2 and Jan 3's headers both ride inside
    // the one merged gap below instead.
    const dateEntries = timeline.filter((e): e is AgendaDateEntry => e.kind === "date");
    expect(dateEntries.map((e) => e.key)).toEqual(["date-2030-01-01"]);

    // The merged gap between the two events, plus one trailing gap for the
    // rest of Jan 3 after its last event, up to the window's own end (no
    // day-breaks on that one - it doesn't cross into another day).
    const gapEntries = timeline.filter((e): e is AgendaGapEntry => e.kind === "gap");
    expect(gapEntries).toHaveLength(2);
    const gap = gapEntries[0]!;
    expect(gapEntries[1]!.dayBreaks).toEqual([]);

    // One single duration for the whole span - not one number per day
    // crossed - covering everything from the first event's end to the
    // second event's start, including the entirety of the empty Jan 2.
    const expectedMinutes = Math.round(
      (new Date("2030-01-03T09:00:00").getTime() - new Date("2030-01-01T10:00:00").getTime()) / 60000
    );
    expect(gap.minutes).toBe(expectedMinutes);

    // Both Jan 2 and Jan 3's headers land inside it, each at its own true
    // midnight offset from the gap's start (10:00 Jan 1).
    expect(gap.dayBreaks.map((b) => b.key)).toEqual(["2030-01-02", "2030-01-03"]);
    expect(gap.dayBreaks[0]!.offsetMinutes).toBe(14 * 60); // 10:00 Jan 1 -> 00:00 Jan 2
    expect(gap.dayBreaks[1]!.offsetMinutes).toBe(38 * 60); // 10:00 Jan 1 -> 00:00 Jan 3
    for (const brk of gap.dayBreaks) {
      expect(brk.label).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    }
  });

  it("still merges into one gap when only a single midnight is crossed, with no empty day in between", () => {
    const events = [
      makeEvent({ start: "2030-01-01T18:00:00", end: "2030-01-01T20:00:00" }),
      makeEvent({ start: "2030-01-02T10:00:00", end: "2030-01-02T11:00:00" }),
    ];

    const timeline = buildAgendaTimeline(events, {
      nowMs: windowStartMs - 1,
      windowStartMs,
      windowEndMs: new Date("2030-01-03T00:00:00").getTime(),
    });

    const dateEntries = timeline.filter((e): e is AgendaDateEntry => e.kind === "date");
    expect(dateEntries.map((e) => e.key)).toEqual(["date-2030-01-01"]);

    // The merged gap crossing the one midnight, plus a trailing gap for the
    // rest of Jan 2 after its event, up to the window's own end.
    const gapEntries = timeline.filter((e): e is AgendaGapEntry => e.kind === "gap");
    expect(gapEntries).toHaveLength(2);
    const gap = gapEntries[0]!;
    expect(gap.minutes).toBe(14 * 60); // 20:00 Jan 1 -> 10:00 Jan 2
    expect(gap.dayBreaks).toHaveLength(1);
    expect(gap.dayBreaks[0]!.key).toBe("2030-01-02");
    expect(gap.dayBreaks[0]!.offsetMinutes).toBe(4 * 60); // 20:00 Jan 1 -> 00:00 Jan 2
  });

  it("carries a weekday name even for a day far beyond the old 7-day cutoff", () => {
    const timeline = buildAgendaTimeline([], window);
    const lastDate = timeline.filter((e): e is AgendaDateEntry => e.kind === "date").at(-1)!;
    expect(lastDate.key).toBe("date-2030-01-03");
    expect(lastDate.label).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
  });
});

describe("buildAgendaTimeline - overlap column assignment", () => {
  const windowStartMs = new Date("2030-02-01T00:00:00").getTime();
  const windowEndMs = new Date("2030-02-02T00:00:00").getTime();
  const window = { nowMs: windowStartMs - 1, windowStartMs, windowEndMs };

  it("splits into columns when two events substantially overlap", () => {
    const events = [
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T10:00:00" }), // 60 min
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T09:50:00" }), // 50 min, fully inside the first
    ];

    const timeline = buildAgendaTimeline(events, window);
    const cluster = timeline.find((e): e is AgendaClusterEntry => e.kind === "cluster")!;
    expect(cluster.blocks).toHaveLength(2);
    for (const block of cluster.blocks) {
      expect(block.columnCount).toBe(2);
    }
  });

  it("keeps both events full-width when they only slightly overlap", () => {
    const events = [
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T10:00:00" }), // 60 min
      makeEvent({ start: "2030-02-01T09:55:00", end: "2030-02-01T10:55:00" }), // 60 min, 5 min tail overlap
    ];

    const timeline = buildAgendaTimeline(events, window);
    const cluster = timeline.find((e): e is AgendaClusterEntry => e.kind === "cluster")!;
    expect(cluster.blocks).toHaveLength(2);
    for (const block of cluster.blocks) {
      expect(block.columnCount).toBe(1);
    }
  });

  it("lets two short events that don't overlap each other time-share a column even though both substantially overlap a longer one", () => {
    const events = [
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T11:00:00" }), // 2h, long
      makeEvent({ start: "2030-02-01T09:05:00", end: "2030-02-01T09:15:00" }), // nested near the start
      makeEvent({ start: "2030-02-01T10:50:00", end: "2030-02-01T11:00:00" }), // nested near the end
    ];

    const timeline = buildAgendaTimeline(events, window);
    const cluster = timeline.find((e): e is AgendaClusterEntry => e.kind === "cluster")!;
    expect(cluster.blocks).toHaveLength(3);
    // The long event needs its own column against both short ones; the two
    // short ones never overlap each other, so only 2 columns are needed
    // total, not 3.
    for (const block of cluster.blocks) {
      expect(block.columnCount).toBe(2);
    }
  });
});

describe("nextHalfHourSlot", () => {
  it("rounds up to the next 30-minute boundary", () => {
    expect(nextHalfHourSlot(new Date("2030-01-01T15:03:00"))).toEqual(new Date("2030-01-01T15:30:00"));
  });

  it("rounds a time in the second half-hour up to the following hour", () => {
    expect(nextHalfHourSlot(new Date("2030-01-01T15:31:00"))).toEqual(new Date("2030-01-01T16:00:00"));
  });

  it("leaves a time already exactly on a boundary unchanged", () => {
    expect(nextHalfHourSlot(new Date("2030-01-01T15:30:00"))).toEqual(new Date("2030-01-01T15:30:00"));
  });
});

describe("addMinutesToLocalInput", () => {
  it("shifts a datetime-local value forward by the given minutes", () => {
    expect(addMinutesToLocalInput("2030-01-01T15:30", 60)).toBe("2030-01-01T16:30");
  });

  it("carries across a day boundary", () => {
    expect(addMinutesToLocalInput("2030-01-01T23:45", 30)).toBe("2030-01-02T00:15");
  });
});

describe("minutesBetween", () => {
  it("returns the whole-minute span between two ISO instants", () => {
    expect(minutesBetween("2030-01-01T09:00:00", "2030-01-01T10:30:00")).toBe(90);
  });
});

describe("snapToHalfHour", () => {
  it("rounds down when closer to the boundary below", () => {
    expect(snapToHalfHour(new Date("2030-01-01T15:06:00").getTime())).toBe(new Date("2030-01-01T15:00:00").getTime());
  });

  it("rounds up when closer to the boundary above", () => {
    expect(snapToHalfHour(new Date("2030-01-01T15:24:00").getTime())).toBe(new Date("2030-01-01T15:30:00").getTime());
  });

  it("leaves a time already on a half-hour boundary unchanged", () => {
    expect(snapToHalfHour(new Date("2030-01-01T15:30:00").getTime())).toBe(new Date("2030-01-01T15:30:00").getTime());
  });
});

describe("fineTimeFromDelta", () => {
  const gapStartMs = new Date("2030-01-01T09:00:00").getTime();
  const gapMinutes = 60 * 24 * 30; // a whole idle month, like a gap-compressed empty calendar

  it("moves by whole 30-minute steps at the given screen-space rate, regardless of how large the gap is", () => {
    const anchor = new Date("2030-01-01T09:00:00").getTime();
    // 60px at 12px/half-hour = 5 steps = 150 minutes - the exact case that
    // used to jump ~33 hours before the original fix, when position was absolute.
    const result = fineTimeFromDelta(anchor, 60, 12, gapStartMs, gapMinutes);
    expect(result).toBe(anchor + 150 * 60_000);
  });

  it("moves backward for a negative delta", () => {
    const anchor = new Date("2030-01-01T12:00:00").getTime();
    const result = fineTimeFromDelta(anchor, -24, 12, gapStartMs, gapMinutes);
    expect(result).toBe(anchor - 60 * 60_000);
  });

  it("clamps to the gap's own end when the drag would push past it", () => {
    const anchor = new Date("2030-01-01T09:00:00").getTime();
    const result = fineTimeFromDelta(anchor, 1_000_000, 12, gapStartMs, gapMinutes);
    expect(result).toBe(gapStartMs + gapMinutes * 60_000);
  });

  it("clamps to the gap's own start when the drag would push before it", () => {
    const anchor = new Date("2030-01-01T09:00:00").getTime();
    const result = fineTimeFromDelta(anchor, -1_000_000, 12, gapStartMs, gapMinutes);
    expect(result).toBe(gapStartMs);
  });
});

describe("gapHeightPx", () => {
  it("leaves a single-day gap unaffected - durationPx alone already gives a lone idle day its full floor", () => {
    expect(gapHeightPx(24 * 60, 1)).toBeCloseTo(durationPx(24 * 60), 5);
  });

  it("floors a merged multi-day gap that durationPx alone would compress below one full day per day spanned", () => {
    const minutes = 10 * 24 * 60; // 10 idle days merged into one gap
    const daysSpanned = 10;
    const compressed = durationPx(minutes);
    const floored = gapHeightPx(minutes, daysSpanned);
    expect(compressed).toBeLessThan(floored); // sqrt(10) days is far less than 10 whole days
    expect(floored).toBeCloseTo(daysSpanned * durationPx(24 * 60), 5);
  });

  it("does not floor a near-zero-duration single-day gap - the multi-day floor only applies once a gap actually spans more than one calendar day", () => {
    expect(gapHeightPx(0, 1)).toBeCloseTo(durationPx(0), 5);
  });

  it("scales an ordinary same-day gap (e.g. a 30-minute breather between meetings) by its own duration, not a full day's height", () => {
    const heightPx = gapHeightPx(30, 1);
    expect(heightPx).toBeCloseTo(durationPx(30), 5);
    expect(heightPx).toBeLessThan(durationPx(24 * 60));
  });
});

describe("durationPx", () => {
  it("maps 1 hour to exactly PX_PER_HOUR", () => {
    expect(durationPx(60)).toBe(48);
  });

  it("compresses longer spans sublinearly (sqrt), not 1:1", () => {
    expect(durationPx(240)).toBeCloseTo(96, 5); // 4h -> 2 units, not 4
    expect(durationPx(15)).toBeCloseTo(24, 5); // 15m -> half a unit
  });

  it("never returns a negative height for a zero/negative span", () => {
    expect(durationPx(0)).toBe(0);
    expect(durationPx(-30)).toBe(0);
  });
});

describe("buildAgendaTimeline - gap startMs", () => {
  it("carries each gap's own absolute start instant, matching the end of the preceding event", () => {
    const windowStartMs = new Date("2030-03-01T00:00:00").getTime();
    const windowEndMs = new Date("2030-03-02T00:00:00").getTime();
    const events = [makeEvent({ start: "2030-03-01T09:00:00", end: "2030-03-01T10:00:00" })];

    const timeline = buildAgendaTimeline(events, { nowMs: windowStartMs - 1, windowStartMs, windowEndMs });
    const gaps = timeline.filter((e): e is AgendaGapEntry => e.kind === "gap");

    // Trailing gap after the one event, running to the window's own end.
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.startMs).toBe(new Date("2030-03-01T10:00:00").getTime());
  });
});

describe("formatGapDuration", () => {
  it("formats sub-hour and sub-day durations as before", () => {
    expect(formatGapDuration(45)).toBe("45 min");
    expect(formatGapDuration(90)).toBe("1h 30m");
    expect(formatGapDuration(120)).toBe("2h");
  });

  it("switches to day-hour format at 24h and beyond, still a single duration", () => {
    expect(formatGapDuration(24 * 60)).toBe("1d");
    expect(formatGapDuration(26 * 60)).toBe("1d 2h");
    expect(formatGapDuration(29 * 24 * 60)).toBe("29d");
  });
});
