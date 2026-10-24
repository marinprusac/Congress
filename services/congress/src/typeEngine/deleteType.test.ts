import { beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { recordsSqlite, runRecordsMigrations } from "./db/client.js";
import { DraftError, draftHash, previewDraft, publishDraft, setDraftOps, startDraft } from "./drafts.js";
import { createRecord, getRecord, updateRecord } from "./records.js";
import { getTypeBySlug, publish } from "./store.js";
import { installPremades } from "./premade/index.js";
import { NOTE } from "./premade/note.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runRecordsMigrations();
  installPremades([NOTE]);
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "author", label: "Author" },
      { op: "add_field", slug: "name", label: "Name", kind: "text" },
      { op: "set_title_field", field: "name" },
    ],
  });
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "book", label: "Book" },
      { op: "add_field", slug: "title", label: "Title", kind: "text" },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "writer", label: "Writer", kind: "relation", options: { target: "author" } },
      { op: "add_field", slug: "related", label: "Related", kind: "relation", options: { target: "book", many: true } },
    ],
  });
});

const tableExists = (name: string) => !!recordsSqlite.prepare("select 1 from sqlite_master where name = ?").get(name);

function deleteDraft(slug: string, threadId: number) {
  const d = startDraft({ threadId, slug });
  return setDraftOps(d.id, [{ op: "delete_type" }], "append");
}

describe("delete_type", () => {
  it("must be the draft's only op", () => {
    const d = startDraft({ threadId: 1, slug: "author" });
    expect(() => setDraftOps(d.id, [{ op: "delete_type" }, { op: "set_type_meta", hidden: true }], "append")).toThrow(DraftError);
  });

  it("is refused while another type has an active relation to it", () => {
    const d = deleteDraft("author", 2);
    expect(previewDraft(d.id).errors.join()).toContain("book.writer");
    expect(() => publishDraft(d.id, "ai-builder")).toThrow(/book\.writer/);
    expect(getTypeBySlug("author")).toBeDefined();
  });

  it("removes the type, its records and tables, and clears links to it", () => {
    const keep = createRecord("book", { title: "Keeper" }).id;
    const gone = createRecord("book", { title: "Doomed" }).id;
    updateRecord(keep, { related: [gone] });
    const bookTable = getTypeBySlug("book")!.definition.tableName;
    const relTable = getTypeBySlug("book")!.definition.fields.find((f) => f.slug === "related")!.column;

    // Delete author's blocker first: retire the relation field.
    const retire = startDraft({ threadId: 3, slug: "book" });
    setDraftOps(retire.id, [{ op: "retire_field", field: "writer" }], "append");
    publishDraft(retire.id, "ai-builder");

    const d = deleteDraft("book", 4);
    const preview = previewDraft(d.id);
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toEqual([{ label: "Books deleted", count: 2 }]);
    publishDraft(d.id, "ai-builder", draftHash(d));

    expect(getTypeBySlug("book")).toBeUndefined();
    expect(tableExists(bookTable)).toBe(false);
    expect(tableExists(relTable)).toBe(false);
    expect(getRecord(keep)).toBeNull();
  });

  it("keeps a deleted premade type from coming back at boot", () => {
    expect(getTypeBySlug("note")).toBeDefined();
    const d = deleteDraft("note", 5);
    publishDraft(d.id, "ai-builder");
    expect(getTypeBySlug("note")).toBeUndefined();

    installPremades([NOTE]);
    expect(getTypeBySlug("note")).toBeUndefined();
  });
});
