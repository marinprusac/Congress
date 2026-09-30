import { beforeAll, describe, expect, it } from "vitest";
import type { AutoCreate } from "@congress/shared-types";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { runExhibitsMigrations } from "./db/client.js";
import { getTypeBySlug, publish } from "./store.js";
import { getRecord, RecordValidationError, updateRecord } from "./records.js";
import { lookupOrCreate, type Evidence } from "./lookups.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "person", label: "Person", pluralLabel: "People" },
      { op: "add_field", slug: "name", label: "Name", kind: "text", options: { required: true } },
      { op: "set_title_field", field: "name" },
      { op: "add_field", slug: "emails", label: "Emails", kind: "text", options: { key: "email" } },
      { op: "add_field", slug: "phones", label: "Phones", kind: "text", options: { key: "phone" } },
    ],
  });
});

const setPolicy = (autoCreate: AutoCreate) => publish({ typeId: getTypeBySlug("person")!.id, actor: "test", ops: [{ op: "set_type_meta", autoCreate }] });

let n = 0;
const fresh = () => `p${++n}@example.com`;

describe("lookupOrCreate", () => {
  it("creates by policy and evidence", () => {
    const cases: [AutoCreate, Evidence, boolean][] = [
      ["never", "owner", true],
      ["never", "corresponded", false],
      ["never", "seen", false],
      ["corresponded", "corresponded", true],
      ["corresponded", "seen", false],
      ["any", "seen", true],
    ];
    for (const [policy, evidence, creates] of cases) {
      setPolicy(policy);
      const res = lookupOrCreate("person", { keys: [{ kind: "email", value: fresh() }], evidence });
      expect([policy, evidence, res.id !== null]).toEqual([policy, evidence, creates]);
      if (!creates) expect(res).toEqual({ id: null, reason: "policy" });
    }
  });

  it("carries the keys into a new record and titles it by the first key when unnamed", () => {
    const res = lookupOrCreate("person", {
      keys: [
        { kind: "email", value: "Dana@Example.com" },
        { kind: "phone", value: "+44 20 7946 0000" },
      ],
      evidence: "owner",
    });
    expect(getRecord(res.id!)!.values).toMatchObject({ name: "Dana@Example.com", emails: "Dana@Example.com", phones: "+44 20 7946 0000" });
  });

  it("finds by any key and leaves the found record untouched", () => {
    const first = lookupOrCreate("person", { keys: [{ kind: "email", value: "eve@example.com" }], values: { name: "Eve" }, evidence: "owner" });
    updateRecord(first.id!, { phones: "0911234567" });
    const again = lookupOrCreate("person", {
      keys: [
        { kind: "email", value: "other@example.com" },
        { kind: "phone", value: "091 123 4567" },
      ],
      values: { name: "Someone else" },
      evidence: "seen",
    });
    expect(again).toEqual({ id: first.id, created: false });
    expect(getRecord(first.id!)!.values).toMatchObject({ name: "Eve", emails: "eve@example.com" });
  });

  it("refuses when no key is valid", () => {
    expect(() => lookupOrCreate("person", { keys: [{ kind: "email", value: "nope" }], evidence: "owner" })).toThrow(RecordValidationError);
  });
});
