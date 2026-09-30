import { existsSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { exhibitsDb, runExhibitsMigrations } from "./db/client.js";
import { files } from "./db/schema.js";
import { publish } from "./store.js";
import { createRecord, deleteRecord, RecordValidationError, updateRecord } from "./records.js";
import { cleanMime, collectOrphans, filePath, filesDir, FileTooLargeError, storeUpload } from "./files.js";

const DAY = 86_400_000;
const body = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
const orphanedAt = (id: string) => exhibitsDb.select().from(files).where(eq(files.id, id)).get()?.orphanedAt ?? null;

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "scan", label: "Scan" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "file", label: "File", kind: "file", options: { required: true } },
    ],
  });
});

describe("file storage", () => {
  it("streams an upload to disk with its hash and size", async () => {
    const ref = await storeUpload(body("hello"), { name: "a/b.txt", mime: "text/plain; charset=utf-8" });
    expect(ref).toMatchObject({ name: "a_b.txt", mime: "text/plain", size: 5 });
    expect(existsSync(filePath(ref.id))).toBe(true);
    expect(exhibitsDb.select().from(files).where(eq(files.id, ref.id)).get()?.sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    expect(cleanMime("<script>")).toBe("application/octet-stream");
  });

  it("refuses an upload past the cap and leaves nothing behind", async () => {
    const before = readdirSync(filesDir()).length;
    await expect(storeUpload(body("0123456789"), { name: "big" }, 5)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(readdirSync(filesDir()).length).toBe(before);
  });

  it("attaches files to records, orphans replaced ones and collects them after the grace period", async () => {
    const first = await storeUpload(body("one"), { name: "one.pdf", mime: "application/pdf" });
    const second = await storeUpload(body("two"), { name: "two.pdf", mime: "application/pdf" });
    expect(orphanedAt(first.id)).not.toBeNull();

    const rec = createRecord("scan", { title: "Lease", file: first.id });
    expect(rec.values.file).toEqual(first);
    expect(orphanedAt(first.id)).toBeNull();

    updateRecord(rec.id, { file: second.id });
    expect(orphanedAt(first.id)).not.toBeNull();
    expect(orphanedAt(second.id)).toBeNull();

    expect(collectOrphans(new Date(Date.now() + 13 * DAY))).toBe(0);
    expect(existsSync(filePath(first.id))).toBe(true);
    collectOrphans(new Date(Date.now() + 15 * DAY));
    expect(existsSync(filePath(first.id))).toBe(false);
    expect(existsSync(filePath(second.id))).toBe(true);

    deleteRecord(rec.id);
    expect(orphanedAt(second.id)).not.toBeNull();
  });

  it("rejects a file id that was never uploaded", () => {
    expect(() => createRecord("scan", { title: "Ghost", file: "01jxxxxxxxxxxxxxxxxxxxxxxx" })).toThrow(RecordValidationError);
  });
});
