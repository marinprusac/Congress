import { beforeAll, describe, expect, it, vi } from "vitest";
import { runExhibitsMigrations } from "./db/client.js";
import { getTypeByPremadeKey, publish } from "./store.js";
import { installPremades, type Premade } from "./premade/index.js";
import { NOTE } from "./premade/note.js";

beforeAll(() => runExhibitsMigrations());

describe("installPremades", () => {
  it("installs Note hidden, once", () => {
    installPremades([NOTE]);
    installPremades([NOTE]);
    const note = getTypeByPremadeKey("note")!;
    expect(note).toMatchObject({ version: 1, origin: "premade", premadeBatch: 1, forked: false });
    expect(note.definition).toMatchObject({ slug: "note", hidden: true, tableName: "x_note" });
    expect(note.definition.fields.map((f) => [f.slug, f.kind])).toEqual([
      ["title", "text"],
      ["body", "richtext"],
      ["pinned", "boolean"],
    ]);
    expect(note.definition.fields[0]!.options.unique).toBeUndefined();
  });

  it("applies a new batch exactly once", () => {
    const v2: Premade = { ...NOTE, batches: [...NOTE.batches, [{ op: "set_type_meta", icon: "notebook" }]] };
    installPremades([v2]);
    installPremades([v2]);
    expect(getTypeByPremadeKey("note")).toMatchObject({ version: 2, premadeBatch: 2 });
  });

  it("marks a type forked when the owner's edits break a batch, without throwing", () => {
    const note = getTypeByPremadeKey("note")!;
    publish({ typeId: note.id, ops: [{ op: "retire_field", field: "pinned" }], actor: "me" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const v3: Premade = { ...NOTE, batches: [...NOTE.batches, [{ op: "set_type_meta", icon: "notebook" }], [{ op: "rename_field", field: "pinned", label: "Starred" }]] };
    expect(() => installPremades([v3])).not.toThrow();
    expect(getTypeByPremadeKey("note")).toMatchObject({ forked: true, premadeBatch: 2 });
    warn.mockRestore();
  });
});
