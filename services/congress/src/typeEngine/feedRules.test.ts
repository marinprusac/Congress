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
