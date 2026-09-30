import type { HttpBindings } from "@hono/node-server";
import { beforeAll, describe, expect, it } from "vitest";
import { migrationsDir, TEST_MASTER_PASSWORD } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { app } from "../server.js";
import { startTypeEngine } from "./index.js";
import { publish } from "./store.js";

const json = { "Content-Type": "application/json" };
const bindings = () => ({ incoming: { socket: { remoteAddress: "10.0.0.1" } } }) as unknown as HttpBindings;
let cookie: string;

function call(path: string, init: RequestInit = {}, withSession = true) {
  return app.request(path, { ...init, headers: { ...json, ...(withSession ? { cookie } : {}), ...init.headers } }, bindings());
}

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  const res = await app.request(
    "/auth/login",
    { method: "POST", headers: { ...json, "x-forwarded-for": "9.9.9.8" }, body: JSON.stringify({ password: TEST_MASTER_PASSWORD }) },
    bindings()
  );
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

describe("type routes", () => {
  it("require a session", async () => {
    expect((await call("/congress/types", {}, false)).status).toBe(401);
    expect((await call("/congress/records", { method: "POST", body: "{}" }, false)).status).toBe(401);
  });

  it("list hidden types only with ?all=1", async () => {
    publish({
      actor: "test",
      ops: [
        { op: "create_type", slug: "secret", label: "Secret" },
        { op: "add_field", slug: "title", label: "Title", kind: "text" },
        { op: "set_title_field", field: "title" },
        { op: "set_type_meta", hidden: true },
      ],
    });
    const slugs = async (path: string) => ((await (await call(path)).json()) as { definition: { slug: string } }[]).map((t) => t.definition.slug);
    expect(await slugs("/congress/types")).toEqual(["note", "task", "document", "person"]);
    expect(await slugs("/congress/types?all=1")).toEqual(["note", "task", "document", "person", "event", "secret"]);
  });

  it("describe types for Settings: counts, forks and versions as changes", async () => {
    await call("/congress/records", { method: "POST", body: JSON.stringify({ type: "secret", values: { title: "One" } }) });
    const list = (await (await call("/congress/types?all=1")).json()) as { definition: { slug: string }; recordCount: number; forked: boolean }[];
    expect(list.find((t) => t.definition.slug === "secret")).toMatchObject({ recordCount: 1, forked: false });

    const versions = (await (await call("/congress/types/task/versions")).json()) as { version: number; changes: { text: string }[] }[];
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]!.changes).toEqual([{ area: "type", text: "Show type" }]);
    expect(versions[1]!.changes[0]).toEqual({ area: "type", text: "Create type “Task” (Tasks), hidden" });
  });

  it("upload a file raw and serve it back inline, ranged and as a download", async () => {
    const put = await call("/congress/files?name=scan%20%C3%A9.pdf", { method: "PUT", body: "%PDF-hello", headers: { "Content-Type": "application/pdf" } });
    expect(put.status).toBe(201);
    const ref = (await put.json()) as { id: string; name: string; mime: string; size: number };
    expect(ref).toMatchObject({ name: "scan é.pdf", mime: "application/pdf", size: 10 });

    const got = await call(`/congress/files/${ref.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-disposition")).toMatch(/^inline;.*filename\*=UTF-8''scan%20%C3%A9\.pdf/);
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await got.text()).toBe("%PDF-hello");

    const ranged = await call(`/congress/files/${ref.id}`, { headers: { range: "bytes=1-3" } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe("PDF");
    expect((await call(`/congress/files/${ref.id}`, { headers: { range: "bytes=50-" } })).status).toBe(416);
    expect((await call(`/congress/files/${ref.id}?download=1`)).headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("serve unknown types as attachments and keep files behind the session", async () => {
    const put = await call("/congress/files?name=x.html", { method: "PUT", body: "<script>1</script>", headers: { "Content-Type": "text/html" } });
    const { id } = (await put.json()) as { id: string };
    expect((await call(`/congress/files/${id}`)).headers.get("content-disposition")).toMatch(/^attachment;/);
    expect((await call(`/congress/files/${id}`, {}, false)).status).toBe(401);
    expect((await call("/congress/files?name=x", { method: "PUT", body: "x" }, false)).status).toBe(401);
    expect((await call("/congress/files/nope")).status).toBe(404);
  });

  it("create, read, patch and delete a record", async () => {
    const created = await call("/congress/records", { method: "POST", body: JSON.stringify({ type: "note", values: { title: "Hello" } }) });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const patched = await call(`/congress/records/${id}`, { method: "PATCH", body: JSON.stringify({ values: { body: "hi [[exhibit:e:x|X]]" } }) });
    expect(await patched.json()).toMatchObject({ values: { title: "Hello", body: "hi [[exhibit:e:x|X]]", pinned: false } });

    expect(((await (await call("/congress/records?type=note")).json()) as unknown[]).length).toBe(1);
    expect((await call(`/congress/records/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/congress/records/${id}`)).status).toBe(404);
  });

  it("answer 400 for bad input and 404 for unknown types", async () => {
    expect((await call("/congress/records", { method: "POST", body: JSON.stringify({ type: "note", values: {} }) })).status).toBe(400);
    expect((await call("/congress/records", { method: "POST", body: JSON.stringify({ type: "nope", values: {} }) })).status).toBe(404);
    expect((await call("/congress/records/missing", { method: "PATCH", body: "{}" })).status).toBe(404);
  });

  it("search one type for the relation picker and list reverse relations", async () => {
    publish({
      actor: "test",
      ops: [
        { op: "create_type", slug: "trip", label: "Trip" },
        { op: "add_field", slug: "title", label: "Title", kind: "text" },
        { op: "set_title_field", field: "title" },
        { op: "add_field", slug: "notes", label: "Notes", kind: "relation", options: { target: "note", many: true } },
      ],
    });
    const post = async (type: string, values: object) =>
      (await (await call("/congress/records", { method: "POST", body: JSON.stringify({ type, values }) })).json()) as { id: string };
    const note = await post("note", { title: "Packing list" });
    await post("note", { title: "Unrelated" });
    const trip = await post("trip", { title: "Rome", notes: [note.id] });

    const found = (await (await call("/congress/records/search?type=note&q=pack")).json()) as { id: string }[];
    expect(found.map((r) => r.id)).toEqual([note.id]);
    expect((await call("/congress/records/search?type=nope&q=x")).status).toBe(404);

    const related = await (await call(`/congress/records/${note.id}/related`)).json();
    expect(related).toEqual([
      { type: "trip", typeLabel: "Trips", field: "notes", fieldLabel: "Notes", total: 1, records: [{ id: trip.id, name: "Rome", url: `/${trip.id}` }] },
    ]);
    expect((await call("/congress/records/missing/related")).status).toBe(404);
  });

  it("leave the Google OAuth callback public", async () => {
    expect((await call("/congress/connectors/google/callback?state=x", {}, false)).status).not.toBe(401);
  });
});
