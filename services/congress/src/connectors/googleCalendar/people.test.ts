import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { startTypeEngine } from "../../typeEngine/index.js";
import { getTypeBySlug, publish } from "../../typeEngine/store.js";
import { findByKey } from "../../typeEngine/keys.js";
import { getRecord } from "../../typeEngine/records.js";
import { resolvePerson } from "../registry.js";
import { runGcalMigrations } from "./db/client.js";
import { attendeesOf, eventKey, setSetting } from "./cache.js";
import { ev, fakeGoogle, resetGcalCache } from "./fakeGoogle.js";
import { eventFacts } from "./facts.js";
import { attendeeEvidence, attendeesToResolve } from "./people.js";
import { features, syncAll } from "./sync.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  runGcalMigrations();
});
beforeEach(() => {
  resetGcalCache();
  features.people = true;
});
afterEach(() => {
  features.people = false;
});

const guest = (email: string, extra: object = {}) => ({ email, ...extra });
const me = (responseStatus: string) => ({ email: "me@example.com", self: true, responseStatus });

describe("event facts", () => {
  it("follow organizer, guest rights and invitations", () => {
    const base = { hasOrganizer: true, organizerSelf: false, guestsCanModify: false, selfResponse: "needsAction", hasSelfAttendee: true };
    expect(eventFacts(base)).toEqual({ editable: false, isInvitation: true, canRsvp: true, selfResponse: "needsAction" });
    expect(eventFacts({ ...base, guestsCanModify: true }).editable).toBe(true);
    expect(eventFacts({ ...base, organizerSelf: true })).toMatchObject({ editable: true, isInvitation: false, canRsvp: false });
    expect(eventFacts({ ...base, hasOrganizer: false, hasSelfAttendee: false })).toMatchObject({ editable: true, isInvitation: false });
    expect(eventFacts({ ...base, selfResponse: "maybe" }).selfResponse).toBeNull();
  });
});

describe("attendee evidence", () => {
  it("is corresponded only for events the owner organized or accepted", () => {
    expect(attendeeEvidence({ organizerSelf: true, selfResponse: null })).toBe("corresponded");
    expect(attendeeEvidence({ organizerSelf: false, selfResponse: "accepted" })).toBe("corresponded");
    for (const r of ["needsAction", "declined", "tentative", null]) expect(attendeeEvidence({ organizerSelf: false, selfResponse: r })).toBe("seen");
  });

  it("skips self, rooms, own accounts, linked and already-tried guests", () => {
    const row = { displayName: null, self: false, resource: false, personId: null, triedEvidence: null };
    const rows = [
      { ...row, email: "a@x.io" },
      { ...row, email: "me@x.io", self: true },
      { ...row, email: "room@x.io", resource: true },
      { ...row, email: "alt@x.io" },
      { ...row, email: "b@x.io", personId: "p1" },
      { ...row, email: "c@x.io", triedEvidence: "corresponded" },
      { ...row, email: "d@x.io", triedEvidence: "seen" },
    ];
    expect(attendeesToResolve(rows, "corresponded", new Set(["alt@x.io"])).map((r) => r.email)).toEqual(["a@x.io", "d@x.io"]);
    expect(attendeesToResolve(rows, "seen", new Set()).map((r) => r.email)).toEqual(["a@x.io", "alt@x.io"]);
  });
});

describe("people from calendar guests", () => {
  it("creates People only from events the owner organized or accepted", async () => {
    const { state, ctx } = fakeGoogle();
    ctx.people.resolve = (input, evidence) => resolvePerson(input, evidence, "google-calendar");
    state.accounts.push({ id: 2, label: "Work", email: "me@work.io", needsReconnect: false });
    state.calendarList[2] = [];
    state.full["1/primary"] = [
      ev("mine", { attendees: [guest("ana@example.com", { displayName: "Ana Kovač" }), guest("room@x.io", { resource: true }), guest("me@work.io")] }),
      ev("invite", { organizerSelf: false, attendees: [me("needsAction"), guest("boss@example.com"), guest("bo@example.com")] }),
      ev("yes", { organizerSelf: false, attendees: [me("accepted"), guest("cy@example.com")] }),
    ];
    await syncAll(ctx);

    const person = getTypeBySlug("person")!;
    const ana = findByKey(person.id, "email", "ana@example.com");
    expect(getRecord(ana!)!.values).toMatchObject({ name: "Ana Kovač", emails: "ana@example.com" });
    expect(getRecord(findByKey(person.id, "email", "cy@example.com")!)!.values.name).toBe("cy@example.com");
    for (const email of ["room@x.io", "me@work.io", "me@example.com", "boss@example.com", "bo@example.com"]) {
      expect(findByKey(person.id, "email", email)).toBeUndefined();
    }
    expect(attendeesOf(eventKey(1, "primary", "mine")).find((a) => a.email === "ana@example.com")!.personId).toBe(ana);
  });

  it("links a seen guest to an existing Person, and retries when the owner accepts", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [ev("invite", { organizerSelf: false, attendees: [me("needsAction"), guest("dee@example.com")] })];
    await syncAll(ctx);
    await syncAll(ctx);
    expect(state.resolved).toEqual([{ email: "dee@example.com", evidence: "seen" }]);

    state.changes["1/primary"] = [ev("invite", { organizerSelf: false, updated: "u2", attendees: [me("accepted"), guest("dee@example.com")] })];
    await syncAll(ctx);
    expect(state.resolved.at(-1)).toEqual({ email: "dee@example.com", evidence: "corresponded" });
    expect(attendeesOf(eventKey(1, "primary", "invite")).find((a) => a.email === "dee@example.com")!.personId).toBe("person-dee@example.com");
    await syncAll(ctx);
    expect(state.resolved).toHaveLength(2);
  });

  it("does nothing while switched off, then covers events synced before", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [ev("mine", { attendees: [guest("eve@example.com")] })];
    setSetting("people", false);
    await syncAll(ctx);
    features.people = false;
    setSetting("people", true);
    await syncAll(ctx);
    expect(state.resolved).toEqual([]);
    features.people = true;
    await syncAll(ctx);
    expect(state.resolved).toEqual([{ email: "eve@example.com", evidence: "corresponded" }]);
  });

  it("is a no-op when the Person type is hidden", () => {
    const person = getTypeBySlug("person")!;
    publish({ typeId: person.id, actor: "test", ops: [{ op: "set_type_meta", hidden: true }] });
    expect(resolvePerson({ email: "zed@example.com" }, "owner", "google-calendar")).toBeNull();
    expect(findByKey(person.id, "email", "zed@example.com")).toBeUndefined();
  });
});
