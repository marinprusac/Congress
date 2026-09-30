import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { app } from "../../server.js";
import { onEventPublished, type PublishedEvent } from "../../events.js";
import { runningConnector, startConnectors, stopConnectors } from "../registry.js";
import { healthConnector } from "./index.js";
import { updateHealthSettings } from "./store.js";

const published: PublishedEvent[] = [];
onEventPublished((e) => published.push(e));

const payload = {
  data: {
    metrics: [
      { name: "weight_body_mass", units: "kg", data: [{ qty: 80.5, date: "2026-09-29 07:00:00 +0200" }] },
      { name: "active_energy", units: "kJ", data: [{ qty: 4184, date: "2026-09-29 00:00:00 +0200" }] },
    ],
  },
};

const ingest = (token: string | null, body: unknown = payload) =>
  app.fetch(
    new Request("http://x/congress/connectors/health/hook/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Health-Ingest-Token": token } : {}) },
      body: JSON.stringify(body),
    })
  );

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  await startConnectors([healthConnector]);
  updateHealthSettings({ ingestToken: "secret" });
});

afterAll(() => stopConnectors());

describe("the health ingest hook", () => {
  it("needs its own token, not a session", async () => {
    expect((await ingest(null)).status).toBe(401);
    expect((await ingest("wrong")).status).toBe(401);
  });

  it("stores samples once, updating resends in place", async () => {
    expect(await (await ingest("secret")).json()).toEqual({ accepted: 2, duplicated: 0, skipped: 0 });
    expect(published.filter((e) => e.type === "fitness.health_metric_received")).toEqual([]);
    updateHealthSettings({ publishEvents: true });
    expect(await (await ingest("secret")).json()).toEqual({ accepted: 0, duplicated: 2, skipped: 0 });
    // A byte-identical resend changes nothing, so nothing is announced.
    expect(published.filter((e) => e.type === "fitness.health_metric_received")).toEqual([]);
    const series = runningConnector("health")!.connector.read.series!("activeEnergy", {});
    expect(series).toEqual([expect.objectContaining({ metricType: "activeEnergy", value: 1000, unit: "kcal" })]);
  });

  it("rejects a body that isn't an export", async () => {
    expect((await ingest("secret", { metrics: "nope" })).status).toBe(400);
  });
});
