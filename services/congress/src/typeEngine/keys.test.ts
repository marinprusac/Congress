import { beforeAll, describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { exhibitsSqlite, runExhibitsMigrations } from "./db/client.js";
import { getTypeBySlug, previewPublish, publish, PublishError } from "./store.js";
import { createRecord, deleteRecord, RecordConflictError, RecordValidationError, updateRecord } from "./records.js";
import { findByKey } from "./keys.js";
import { cleanKeyText, normalizeKey, splitKeyText } from "./keyValues.js";

const contact: Operation[] = [
  { op: "create_type", slug: "contact", label: "Contact" },
  { op: "add_field", slug: "name", label: "Name", kind: "text" },
  { op: "set_title_field", field: "name" },
  { op: "add_field", slug: "emails", label: "Emails", kind: "text", options: { key: "email" } },
  { op: "add_field", slug: "phone", label: "Phone", kind: "text" },
];

const typeId = () => getTypeBySlug("contact")!.id;
const keyRows = () => exhibitsSqlite.prepare("SELECT kind, value FROM record_keys ORDER BY kind, value").all();

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  publish({ actor: "test", ops: contact });
});

describe("key values", () => {
  it("normalizes emails and phones, and rejects what isn't one", () => {
    expect(normalizeKey("email", " Ana@Example.COM ")).toBe("ana@example.com");
    expect(normalizeKey("email", "ana at example")).toBeNull();
    expect(normalizeKey("phone", "+385 (91) 123-4567")).toBe("+385911234567");
    expect(normalizeKey("phone", "00385 91 123 4567")).toBe("+385911234567");
    expect(normalizeKey("phone", "091 123 4567")).toBe("0911234567");
    expect(normalizeKey("phone", "12")).toBeNull();
    expect(splitKeyText("a@x.io,\n b@x.io ;; \n")).toEqual(["a@x.io", "b@x.io"]);
    expect(cleanKeyText(" a@x.io \n\n B@x.io ")).toBe("a@x.io\nB@x.io");
  });
});

describe("record keys", () => {
  it("indexes every line, keeps the text as written and refuses invalid lines", () => {
    const ana = createRecord("contact", { name: "Ana", emails: "Ana@Example.com\n ana@work.io " });
    expect(ana.values.emails).toBe("Ana@Example.com\nana@work.io");
    expect(findByKey(typeId(), "email", "ana@example.com")).toBe(ana.id);
    expect(findByKey(typeId(), "email", "ana@work.io")).toBe(ana.id);
    expect(() => createRecord("contact", { name: "Bad", emails: "not-an-email" })).toThrow(RecordValidationError);
  });

  it("refuses a key another record has, and rewrites keys on update and delete", () => {
    const bob = createRecord("contact", { name: "Bob", emails: "bob@example.com" });
    expect(() => createRecord("contact", { name: "Bob 2", emails: "BOB@example.com" })).toThrow(RecordConflictError);
    expect(() => updateRecord(bob.id, { emails: "bob@example.com\nana@work.io" })).toThrow(/ana@work\.io/);
    expect(findByKey(typeId(), "email", "bob@example.com")).toBe(bob.id);

    updateRecord(bob.id, { emails: "robert@example.com" });
    expect(findByKey(typeId(), "email", "bob@example.com")).toBeUndefined();
    expect(findByKey(typeId(), "email", "robert@example.com")).toBe(bob.id);
    deleteRecord(bob.id);
    expect(findByKey(typeId(), "email", "robert@example.com")).toBeUndefined();
  });

  it("backfills keys when a publish makes a field a key, and blocks on shared values", () => {
    createRecord("contact", { name: "Cy", phone: "091 111 2222" });
    const dup = createRecord("contact", { name: "Cy twin", phone: "0911112222" });
    const makeKey: Operation[] = [{ op: "set_field_options", field: "phone", options: { key: "phone" } }];

    const preview = previewPublish(typeId(), makeKey);
    expect(preview.blockers).toEqual([{ label: "records sharing the key phone 0911112222", count: 2 }]);
    expect(() => publish({ typeId: typeId(), actor: "test", ops: makeKey })).toThrow(PublishError);
    expect(getTypeBySlug("contact")!.version).toBe(1);

    deleteRecord(dup.id);
    expect(previewPublish(typeId(), makeKey).blockers).toEqual([]);
    publish({ typeId: typeId(), actor: "test", ops: makeKey });
    expect(keyRows()).toContainEqual({ kind: "phone", value: "0911112222" });

    // Retiring a key field drops its keys.
    publish({ typeId: typeId(), actor: "test", ops: [{ op: "retire_field", field: "phone" }] });
    expect(keyRows()).not.toContainEqual({ kind: "phone", value: "0911112222" });
  });
});
