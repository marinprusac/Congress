import { describe, expect, it } from "vitest";
import { addMinutesToLocalInput, formatWeekMonths, minutesBetween, nextHalfHourSlot } from "./datetime";

describe("formatWeekMonths", () => {
  it("names one month when the week sits inside it, and both ends when it straddles two", () => {
    expect(formatWeekMonths(new Date("2030-01-07T00:00:00"), new Date("2030-01-13T00:00:00"))).not.toContain("–");
    expect(formatWeekMonths(new Date("2030-01-28T00:00:00"), new Date("2030-02-03T00:00:00"))).toContain("–");
    expect(formatWeekMonths(new Date("2029-12-31T00:00:00"), new Date("2030-01-06T00:00:00"))).toMatch(/2029.*–.*2030/);
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
