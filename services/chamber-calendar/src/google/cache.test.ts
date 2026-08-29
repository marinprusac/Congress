import { migrationsDir } from "@congress/test-support";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "../db/client.js";
import { googleAccounts } from "../db/schema.js";
import { listCachedEvents, searchCachedEvents, upsertCachedEventFromGoogle, type RawGoogleEvent } from "./cache.js";

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
  db.insert(googleAccounts)
    .values({
      id: 1,
      label: "Test",
      email: "test@example.com",
      googleSub: "sub-1",
      accessToken: "at",
      refreshToken: "rt",
      scope: "scope",
      tokenExpiry: new Date(),
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
});

let nextEventId = 1;

// Google always returns dateTime with the event's own UTC offset (e.g.
// "+02:00"), never normalized to "Z" - the exact shape that broke the old
// SQL-side gte/lte and localeCompare comparisons, since those compare raw
// text rather than the real instant a `new Date()` would resolve to.
function raw(startIso: string, endIso: string): RawGoogleEvent {
  const id = `evt-${nextEventId++}`;
  return { id, summary: `Event ${id}`, start: { dateTime: startIso }, end: { dateTime: endIso } };
}

describe("listCachedEvents", () => {
  beforeEach(() => {
    db.run("delete from cached_events");
  });

  it("includes an event within the window even when its offset digits read later than a UTC 'Z' bound", async () => {
    // Real instant is 10:15 UTC, but the stored text's own local hour ("12")
    // reads as later than the UTC query bounds' hour ("10") - a raw string
    // compare would wrongly exclude this from a [10:00Z, 10:30Z] window.
    await upsertCachedEventFromGoogle(
      raw("2026-01-01T12:15:00+02:00", "2026-01-01T12:45:00+02:00"),
      1,
      "primary"
    );

    const results = listCachedEvents("2026-01-01T10:00:00.000Z", "2026-01-01T10:30:00.000Z");
    expect(results).toHaveLength(1);
  });

  it("excludes an event whose real start has already passed, even when its offset digits still read inside the window", async () => {
    // The exact shape of the production bug: a Zagreb-time (+02:00) event
    // that actually started 90 minutes before the query's "now" was still
    // matching a "starting in the next 30 minutes" query, because the
    // stored local-hour digits ("16:25") fell between the UTC query bounds'
    // digits ("15:55" and "16:25").
    await upsertCachedEventFromGoogle(
      raw("2026-08-22T16:25:00+02:00", "2026-08-22T20:50:00+02:00"),
      1,
      "primary"
    );

    const results = listCachedEvents("2026-08-22T15:55:00.000Z", "2026-08-22T16:25:00.000Z");
    expect(results).toHaveLength(0);
  });

  it("sorts by real start instant, not by offset-suffixed text", async () => {
    // "09:00+02:00" (07:00 UTC) sorts after "08:00Z" as text, but is
    // actually earlier - a `localeCompare` sort would put them backwards.
    await upsertCachedEventFromGoogle(raw("2026-01-01T09:00:00+02:00", "2026-01-01T09:30:00+02:00"), 1, "primary");
    await upsertCachedEventFromGoogle(raw("2026-01-01T08:00:00Z", "2026-01-01T08:30:00Z"), 1, "primary");

    const results = listCachedEvents("2026-01-01T00:00:00.000Z", "2026-01-01T23:59:59.000Z");
    expect(results.map((e) => e.start)).toEqual(["2026-01-01T09:00:00+02:00", "2026-01-01T08:00:00Z"]);
  });
});

describe("searchCachedEvents", () => {
  beforeEach(() => {
    db.run("delete from cached_events");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("empty query excludes an already-started event regardless of its offset digits", async () => {
    await upsertCachedEventFromGoogle(
      raw("2026-08-22T16:25:00+02:00", "2026-08-22T20:50:00+02:00"),
      1,
      "primary"
    );

    // "now" sits inside the false-match window the offset bug produced.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T15:55:00.000Z"));

    expect(searchCachedEvents("")).toHaveLength(0);
  });
});
