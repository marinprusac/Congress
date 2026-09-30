import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { applyOperations } from "./operations.js";
import { planMigration } from "./planner.js";
import { feedCandidatesFor } from "./feedRules.js";
import { rankFeed } from "../feed.js";

const HOUR = 3_600_000;
const now = new Date("2026-09-30T12:00:00Z");

const def = applyOperations(null, [
  { op: "create_type", slug: "task", label: "Task" },
  { op: "add_field", slug: "title", label: "Title", kind: "text" },
  { op: "set_title_field", field: "title" },
  { op: "add_field", slug: "due", label: "Due", kind: "datetime", options: { indexed: true } },
  { op: "add_field", slug: "done", label: "Done", kind: "boolean" },
  { op: "add_field", slug: "details", label: "Details", kind: "richtext" },
  {
    op: "set_feed_rules",
    rules: [
      { when: { op: "overdue", field: "due" }, and: [{ field: "done", value: false }], score: 90, reason: "Overdue", preview: ["due", "details"] },
      { when: { op: "within_next", field: "due", hours: 48 }, and: [{ field: "done", value: false }], score: 85, reason: "Due soon" },
    ],
  },
] satisfies Operation[]).def;

function seed() {
  const sqlite = new Database(":memory:");
  for (const step of planMigration(null, def).steps) sqlite.exec(step);
  const insert = sqlite.prepare(`INSERT INTO x_task (id, created_at, updated_at, title, due, done, details) VALUES (?, 0, 0, ?, ?, ?, ?)`);
  insert.run("late", "Late", now.getTime() - HOUR, 0, "**Call** the bank");
  insert.run("late-done", "Late but done", now.getTime() - HOUR, 1, "");
  insert.run("soon", "Soon", now.getTime() + HOUR, 0, "");
  insert.run("edge", "Edge", now.getTime() + 47 * HOUR, 0, "");
  insert.run("later", "Later", now.getTime() + 100 * HOUR, 0, "");
  return sqlite;
}

describe("feedCandidatesFor", () => {
  it("compiles overdue/within_next with extra conditions and previews", () => {
    const sqlite = seed();
    const candidates = feedCandidatesFor(def, now, (sql, params) => sqlite.prepare(sql).all(...params) as never, (r) => String(r.title));
    const byId = Object.fromEntries(candidates.map((c) => [c.kind === "exhibit" ? c.exhibitId : "", c]));
    expect(Object.keys(byId).sort()).toEqual(["edge", "late", "soon"]);
    expect(byId.late).toMatchObject({
      score: 90,
      reason: "Overdue",
      preview: { title: "Late", time: { start: new Date(now.getTime() - HOUR).toISOString() }, body: "Call the bank" },
    });
    expect((byId.soon as { score: number }).score).toBeGreaterThan((byId.edge as { score: number }).score);
    expect((byId.edge as { score: number }).score).toBeGreaterThanOrEqual(Math.round(85 * 0.7));
  });

  it("merges with Chamber candidates in rankFeed", () => {
    const sqlite = seed();
    const local = feedCandidatesFor(def, now, (sql, params) => sqlite.prepare(sql).all(...params) as never, (r) => String(r.title));
    const ranked = rankFeed([
      { chamber: { name: "e", views: [] }, candidates: local },
      { chamber: { name: "mail", views: [] }, candidates: [{ kind: "exhibit", exhibitId: "thread-1", score: 95 }] },
    ]);
    expect(ranked.map((r) => (r.kind === "exhibit" ? `${r.chamber}:${r.exhibitId}` : ""))).toEqual(["mail:thread-1", "e:late", "e:soon", "e:edge"]);
  });
});

describe("feed rules on date fields", () => {
  const dateDef = applyOperations(null, [
    { op: "create_type", slug: "chore", label: "Chore" },
    { op: "add_field", slug: "title", label: "Title", kind: "text" },
    { op: "set_title_field", field: "title" },
    { op: "add_field", slug: "due", label: "Due", kind: "date" },
    {
      op: "set_feed_rules",
      rules: [
        { when: { op: "overdue", field: "due" }, score: 90, reason: "Overdue", preview: ["due"] },
        { when: { op: "within_next", field: "due", hours: 48 }, score: 85 },
      ],
    },
  ] satisfies Operation[]).def;

  function candidatesAt(at: Date) {
    const sqlite = new Database(":memory:");
    for (const step of planMigration(null, dateDef).steps) sqlite.exec(step);
    const insert = sqlite.prepare(`INSERT INTO x_chore (id, created_at, updated_at, title, due) VALUES (?, 0, 0, ?, ?)`);
    const rows: [string, string | null][] = [
      ["yesterday", "2026-09-29"],
      ["today", "2026-09-30"],
      ["tomorrow", "2026-10-01"],
      ["in2", "2026-10-02"],
      ["none", null],
    ];
    for (const [id, due] of rows) insert.run(id, id, due);
    return feedCandidatesFor(dateDef, at, (sql, params) => sqlite.prepare(sql).all(...params) as never, (r) => String(r.title));
  }
  const ids = (cs: ReturnType<typeof candidatesAt>, reason?: string) =>
    cs
      .filter((c) => (reason ? c.reason === reason : !c.reason))
      .map((c) => (c.kind === "exhibit" ? c.exhibitId : ""))
      .sort();

  it("counts a day as due until it ends in the owner's zone", () => {
    // 23:30 on 30 Sep in Zagreb (CEST).
    const cs = candidatesAt(new Date("2026-09-30T21:30:00Z"));
    expect(ids(cs, "Overdue")).toEqual(["yesterday"]);
    expect(ids(cs)).toEqual(["today", "tomorrow"]);
    expect(cs.find((c) => c.reason === "Overdue")).toMatchObject({ preview: { time: { label: "Due", start: "2026-09-29", allDay: true } } });
  });

  it("rolls over at local midnight, not UTC", () => {
    const cs = candidatesAt(new Date("2026-09-30T22:00:00Z"));
    expect(ids(cs, "Overdue")).toEqual(["today", "yesterday"]);
    expect(ids(cs)).toEqual(["in2", "tomorrow"]);
  });
});

describe("within_last", () => {
  it("picks the recent past, newest first", () => {
    const mail = applyOperations(null, [
      { op: "create_type", slug: "mail", label: "Mail" },
      { op: "add_field", slug: "subject", label: "Subject", kind: "text" },
      { op: "set_title_field", field: "subject" },
      { op: "add_field", slug: "at", label: "At", kind: "datetime", options: { indexed: true } },
      { op: "set_feed_rules", rules: [{ when: { op: "within_last", field: "at", hours: 24 }, score: 60 }] },
    ] satisfies Operation[]).def;
    const sqlite = new Database(":memory:");
    for (const step of planMigration(null, mail).steps) sqlite.exec(step);
    const insert = sqlite.prepare(`INSERT INTO x_mail (id, created_at, updated_at, subject, at) VALUES (?, 0, 0, ?, ?)`);
    insert.run("fresh", "Fresh", now.getTime() - HOUR);
    insert.run("stale", "Stale", now.getTime() - 23 * HOUR);
    insert.run("old", "Old", now.getTime() - 30 * HOUR);
    insert.run("future", "Future", now.getTime() + HOUR);
    const candidates = feedCandidatesFor(mail, now, (sql, params) => sqlite.prepare(sql).all(...params) as never, (r) => String(r.subject));
    const scores = Object.fromEntries(candidates.map((c) => [c.kind === "exhibit" ? c.exhibitId : "", c.score]));
    expect(Object.keys(scores).sort()).toEqual(["fresh", "stale"]);
    expect(scores.fresh!).toBeGreaterThan(scores.stale!);
    expect(scores.fresh!).toBeLessThanOrEqual(60);
  });
});
