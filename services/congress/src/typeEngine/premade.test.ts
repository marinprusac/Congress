import { beforeAll, describe, expect, it, vi } from "vitest";
import { runRecordsMigrations } from "./db/client.js";
import { getTypeByPremadeKey, publish } from "./store.js";
import { installPremades, type Premade } from "./premade/index.js";
import { NOTE } from "./premade/note.js";
import { PERSON } from "./premade/person.js";

beforeAll(() => runRecordsMigrations());

describe("installPremades", () => {
  it("installs Note (visible after the cutover batch), once", () => {
    installPremades([NOTE]);
    installPremades([NOTE]);
    const note = getTypeByPremadeKey("note")!;
    expect(note).toMatchObject({ version: 4, origin: "premade", premadeBatch: 4, forked: false });
    expect(note.definition).toMatchObject({ slug: "note", hidden: false, tableName: "x_note", icon: "sticky-note", color: "ink" });
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
    expect(getTypeByPremadeKey("note")).toMatchObject({ version: 5, premadeBatch: 5 });
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
    expect(getTypeByPremadeKey("note")).toMatchObject({ forked: true, premadeBatch: 5 });
    warn.mockRestore();
  });

  it("installs Person with email/phone keys and the corresponded auto-create policy", () => {
    installPremades([PERSON]);
    const person = getTypeByPremadeKey("person")!;
    expect(person).toMatchObject({ version: 3, origin: "premade", forked: false });
    expect(person.definition).toMatchObject({ slug: "person", icon: "user", color: "lilac", pluralLabel: "People", autoCreate: "corresponded", hidden: false });
    expect(person.definition.fields.map((f) => [f.slug, f.kind, f.options.key ?? null])).toEqual([
      ["name", "text", null],
      ["emails", "text", "email"],
      ["phones", "text", "phone"],
      ["birthday", "date", null],
      ["notes", "richtext", null],
    ]);
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
