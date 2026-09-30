import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir } from "@congress/test-support";
import { getChamber, registerChamber } from "../../registry.js";
import { db, runMigrations } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { startTypeEngine } from "../index.js";
import { createRecord, manualRefs } from "../records.js";
import { resolveLegacyAlias } from "../aliases.js";
import { getTypeBySlug } from "../store.js";
import { runGmailMigrations } from "../../connectors/gmail/db/client.js";
import { getSettings } from "../../connectors/gmail/cache.js";
import { importLegacyMail } from "./mailImport.js";

const source = (key: string) => ({ source: { binding: "bnd_gmail_thread", key }, fromSource: true });
let from = "";
let recent = "";
const fetched: string[] = [];

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runGmailMigrations();
  startTypeEngine();
  recent = createRecord("email", { subject: "Lunch?" }, source("1:t1")).id;

  from = join(mkdtempSync(join(tmpdir(), "mail-import-")), "mail.sqlite3");
  const mail = new Database(from);
  mail.exec(`
    CREATE TABLE messages (id TEXT, account_id INTEGER, thread_id TEXT, subject TEXT);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, include_all_categories INTEGER, feed_window_hours INTEGER);
    CREATE TABLE thread_refs (id INTEGER PRIMARY KEY, exhibit_id TEXT, target_exhibit_id TEXT, created_at INTEGER);
  `);
  const msg = mail.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)");
  msg.run("1:m1", 1, "t1", "Lunch?");
  msg.run("1:m2", 1, "t2", "Old but cached");
  msg.run("1:m3", 1, "gone", "Deleted in Gmail");
  mail.prepare("INSERT INTO settings VALUES (1, 1, 24)").run();
  mail.prepare("INSERT INTO thread_refs (exhibit_id, target_exhibit_id, created_at) VALUES ('thread-1:t1', 'note-7', 0)").run();
  mail.close();

  registerChamber(makeManifest("mail"));
  // A note that linked an old thread (older than the sync), and the Chamber's cache row.
  db.insert(exhibitRefs).values({ sourceId: "note-1", sourceChamber: "notes", targetId: "thread-2:old" }).run();
  db.insert(exhibitCache).values({ id: "thread-1:t1", chamber: "mail", type: "email", name: "Lunch?", url: "/t/1/t1", updatedAt: new Date() }).run();
});

describe("the Mail cutover", () => {
  it("keeps old ids working, fetches what's linked or cached, and turns the connector on", async () => {
    const stats = await importLegacyMail({
      from,
      fetchThread: async (_t, key) => {
        fetched.push(key);
        return key === "gone" || key === "1:gone" ? null : createRecord("email", { subject: `Fetched ${key}` }, source(key)).id;
      },
    });
    expect(stats).toMatchObject({ aliases: 3, fetched: 1, missing: [], olderFetched: 1, olderMissing: 1, refs: 1, exhibitRefsRewritten: 1, includeAllCategories: true });
    expect(fetched.sort()).toEqual(["1:gone", "1:t2", "2:old"]);
    expect(resolveLegacyAlias("mail", "thread-1:t1")).toBe(recent);
    expect(resolveLegacyAlias("mail", "thread-2:old")).toBeTruthy();
    expect(manualRefs(recent)).toEqual(["note-7"]);
    expect(db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, "note-1")).get()?.targetId).toBe(resolveLegacyAlias("mail", "thread-2:old"));
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.chamber, "mail")).all()).toEqual([]);
    expect(getSettings()).toEqual({ includeAllCategories: true, publishEvents: true, createPeople: true });
    expect(getChamber("mail")).toBeNull();
    expect(getTypeBySlug("email")!.definition.hidden).toBe(false);
  });

  it("runs once", async () => {
    expect((await importLegacyMail({ from })).skipped).toBe("already_ran");
  });
});
