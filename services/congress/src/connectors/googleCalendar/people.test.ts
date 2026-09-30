import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { startTypeEngine } from "../../typeEngine/index.js";
import { getTypeBySlug, publish } from "../../typeEngine/store.js";
import { createRecord } from "../../typeEngine/records.js";
import { findPerson } from "../registry.js";
import { runGcalMigrations } from "./db/client.js";
import { attendeesOf, eventKey } from "./cache.js";
import { ev, fakeGoogle, resetGcalCache } from "./fakeGoogle.js";
import { eventFacts } from "./facts.js";
import { guestsToLink } from "./people.js";
import { syncAll } from "./sync.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  runGcalMigrations();
});
beforeEach(() => resetGcalCache());

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

describe("guests to link", () => {
  it("skips self, rooms, own accounts and already-linked guests", () => {
    const row = { self: false, resource: false, personId: null };
    const rows = [
      { ...row, email: "a@x.io" },
      { ...row, email: "me@x.io", self: true },
      { ...row, email: "room@x.io", resource: true },
      { ...row, email: "alt@x.io" },
      { ...row, email: "b@x.io", personId: "p1" },
    ];
    expect(guestsToLink(rows, new Set(["alt@x.io"])).map((r) => r.email)).toEqual(["a@x.io"]);
  });
});

describe("calendar guests and People", () => {
  it("never creates People, even from events the owner organized", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [
      ev("mine", { attendees: [guest("ana@example.com", { displayName: "Ana" })] }),
      ev("yes", { organizerSelf: false, attendees: [me("accepted"), guest("cy@example.com")] }),
    ];
    await syncAll(ctx);
    expect(state.resolved).toEqual([]);
    expect(state.found.sort()).toEqual(["ana@example.com", "cy@example.com"]);
  });

  it("links guests to People that exist, including ones added later", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [
      ev("a", { attendees: [guest("dee@example.com"), guest("eve@example.com")] }),
      ev("b", { organizerSelf: false, attendees: [me("needsAction"), guest("dee@example.com")] }),
    ];
    state.people["dee@example.com"] = "p-dee";
    await syncAll(ctx);
    const personOf = (id: string, email: string) => attendeesOf(eventKey(1, "primary", id)).find((a) => a.email === email)!.personId;
    expect(personOf("a", "dee@example.com")).toBe("p-dee");
    expect(personOf("b", "dee@example.com")).toBe("p-dee");
    expect(personOf("a", "eve@example.com")).toBeNull();
    // One lookup per email per sync.
    expect(state.found.filter((e) => e === "dee@example.com")).toHaveLength(1);

    state.people["eve@example.com"] = "p-eve";
    state.found = [];
    await syncAll(ctx);
    expect(personOf("a", "eve@example.com")).toBe("p-eve");
    expect(state.found).toEqual(["eve@example.com"]);
  });

  it("keeps a link when the event changes", async () => {
    const { state, ctx } = fakeGoogle();
    state.people["dee@example.com"] = "p-dee";
    state.full["1/primary"] = [ev("a", { attendees: [guest("dee@example.com")] })];
    await syncAll(ctx);
    state.changes["1/primary"] = [ev("a", { updated: "u2", title: "Moved", attendees: [guest("Dee@Example.com")] })];
    state.found = [];
    await syncAll(ctx);
    expect(attendeesOf(eventKey(1, "primary", "a"))[0]!.personId).toBe("p-dee");
    expect(state.found).toEqual([]);
  });
});

describe("findPerson", () => {
  it("finds by normalized email, and nothing once Person is hidden", () => {
    const id = createRecord("person", { name: "Ana", emails: "ana@example.com" }).id;
    expect(findPerson(" ANA@example.com ")).toBe(id);
    expect(findPerson("nobody@example.com")).toBeNull();
    publish({ typeId: getTypeBySlug("person")!.id, actor: "test", ops: [{ op: "set_type_meta", hidden: true }] });
    expect(findPerson("ana@example.com")).toBeNull();
  });
});
