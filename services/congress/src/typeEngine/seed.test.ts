import { eq } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../db/client.js";
import { recordsDb, runRecordsMigrations } from "./db/client.js";
import { imports } from "./db/schema.js";
import { getTypeByPremadeKey, getTypeBySlug, publish } from "./store.js";
import { createRecord, getRecord } from "./records.js";
import { CHAT_REMOVED_KEY, DETACHED_KEY, seedTypes } from "./seed.js";

const ran = (key: string) => Boolean(recordsDb.select().from(imports).where(eq(imports.key, key)).get());

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runRecordsMigrations();
});

describe("seeding the built-in types", () => {
  it("seeds once, then leaves every type alone; removes the old Chat type and only it", () => {
    // An install from before: a Chat type with a record, next to a Person.
    publish({
      actor: "premade",
      origin: "premade",
      premadeKey: "chat",
      premadeBatch: 1,
      ops: [
        { op: "create_type", slug: "chat", label: "Chat" },
        { op: "add_field", slug: "name", label: "Name", kind: "text", options: { required: true } },
        { op: "set_title_field", field: "name" },
      ],
    });
    createRecord("chat", { name: "Ana" }, { actor: "premade", fromSource: true });

    seedTypes();
    expect(ran(DETACHED_KEY)).toBe(true);
    expect(ran(CHAT_REMOVED_KEY)).toBe(true);
    expect(getTypeByPremadeKey("chat")).toBeUndefined();
    const person = getTypeBySlug("person")!;
    expect(getTypeBySlug("event")!.definition.bindings[0]!.fields.map((f) => f.source)).not.toContain("people");
    expect(getTypeBySlug("email")!.definition.bindings[0]!.fields.map((f) => f.source)).not.toContain("people");
    const ana = createRecord("person", { name: "Ana" }, { actor: "me" });

    // An ordinary change to a built-in type sticks across boots.
    publish({ typeId: person.id, ops: [{ op: "set_type_meta", icon: "users" }], actor: "ai-builder" });
    const version = getTypeBySlug("person")!.version;
    seedTypes();
    expect(getTypeBySlug("person")).toMatchObject({ version, forked: false });
    expect(getTypeBySlug("person")!.definition.icon).toBe("users");
    expect(getRecord(ana.id)).not.toBeNull();
  });
});
