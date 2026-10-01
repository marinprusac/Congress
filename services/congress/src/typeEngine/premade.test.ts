import { beforeAll, describe, expect, it, vi } from "vitest";
import { runExhibitsMigrations } from "./db/client.js";
import { getTypeByPremadeKey, publish } from "./store.js";
import { installPremades, type Premade } from "./premade/index.js";
import { NOTE } from "./premade/note.js";
import { PERSON } from "./premade/person.js";
import { CHAT } from "./premade/chat.js";

beforeAll(() => runExhibitsMigrations());

describe("installPremades", () => {
  it("installs Note (visible after the cutover batch), once", () => {
    installPremades([NOTE]);
    installPremades([NOTE]);
    const note = getTypeByPremadeKey("note")!;
    expect(note).toMatchObject({ version: 2, origin: "premade", premadeBatch: 2, forked: false });
    expect(note.definition).toMatchObject({ slug: "note", hidden: false, tableName: "x_note" });
    expect(note.definition.fields.map((f) => [f.slug, f.kind])).toEqual([
      ["title", "text"],
      ["body", "richtext"],
      ["pinned", "boolean"],
    ]);
    expect(note.definition.fields[0]!.options.unique).toBeUndefined();
  });

  it("applies a new batch exactly once", () => {
    const next: Premade = { ...NOTE, batches: [...NOTE.batches, [{ op: "set_type_meta", icon: "notebook" }]] };
    installPremades([next]);
    installPremades([next]);
    expect(getTypeByPremadeKey("note")).toMatchObject({ version: 3, premadeBatch: 3 });
  });

  it("marks a type forked when the owner's edits break a batch, without throwing", () => {
    const note = getTypeByPremadeKey("note")!;
    publish({ typeId: note.id, ops: [{ op: "retire_field", field: "pinned" }], actor: "me" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const next: Premade = {
      ...NOTE,
      batches: [...NOTE.batches, [{ op: "set_type_meta", icon: "notebook" }], [{ op: "rename_field", field: "pinned", label: "Starred" }]],
    };
    expect(() => installPremades([next])).not.toThrow();
    expect(getTypeByPremadeKey("note")).toMatchObject({ forked: true, premadeBatch: 3 });
    warn.mockRestore();
  });

  it("installs Person with email/phone keys and the corresponded auto-create policy", () => {
    installPremades([PERSON]);
    const person = getTypeByPremadeKey("person")!;
    expect(person).toMatchObject({ version: 1, origin: "premade", forked: false });
    expect(person.definition).toMatchObject({ slug: "person", pluralLabel: "People", autoCreate: "corresponded", hidden: false });
    expect(person.definition.fields.map((f) => [f.slug, f.kind, f.options.key ?? null])).toEqual([
      ["name", "text", null],
      ["emails", "text", "email"],
      ["phones", "text", "phone"],
      ["birthday", "date", null],
      ["notes", "richtext", null],
    ]);
  });

  it("hides Chat's non-editable bookkeeping fields from the record screen", () => {
    installPremades([PERSON, CHAT]);
    const chat = getTypeByPremadeKey("chat")!;
    const hidden = chat.definition.fields.filter((f) => f.options.hidden).map((f) => f.slug);
    expect(hidden).toEqual(["unread", "has_unread", "last_from_me", "group"]);
    // Still stored, so feed rules keep working.
    const hasUnread = chat.definition.fields.find((f) => f.slug === "has_unread")!;
    expect(chat.definition.feedRules[0]!.and).toContainEqual({ field: hasUnread.id, value: true });
  });

  it("refuses a hidden required field", () => {
    expect(() =>
      publish({
        ops: [
          { op: "create_type", slug: "gizmo", label: "Gizmo" },
          { op: "add_field", slug: "name", label: "Name", kind: "text", options: { required: true, hidden: true } },
          { op: "set_title_field", field: "name" },
        ],
        actor: "test",
        origin: "custom",
      }),
    ).toThrow(/hidden and required/);
  });
});
