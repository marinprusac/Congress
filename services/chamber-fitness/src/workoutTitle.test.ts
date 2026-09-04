import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { formatWorkoutExhibitTitle, rankInDayTitleBucket, composeExhibitTitle } from "./workoutTitle.js";
import { upsertWorkoutFromHevy, deleteWorkoutByHevyId } from "./workouts.js";

describe("formatWorkoutExhibitTitle", () => {
  it("has no suffix at rank 1", () => {
    expect(formatWorkoutExhibitTitle("Push Day", new Date("2026-01-05T08:00:00Z"), 1)).toBe("Push Day · Jan 5, 2026");
  });

  it("adds a (n) suffix for rank > 1", () => {
    expect(formatWorkoutExhibitTitle("Push Day", new Date("2026-01-05T08:00:00Z"), 2)).toBe("Push Day · Jan 5, 2026 (2)");
    expect(formatWorkoutExhibitTitle("Push Day", new Date("2026-01-05T08:00:00Z"), 3)).toBe("Push Day · Jan 5, 2026 (3)");
  });
});

describe("rankInDayTitleBucket", () => {
  it("orders by start time ascending", () => {
    const rows = [
      { id: 3, startTime: new Date("2026-01-05T18:00:00Z") },
      { id: 1, startTime: new Date("2026-01-05T08:00:00Z") },
      { id: 2, startTime: new Date("2026-01-05T12:00:00Z") },
    ];
    expect(rankInDayTitleBucket(rows, 1)).toBe(1);
    expect(rankInDayTitleBucket(rows, 2)).toBe(2);
    expect(rankInDayTitleBucket(rows, 3)).toBe(3);
  });

  it("breaks ties on identical start times by id", () => {
    const rows = [
      { id: 5, startTime: new Date("2026-01-05T08:00:00Z") },
      { id: 2, startTime: new Date("2026-01-05T08:00:00Z") },
    ];
    expect(rankInDayTitleBucket(rows, 2)).toBe(1);
    expect(rankInDayTitleBucket(rows, 5)).toBe(2);
  });

  it("falls back to rank 1 for an id no longer in the bucket", () => {
    expect(rankInDayTitleBucket([{ id: 1, startTime: new Date() }], 999)).toBe(1);
  });
});

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => db.run(sql`delete from workouts`));

describe("composeExhibitTitle (DB-backed bucket)", () => {
  function insert(hevyId: string, title: string, startTime: Date) {
    const now = new Date();
    return db
      .insert(workouts)
      .values({
        hevyId,
        title,
        startTime,
        endTime: startTime,
        exerciseCount: 0,
        totalVolumeKg: null,
        exercisesJson: "[]",
        exerciseNames: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  it("is unnumbered when it's the only workout of that title that day", () => {
    const row = insert("h1", "Push Day", new Date("2026-01-05T08:00:00Z"));
    expect(composeExhibitTitle(row.id, "Push Day", row.startTime)).toBe("Push Day · Jan 5, 2026");
  });

  it("doesn't number workouts of the same title on different days", () => {
    const a = insert("h1", "Push Day", new Date("2026-01-05T08:00:00Z"));
    const b = insert("h2", "Push Day", new Date("2026-01-06T08:00:00Z"));
    expect(composeExhibitTitle(a.id, "Push Day", a.startTime)).toBe("Push Day · Jan 5, 2026");
    expect(composeExhibitTitle(b.id, "Push Day", b.startTime)).toBe("Push Day · Jan 6, 2026");
  });

  it("doesn't number workouts of different titles on the same day", () => {
    const a = insert("h1", "Push Day", new Date("2026-01-05T08:00:00Z"));
    const b = insert("h2", "Leg Day", new Date("2026-01-05T18:00:00Z"));
    expect(composeExhibitTitle(a.id, "Push Day", a.startTime)).toBe("Push Day · Jan 5, 2026");
    expect(composeExhibitTitle(b.id, "Leg Day", b.startTime)).toBe("Leg Day · Jan 5, 2026");
  });
});

describe("upsertWorkoutFromHevy / deleteWorkoutByHevyId keep bucket ranks correct", () => {
  it("assigns increasing ranks as same-title, same-day workouts are added", async () => {
    const first = await upsertWorkoutFromHevy("h1", "Push Day", new Date("2026-01-05T08:00:00Z"), new Date("2026-01-05T09:00:00Z"), []);
    const second = await upsertWorkoutFromHevy("h2", "Push Day", new Date("2026-01-05T18:00:00Z"), new Date("2026-01-05T19:00:00Z"), []);

    expect(composeExhibitTitle(first.id, "Push Day", new Date("2026-01-05T08:00:00Z"))).toBe("Push Day · Jan 5, 2026");
    expect(composeExhibitTitle(second.id, "Push Day", new Date("2026-01-05T18:00:00Z"))).toBe("Push Day · Jan 5, 2026 (2)");
  });

  it("shifts later siblings' ranks down when an earlier-rank workout is deleted", async () => {
    await upsertWorkoutFromHevy("h1", "Push Day", new Date("2026-01-05T08:00:00Z"), new Date("2026-01-05T09:00:00Z"), []);
    const second = await upsertWorkoutFromHevy(
      "h2",
      "Push Day",
      new Date("2026-01-05T18:00:00Z"),
      new Date("2026-01-05T19:00:00Z"),
      []
    );
    expect(composeExhibitTitle(second.id, "Push Day", new Date("2026-01-05T18:00:00Z"))).toBe("Push Day · Jan 5, 2026 (2)");

    await deleteWorkoutByHevyId("h1");

    expect(composeExhibitTitle(second.id, "Push Day", new Date("2026-01-05T18:00:00Z"))).toBe("Push Day · Jan 5, 2026");
  });

  it("re-buckets a workout whose title/day is edited, without leaving a stale rank on the old bucket", async () => {
    const a = await upsertWorkoutFromHevy("h1", "Push Day", new Date("2026-01-05T08:00:00Z"), new Date("2026-01-05T09:00:00Z"), []);
    await upsertWorkoutFromHevy("h2", "Push Day", new Date("2026-01-05T18:00:00Z"), new Date("2026-01-05T19:00:00Z"), []);

    // Rename the first workout out of the "Push Day"/Jan 5 bucket entirely.
    await upsertWorkoutFromHevy("h1", "Recovery", new Date("2026-01-05T08:00:00Z"), new Date("2026-01-05T09:00:00Z"), []);

    const remainingRow = db.select().from(workouts).where(sql`hevy_id = 'h2'`).get()!;
    expect(composeExhibitTitle(remainingRow.id, "Push Day", remainingRow.startTime)).toBe("Push Day · Jan 5, 2026");
    expect(composeExhibitTitle(a.id, "Recovery", new Date("2026-01-05T08:00:00Z"))).toBe("Recovery · Jan 5, 2026");
  });
});
