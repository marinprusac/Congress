import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./records.js", () => ({
  getCachedChamber: () => "e",
  resolveRecords: async (refs: { id: string }[]) =>
    refs.map((r) => (r.id === "note-1" ? { id: r.id, chamber: "e", name: "Trip plan", url: "/e/note-1", type: "note" } : { id: r.id, deleted: true })),
}));

import { db, runMigrations } from "./db/client.js";
import { addCard, DashboardError, listDashboard, listDashboardForAi, removeCards, reorderCards, updateCard } from "./dashboard.js";

const card = (title: string, extra: Record<string, unknown> = {}) => ({ title, blocks: [{ type: "text" as const, text: title }], ...extra });
const titles = async () => (await listDashboard()).map((c) => c.title);

beforeAll(() => runMigrations(migrationsDir("congress")));
beforeEach(() => {
  db.run(sql`delete from dashboard_cards`);
});

describe("the dashboard", () => {
  it("puts new cards on top unless told to go to the bottom", async () => {
    addCard(card("a"));
    addCard(card("b"));
    addCard(card("c"), "bottom");
    expect(await titles()).toEqual(["b", "a", "c"]);
  });

  it("drops a card once its expiry passes", async () => {
    const now = Date.now();
    addCard(card("soon", { expiresAt: new Date(now + 1000).toISOString() }), "top", now);
    addCard(card("forever"), "top", now);
    expect((await listDashboard(now)).map((c) => c.title)).toEqual(["forever", "soon"]);
    expect((await listDashboard(now + 5000)).map((c) => c.title)).toEqual(["forever"]);
    expect(listDashboardForAi(now + 5000)).toHaveLength(1);
  });

  it("refuses a 31st card", () => {
    for (let i = 0; i < 30; i++) addCard(card(`c${i}`));
    expect(() => addCard(card("one too many"))).toThrow(DashboardError);
  });

  it("updates only what is given, and null clears", async () => {
    const id = addCard(card("a", { kicker: "Today", color: "mint", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(updateCard(id, { title: "b", kicker: null, expiresAt: null })).toBe(true);
    const [c] = await listDashboard();
    expect(c).toMatchObject({ title: "b", kicker: null, color: "mint", expiresAt: null });
    expect(c!.blocks).toHaveLength(1);
    expect(updateCard(9999, { title: "x" })).toBe(false);
  });

  it("removes and reorders", async () => {
    const a = addCard(card("a"), "bottom");
    const b = addCard(card("b"), "bottom");
    const c = addCard(card("c"), "bottom");
    reorderCards([c, a]);
    expect(await titles()).toEqual(["c", "a", "b"]);
    expect(removeCards([a, 9999])).toBe(1);
    expect(await titles()).toEqual(["c", "b"]);
    void b;
  });

  it("resolves record blocks to their current name, and nulls a gone record", async () => {
    addCard({ title: "r", blocks: [{ type: "record", id: "note-1", note: "read it" }, { type: "record", id: "note-2" }] });
    const [c] = await listDashboard();
    expect(c!.blocks[0]).toMatchObject({ type: "record", note: "read it", record: { name: "Trip plan", url: "/e/note-1", type: "note" } });
    expect(c!.blocks[1]).toMatchObject({ type: "record", record: null });
  });

  it("skips stored blocks that no longer parse instead of failing the card", async () => {
    const id = addCard(card("a"));
    db.run(sql`update dashboard_cards set blocks_json = '[{"type":"bogus"},{"type":"text","text":"ok"}]' where id = ${id}`);
    expect((await listDashboard())[0]!.blocks).toEqual([{ type: "text", text: "ok" }]);
  });
});
