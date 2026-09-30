import { beforeAll, describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { runExhibitsMigrations } from "./db/client.js";
import { DraftError, discardDraft, draftHash, getDraft, previewDraft, publishDraft, setDraftOps, startDraft } from "./drafts.js";
import { getTypeBySlug, publish, PublishError } from "./store.js";
import { installPremades } from "./premade/index.js";
import { NOTE } from "./premade/note.js";

const newBook: Operation[] = [
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text" },
  { op: "set_title_field", field: "title" },
];

beforeAll(() => {
  runExhibitsMigrations();
  installPremades([NOTE]);
});

describe("drafts", () => {
  it("collects ops for a new type, previews them and publishes once", () => {
    const draft = startDraft({ threadId: 1 });
    setDraftOps(draft.id, newBook.slice(0, 2), "append");
    expect(previewDraft(draft.id).errors).toEqual([expect.stringMatching(/title field/)]);

    const full = setDraftOps(draft.id, newBook.slice(2), "append");
    expect(full.ops).toHaveLength(3);
    expect(full.slug).toBe("book");
    const preview = previewDraft(draft.id);
    expect(preview.errors).toEqual([]);
    expect(preview.changes[0]?.text).toBe("Create type “Book” (Books)");
    expect(getTypeBySlug("book")).toBeUndefined();

    const { type } = publishDraft(draft.id, "ai-builder", draftHash(full));
    expect(type.definition.slug).toBe("book");
    expect(getDraft(draft.id)).toMatchObject({ state: "published", typeId: type.id, publishedVersion: 1 });
    expect(() => publishDraft(draft.id, "ai-builder")).toThrow(DraftError);
  });

  it("rejects invalid ops outright and refuses a changed draft", () => {
    const draft = startDraft({ threadId: 1, slug: "book" });
    expect(() => setDraftOps(draft.id, [{ op: "add_field", slug: "Bad Slug" }], "append")).toThrow(/op #1/);
    const v1 = setDraftOps(draft.id, [{ op: "add_field", slug: "author", label: "Author", kind: "text" }], "append");
    const hash = draftHash(v1);
    setDraftOps(draft.id, [{ op: "add_field", slug: "isbn", label: "ISBN", kind: "text" }], "replace");
    expect(() => publishDraft(draft.id, "ai-builder", hash)).toThrow(/changed after it was reviewed/);
    discardDraft(draft.id);
  });

  it("reuses a thread's open draft for a type, and keeps threads apart", () => {
    const a = startDraft({ threadId: 2, slug: "book" });
    expect(startDraft({ threadId: 2, slug: "book" }).id).toBe(a.id);
    expect(startDraft({ threadId: 3, slug: "book" }).id).not.toBe(a.id);
    expect(() => startDraft({ threadId: 2, slug: "book", rollbackTo: 1 })).toThrow(/already open/);
    discardDraft(a.id);
    expect(() => setDraftOps(a.id, [], "append")).toThrow(/discarded/);
  });

  it("goes stale when the type changes underneath it", () => {
    const draft = startDraft({ threadId: 4, slug: "book" });
    setDraftOps(draft.id, [{ op: "add_field", slug: "pages", label: "Pages", kind: "number" }], "append");
    const type = getTypeBySlug("book")!;
    publish({ typeId: type.id, ops: [{ op: "add_field", slug: "year", label: "Year", kind: "number" }], actor: "test" });
    expect(getDraft(draft.id).stale).toBe(true);
    expect(previewDraft(draft.id).errors[0]).toMatch(/changed since/);
    expect(() => publishDraft(draft.id, "ai-builder")).toThrow(/changed since/);
  });

  it("keeps a failed publish open with its problems", () => {
    const draft = startDraft({ threadId: 5 });
    setDraftOps(draft.id, newBook, "append");
    expect(() => publishDraft(draft.id, "ai-builder")).toThrow(PublishError);
    expect(getDraft(draft.id)).toMatchObject({ state: "open", problems: [expect.stringMatching(/already exists/)] });
  });

  it("publishes a rollback draft through rollback", () => {
    const type = getTypeBySlug("book")!;
    const draft = startDraft({ threadId: 6, slug: "book", rollbackTo: 1 });
    expect(() => setDraftOps(draft.id, newBook, "append")).toThrow(/rollback/);
    expect(previewDraft(draft.id).changes.map((c) => c.text)).toContain("Retire “Year”");
    const { type: back } = publishDraft(draft.id, "ai-builder");
    expect(back.version).toBe(type.version + 1);
    expect(back.definition.fields.find((f) => f.slug === "year")?.retired).toBe(true);
    expect(() => startDraft({ threadId: 6, slug: "book", rollbackTo: back.version })).toThrow(/no earlier version/);
  });

  it("marks a premade type forked when a draft changes it", () => {
    const draft = startDraft({ threadId: 7, slug: "note" });
    setDraftOps(draft.id, [{ op: "add_field", slug: "mood", label: "Mood", kind: "text" }], "append");
    const { type } = publishDraft(draft.id, "ai-builder");
    expect(type.forked).toBe(true);
    expect(getTypeBySlug("note")?.forked).toBe(true);
  });
});
