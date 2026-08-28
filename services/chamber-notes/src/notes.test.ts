import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { notes } from "./db/schema.js";
import { createNote, parseFrontmatter, reconstructContent, TitleConflictError, titleExists, updateNote } from "./notes.js";

beforeAll(() => runMigrations(migrationsDir("chamber-notes")));

beforeEach(() => {
  db.run(sql`delete from notes`);
});

function insertNote(title: string) {
  const now = new Date();
  return db
    .insert(notes)
    .values({ title, frontmatterJson: "{}", body: "", createdAt: now, updatedAt: now })
    .returning()
    .get();
}

describe("parseFrontmatter / reconstructContent", () => {
  it("parses a frontmatter block into { frontmatter, body }, with leading whitespace stripped from body", () => {
    const { frontmatter, body } = parseFrontmatter("---\ntitle: Hello\n---\n\nBody text");
    expect(frontmatter).toEqual({ title: "Hello" });
    expect(body).toBe("Body text");
  });

  it("returns an empty frontmatter object and the body unchanged when there is no frontmatter block", () => {
    const { frontmatter, body } = parseFrontmatter("Just plain body text");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just plain body text");
  });

  it("returns the body verbatim for an empty frontmatter object, rather than injecting an empty block", () => {
    expect(reconstructContent({}, "Plain body")).toBe("Plain body");
  });

  it("round-trips a non-empty frontmatter object through parseFrontmatter(reconstructContent(...))", () => {
    // gray-matter's stringify appends a trailing newline to the body it
    // reconstructs - pinning that as the actual round-trip shape rather than
    // an idealized byte-identical one.
    const original = { title: "Hello", pinned: true };
    const reconstructed = reconstructContent(original, "Body text");
    const { frontmatter, body } = parseFrontmatter(reconstructed);
    expect(frontmatter).toEqual(original);
    expect(body).toBe("Body text\n");
  });
});

describe("titleExists", () => {
  it("returns false when no note has that title", async () => {
    await expect(titleExists("Weekly Review")).resolves.toBe(false);
  });

  it("returns true for an exact-case match", async () => {
    insertNote("Weekly Review");
    await expect(titleExists("Weekly Review")).resolves.toBe(true);
  });

  it("matches case-insensitively", async () => {
    insertNote("Weekly Review");
    await expect(titleExists("weekly review")).resolves.toBe(true);
    await expect(titleExists("WEEKLY REVIEW")).resolves.toBe(true);
  });

  it("excludeId excludes that note's own row but still catches a different note with the same title", async () => {
    const a = insertNote("Weekly Review");
    await expect(titleExists("Weekly Review", a.id)).resolves.toBe(false);

    const b = insertNote("Other Note");
    await expect(titleExists("Weekly Review", b.id)).resolves.toBe(true);
  });
});

describe("createNote / updateNote TitleConflictError wiring", () => {
  it("createNote throws TitleConflictError on a case-insensitive duplicate title", async () => {
    await createNote({ title: "Weekly Review", content: "" });
    await expect(createNote({ title: "weekly review", content: "" })).rejects.toThrow(TitleConflictError);
  });

  it("updateNote throws TitleConflictError when renamed to another note's title", async () => {
    await createNote({ title: "Weekly Review", content: "" });
    const other = await createNote({ title: "Other Note", content: "" });
    await expect(updateNote(other.id, { title: "Weekly Review" })).rejects.toThrow(TitleConflictError);
  });

  it("updateNote does not throw when 'renamed' to its own current title", async () => {
    const note = await createNote({ title: "Weekly Review", content: "" });
    await expect(updateNote(note.id, { title: "Weekly Review", pinned: true })).resolves.toMatchObject({
      title: "Weekly Review",
      pinned: true,
    });
  });

  it("updateNote succeeds renaming to a genuinely free title", async () => {
    const note = await createNote({ title: "Weekly Review", content: "" });
    await expect(updateNote(note.id, { title: "Weekly Review v2" })).resolves.toMatchObject({
      title: "Weekly Review v2",
    });
  });
});
