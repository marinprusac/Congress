import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { onEventPublished, type PublishedEvent } from "../../events.js";
import { startTypeEngine } from "../index.js";
import { exhibitsSqlite } from "../db/client.js";
import { getTypeBySlug } from "../store.js";
import { createRecord, listRecords, RecordLockedError, titleOf, updateRecord } from "../records.js";
import { feedCandidatesFor } from "../feedRules.js";
import { liveDetail, runBindingAction, startBindings, stopBindings, withBinding } from "../bindings/runtime.js";
import { startConnectors, stopConnectors } from "../../connectors/registry.js";
import { emitSourceChange } from "../../connectors/runtime.js";
import { gmailConnector } from "../../connectors/gmail/index.js";
import { fakeGmail, msg } from "../../connectors/gmail/fakeGmail.js";
import type { Stored } from "../casts.js";

const g = fakeGmail();
const events: PublishedEvent[] = [];
onEventPublished((e) => events.push(e));
const all = () => listRecords("email", { limit: 100 });
const byThread = (id: string) => all().find((r) => r.provenance?.key === `1:${id}`)!;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  g.state.threads.t1 = [msg("m1", "t1", { subject: "Invoice", from: "Ana <ana@example.com>" })];
  g.state.threads.t2 = [msg("m2", "t2", { subject: "Newsletter", labels: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"] })];
  startBindings();
  await startConnectors([gmailConnector], {
    context: () => ({
      ...g.ctx,
      emitChange: (kind, key, deleted = false, quiet = false) => emitSourceChange({ connector: "gmail", kind, key, deleted, quiet }),
    }),
  });
  await vi.waitFor(() => expect(all()).toHaveLength(2));
});

afterAll(async () => {
  stopBindings();
  await stopConnectors();
});

describe("the Email premade bound to Gmail", () => {
  it("mirrors each thread quietly, hidden until the cutover", () => {
    expect(getTypeBySlug("email")!.definition.hidden).toBe(true);
    expect(byThread("t1").values).toMatchObject({ subject: "Invoice", from: "Ana <ana@example.com>", unread: true, inbox: true, category: "primary", messages: 1 });
    expect(events.filter((e) => e.type.startsWith("email."))).toEqual([]);
  });

  it("is read-only: no new emails, no edits", () => {
    expect(() => createRecord("email", { subject: "Mine" }, { actor: "me" })).toThrow(RecordLockedError);
    expect(() => updateRecord(byThread("t1").id, { subject: "Changed" }, { actor: "me" })).toThrow(RecordLockedError);
  });

  it("puts unread primary mail in the feed", () => {
    const t = getTypeBySlug("email")!;
    const def = t.definition;
    const rows = (sql: string, params: Stored[]) => exhibitsSqlite.prepare(sql).all(...params) as Record<string, Stored>[];
    const ids = feedCandidatesFor(def, new Date(), rows, (r) => titleOf(def, r)).map((c) => (c.kind === "exhibit" ? c.exhibitId : ""));
    expect(ids).toEqual([byThread("t1").id]);
  });

  it("reads bodies live and marks a thread read through Gmail", async () => {
    const id = byThread("t1").id;
    expect(withBinding(byThread("t1")).binding).toMatchObject({ detail: true, actions: [{ id: "mark_read", label: "Mark read" }] });
    expect(await liveDetail(id)).toMatchObject({ subject: "Invoice", messages: [{ text: "body m1" }] });
    const after = await runBindingAction(id, "mark_read");
    expect(after.values.unread).toBe(false);
    expect(after.binding?.actions).toEqual([]);
  });
});
