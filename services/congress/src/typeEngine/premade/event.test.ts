import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callChamberTool, listChamberTools } from "@congress/chamber-kit";
import { migrationsDir, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { app } from "../../server.js";
import { runMigrations } from "../../db/client.js";
import { onEventPublished, type PublishedEvent } from "../../events.js";
import { startTypeEngine } from "../index.js";
import { exhibitsSqlite } from "../db/client.js";
import { getTypeBySlug, publish } from "../store.js";
import { createRecord, getRecord, listRecords, RecordLockedError, titleOf, updateRecord } from "../records.js";
import { feedCandidatesFor } from "../feedRules.js";
import { setOwnerZoneForTests, startOfDay } from "../zone.js";
import { bindingTargets, flushOutbox, runBindingAction, startBindings, stopBindings, withBinding } from "../bindings/runtime.js";
import { startConnectors, stopConnectors } from "../../connectors/registry.js";
import { emitSourceChange } from "../../connectors/runtime.js";
import { googleCalendar } from "../../connectors/googleCalendar/index.js";
import { ev, fakeGoogle } from "../../connectors/googleCalendar/fakeGoogle.js";
import type { Stored } from "../casts.js";

const EVENTS = "/calendar/v3/calendars/primary/events";
const g = fakeGoogle();
const events: PublishedEvent[] = [];
onEventPublished((e) => events.push(e));

const all = () => listRecords("event", { limit: 500 });
const byGoogleId = (id: string) => all().find((r) => r.provenance?.key === `1:primary:${id}`)!;
let boss = "";

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  setOwnerZoneForTests("Europe/Zagreb");
  boss = createRecord("person", { name: "Boss", emails: "boss@example.com" }).id;
  g.state.people["boss@example.com"] = boss;
  (g.state.calendarList[1]![0] as { accessRole?: string }).accessRole = "owner";
  g.state.full["1/primary"] = [
    ev("mine", { title: "Planning" }),
    ev("holiday", { allDay: true, title: "Holiday" }),
    ev("invite", {
      organizerSelf: false,
      title: "Their offsite",
      attendees: [{ email: "me@example.com", self: true, responseStatus: "needsAction" }, { email: "boss@example.com", displayName: "Boss" }],
    }),
  ];
  startBindings();
  await startConnectors([googleCalendar], {
    context: () => ({ ...g.ctx, emitChange: (kind, key, deleted = false) => emitSourceChange({ connector: "google-calendar", kind, key, deleted }) }),
  });
  await vi.waitFor(() => expect(all()).toHaveLength(3));
});

afterAll(async () => {
  stopBindings();
  await stopConnectors();
  setOwnerZoneForTests(null);
});

describe("the Event premade bound to Google Calendar", () => {
  it("mirrors Google events, all-day ones at midnight in the owner's zone, silently while hidden", () => {
    expect(getTypeBySlug("event")!.definition.hidden).toBe(true);
    const mine = byGoogleId("mine");
    expect(mine.values).toMatchObject({ title: "Planning", calendar: "1:primary", all_day: false, response: null, hidden: false });
    const raw = g.state.full["1/primary"]![0]!;
    expect(mine.values.start).toBe(new Date(raw.start.dateTime!).toISOString());
    const holiday = byGoogleId("holiday");
    const day = g.state.full["1/primary"]![1]!.start.date!;
    expect(holiday.values).toMatchObject({ all_day: true, start: new Date(startOfDay(day, "Europe/Zagreb")).toISOString() });
    expect(events.filter((e) => e.type.startsWith("event."))).toEqual([]);
  });

  it("links guests to People and locks someone else's invitation", () => {
    const invite = byGoogleId("invite");
    expect(invite.values).toMatchObject({ people: [boss], response: "needsAction" });
    const b = withBinding(invite).binding!;
    expect(b.lockReason).toBe("Read-only in Google Calendar");
    expect(b.actions.map((a) => a.id)).toEqual(["accept", "maybe", "decline"]);
    expect(b.live).toMatchObject({ htmlLink: "https://calendar.google.com/invite", calendarLabel: "Me" });
    expect(() => updateRecord(invite.id, { title: "Mine now" }, { actor: "me" })).toThrow(RecordLockedError);
    // Hide is local: allowed, and never sent.
    const calls = g.state.calls.length;
    updateRecord(invite.id, { hidden: true }, { actor: "me" });
    expect(g.state.calls.length).toBe(calls);
    updateRecord(invite.id, { hidden: false }, { actor: "me" });
  });

  it("accepts an invitation in Google", async () => {
    const invite = byGoogleId("invite");
    const live = ev("invite", { organizerSelf: false, attendees: [{ email: "me@example.com", self: true, responseStatus: "needsAction" }] });
    g.state.replies[`GET ${EVENTS}/invite`] = live;
    g.state.replies[`PATCH ${EVENTS}/invite`] = { ...live, updated: "u2", attendees: [{ email: "me@example.com", self: true, responseStatus: "accepted" }] };
    const dto = await runBindingAction(invite.id, "accept");
    expect(g.state.calls.at(-1)).toMatchObject({ method: "PATCH", url: expect.stringContaining("sendUpdates=all") });
    expect(dto.values.response).toBe("accepted");
    expect(dto.binding!.actions.map((a) => a.id)).toEqual(["maybe", "decline"]);
  });

  it("pushes an edit to the owner's own event", async () => {
    const mine = byGoogleId("mine");
    g.state.replies[`PATCH ${EVENTS}/mine`] = ev("mine", { title: "Planning v2", updated: "u2" });
    updateRecord(mine.id, { title: "Planning v2", location: "Room [[exhibit:e:01aaaaaaaaaaaaaaaaaaaaaaaa|4]]" }, { actor: "me" });
    await flushOutbox();
    const patch = g.state.calls.filter((c) => c.method === "PATCH").at(-1)!;
    expect(patch.url).toContain("sendUpdates=none");
    expect(patch.body).toMatchObject({ summary: "Planning v2", location: "Room 4" });
    expect(getRecord(mine.id)!.values.title).toBe("Planning v2");
  });

  it("offers the writable calendars as destinations", () => {
    expect(bindingTargets(getTypeBySlug("event")!)).toEqual([
      { binding: "bnd_google-calendar_event", field: "calendar", label: "Google Calendar", targets: [{ value: "1:primary", label: "Me", group: undefined }] },
    ]);
  });

  it("puts events under way and starting soon in the feed, never hidden ones", () => {
    const def = getTypeBySlug("event")!.definition;
    const now = new Date();
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
    const local = (title: string, start: number, end: number, extra: Record<string, unknown> = {}) =>
      createRecord("event", { title, start: at(start), end: at(end), ...extra }, { actor: "me" }).id;
    const going = local("Going on", -600_000, 600_000);
    const soon = local("Soon", 3_600_000, 7_200_000);
    const hidden = local("Hidden", -600_000, 600_000, { hidden: true });
    const query = (sql: string, params: Stored[]) => exhibitsSqlite.prepare(sql).all(...params) as Record<string, Stored>[];
    const candidates = feedCandidatesFor(def, now, query, (row) => titleOf(def, row));
    const reason = (id: string) => candidates.filter((c) => c.kind === "exhibit" && c.exhibitId === id).map((c) => c.reason);
    expect(reason(going)).toEqual(["Happening now"]);
    expect(reason(soon)).toEqual(["Soon"]);
    expect(reason(hidden)).toEqual([]);
    const preview = candidates.find((c) => c.kind === "exhibit" && c.exhibitId === going)!;
    expect(preview.kind === "exhibit" && preview.preview?.time).toEqual({ start: at(-600_000), end: at(600_000) });
  });
});

describe("the AI's event tools", () => {
  let server: ServerType;
  let url = "";
  const call = async (tool: string, args: Record<string, unknown>) =>
    JSON.parse(((await callChamberTool(url, TEST_INTERNAL_TOKEN, tool, args)) as { content: { text: string }[] }).content[0]!.text);

  beforeAll(async () => {
    // Visible types get tools; Event stays hidden until the cutover.
    publish({ typeId: getTypeBySlug("event")!.id, actor: "test", ops: [{ op: "set_type_meta", hidden: false }] });
    server = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve(s));
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/types`;
  });
  afterAll(() => server.close());

  it("lists a window soonest first, and offers destinations and answers", async () => {
    const names = (await listChamberTools(url, TEST_INTERNAL_TOKEN)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_events", "list_event_destinations", "accept_event", "maybe_event", "decline_event"]));
    const from = new Date(Date.now() + 12 * 3_600_000).toISOString();
    const to = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const listed = (await call("list_events", { from, to })) as { values: { title: string } }[];
    // Tomorrow's two timed events (the invitation was renamed by Google's reply).
    expect(listed.map((r) => r.values.title)).toEqual(expect.arrayContaining(["Planning v2", "invite"]));
    const starts = listed.map((r) => (r as unknown as { values: { start: string } }).values.start);
    expect([...starts].sort()).toEqual(starts);
    expect(await call("list_event_destinations", {})).toMatchObject([{ targets: [{ value: "1:primary" }] }]);
    expect(await call("decline_event", { id: byGoogleId("mine").id })).toMatchObject({ error: "locked" });
    expect(await call("update_event", { id: byGoogleId("invite").id, title: "x" })).toMatchObject({ error: "locked", fields: ["title"] });
  });
});
