import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { startTypeEngine } from "../index.js";
import { addLegacyAlias, resolveLegacyAlias } from "../aliases.js";
import { getTypeBySlug } from "../store.js";
import { findByKey } from "../keys.js";
import { addManualRef, createRecord, getRecord, manualRefs, retypeRecord, RecordValidationError } from "../records.js";
import { importPersonNotes, parseBirthday, parsePersonNote } from "./personNotes.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
});

describe("parsing a person note", () => {
  it("lifts birthday, emails and phones, keeping everything else", () => {
    const p = parsePersonNote(
      " Patrik Baršun ",
      "- my boyfriend\n- anniversary: 3 June 2021\n- birthday: 2 May 2003\n- email: P@Example.com\n- phone: +46 70 123 45 67\n- email: not-an-email"
    );
    expect(p).toEqual({
      name: "Patrik Baršun",
      birthday: "2003-05-02",
      emails: ["P@Example.com"],
      phones: ["+46 70 123 45 67"],
      notes: "- my boyfriend\n- anniversary: 3 June 2021\n- email: not-an-email",
    });
  });

  it("reads the birthday forms in the notes", () => {
    expect(parseBirthday("1999-07-06")).toBe("1999-07-06");
    expect(parseBirthday("2 May 2003")).toBe("2003-05-02");
    expect(parseBirthday("May 2, 2003")).toBe("2003-05-02");
    expect(parseBirthday("21 Nov. 1970")).toBe("1970-11-21");
    expect(parseBirthday("sometime in May")).toBeNull();
  });
});

describe("retypeRecord", () => {
  it("keeps id, dates, manual refs, aliases and incoming links", () => {
    const note = createRecord("note", { title: "Ana", body: "- my friend\n- birthday: 2001-01-02" }, { at: new Date("2026-09-01T10:00:00Z") });
    const other = createRecord("note", { title: "Journal", body: `Met [[exhibit:e:${note.id}|Ana]] today` });
    addManualRef(note.id, other.id);
    addLegacyAlias("notes", "note-7", note.id);

    const person = retypeRecord(note.id, "person", { name: "Ana", birthday: "2001-01-02", emails: "ana@example.com", notes: "- my friend" });
    expect(person).toMatchObject({ id: note.id, type: "person", createdAt: "2026-09-01T10:00:00.000Z", values: { name: "Ana", birthday: "2001-01-02" } });
    expect(manualRefs(note.id)).toEqual([other.id]);
    expect(resolveLegacyAlias("notes", "note-7")).toBe(note.id);
    expect(findByKey(getTypeBySlug("person")!.id, "email", "ana@example.com")).toBe(note.id);
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.id, note.id)).get()).toMatchObject({ type: "person", name: "Ana" });
    expect(db.select().from(exhibitRefs).where(eq(exhibitRefs.targetId, note.id)).all().length).toBeGreaterThan(0);
    expect(() => retypeRecord(note.id, "person", { name: "Ana" })).toThrow(RecordValidationError);
  });
});

describe("importPersonNotes", () => {
  it("moves the listed notes once and skips anything else", () => {
    const a = createRecord("note", { title: "Bo", body: "- my brother\n- birthday: 1996-09-21" });
    const task = createRecord("task", { title: "Not a note" });
    const first = importPersonNotes([a.id, task.id, "01nonexistent00000000000000"]);
    expect(first.moved).toEqual(["Bo (birthday yes, 0 email, 0 phone)"]);
    expect(first.skipped).toEqual([task.id, "01nonexistent00000000000000"]);
    expect(getRecord(a.id)).toMatchObject({ type: "person", values: { name: "Bo", birthday: "1996-09-21", notes: "- my brother" } });

    const b = createRecord("note", { title: "Later", body: "" });
    expect(importPersonNotes([b.id]).moved).toEqual([]);
    expect(getRecord(b.id)!.type).toBe("note");
  });
});
