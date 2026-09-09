import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "../db/client.js";
import { healthMetrics, settings } from "../db/schema.js";

vi.mock("../events.js", () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }));

import { publishEvent } from "../events.js";
import { isValidIngestToken, ingestSamples } from "./ingest.js";
import type { NormalizedHealthSample } from "./normalize.js";
import { app } from "../server.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => {
  db.run(sql`delete from health_metrics`);
  db.run(sql`delete from settings`);
  vi.mocked(publishEvent).mockClear();
});

function sample(overrides: Partial<NormalizedHealthSample> = {}): NormalizedHealthSample {
  const startDate = new Date("2026-09-08T07:00:00.000Z");
  return {
    metricType: "weight",
    value: 82.3,
    unit: "kg",
    startDate,
    endDate: startDate,
    sourceName: null,
    ...overrides,
  };
}

describe("isValidIngestToken", () => {
  it("rejects when no token has been set in settings", async () => {
    await expect(isValidIngestToken("anything")).resolves.toBe(false);
  });

  it("rejects a missing header", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    await expect(isValidIngestToken(undefined)).resolves.toBe(false);
  });

  it("rejects a wrong header value", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    await expect(isValidIngestToken("wrong")).resolves.toBe(false);
  });

  it("accepts a matching header value", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    await expect(isValidIngestToken("secret")).resolves.toBe(true);
  });
});

describe("ingestSamples", () => {
  it("inserts a new sample", async () => {
    const result = await ingestSamples([sample()]);
    expect(result).toEqual({ accepted: 1 });
    expect(db.select().from(healthMetrics).all()).toHaveLength(1);
  });

  it("updates an identical (metricType, startDate, endDate) sample in place rather than duplicating", async () => {
    await ingestSamples([sample({ value: 82.3 })]);
    await ingestSamples([sample({ value: 82.5 })]);

    const rows = db.select().from(healthMetrics).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(82.5);
  });

  it("publishes fitness.health_metric_received when a sample is new", async () => {
    await ingestSamples([sample()]);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fitness.health_metric_received", payload: { count: 1 } })
    );
  });

  it("does not publish on a byte-identical resend", async () => {
    await ingestSamples([sample()]);
    vi.mocked(publishEvent).mockClear();
    await ingestSamples([sample()]);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("publishes when a resend actually changes the value", async () => {
    await ingestSamples([sample({ value: 82.3 })]);
    vi.mocked(publishEvent).mockClear();
    await ingestSamples([sample({ value: 82.5 })]);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/health/ingest route", () => {
  function haePayload() {
    return {
      data: {
        metrics: [
          {
            name: "vo2_max",
            units: "ml/(kg·min)",
            data: [{ date: "2026-08-16 00:00:00 +0200", qty: 37.75, source: "Marin’s Apple Watch" }],
          },
        ],
      },
    };
  }

  it("401s with no token set in settings at all", async () => {
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "anything" },
      body: JSON.stringify(haePayload()),
    });
    expect(res.status).toBe(401);
  });

  it("401s a wrong token", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "wrong" },
      body: JSON.stringify(haePayload()),
    });
    expect(res.status).toBe(401);
  });

  it("400s a schema-invalid body", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "secret" },
      body: JSON.stringify({ notData: true }),
    });
    expect(res.status).toBe(400);
  });

  it("200s a valid export with the correct accepted/skipped counts", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "secret" },
      body: JSON.stringify(haePayload()),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accepted: 1, skipped: 0 });
  });
});
