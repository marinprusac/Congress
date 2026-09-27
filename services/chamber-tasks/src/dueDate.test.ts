import { describe, expect, it } from "vitest";
import { dueDay, dueDeadline } from "./dueDate.js";

const TZ = "Europe/Zagreb";

describe("dueDay / dueDeadline", () => {
  it("ends a day stored as local midnight at the next local midnight", () => {
    const stored = new Date("2026-03-12T23:00:00.000Z"); // 13 Mar 00:00 CET
    expect(dueDay(stored, TZ)).toBe("2026-03-13");
    expect(dueDeadline(stored, TZ).toISOString()).toBe("2026-03-13T23:00:00.000Z");
  });

  it("gives UTC midnight (02:00 CEST) the same day and deadline, not 02:00", () => {
    const stored = new Date("2026-09-13T00:00:00.000Z");
    expect(dueDay(stored, TZ)).toBe("2026-09-13");
    expect(dueDeadline(stored, TZ).toISOString()).toBe("2026-09-13T22:00:00.000Z");
  });

  it("lands on local midnight across the spring-forward night", () => {
    // 29 Mar 2026: clocks jump 02:00 CET -> 03:00 CEST; the 30th starts at 00:00 CEST.
    expect(dueDeadline(new Date("2026-03-28T23:00:00.000Z"), TZ).toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("lands on local midnight across the fall-back night", () => {
    // 25 Oct 2026: clocks fall back 03:00 CEST -> 02:00 CET; the 26th starts at 00:00 CET.
    expect(dueDeadline(new Date("2026-10-24T22:00:00.000Z"), TZ).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("follows whatever zone it's given", () => {
    expect(dueDeadline(new Date("2026-09-13T00:00:00.000Z"), "UTC").toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
});
