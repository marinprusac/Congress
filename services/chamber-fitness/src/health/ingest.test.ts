import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "../db/client.js";
import { healthMetrics, settings } from "../db/schema.js";

vi.mock("../events.js", () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }));

import { publishEvent } from "../events.js";
import { isValidIngestToken, ingestSamples } from "./ingest.js";
import type { HealthSample } from "../types.js";
import { app } from "../server.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => {
  db.run(sql`delete from health_metrics`);
  db.run(sql`delete from settings`);
  vi.mocked(publishEvent).mockClear();
});

function sample(overrides: Partial<HealthSample> = {}): HealthSample {
  return {
    metricType: "weight",
    value: 82.3,
    unit: "kg",
    startDate: "2026-09-08T07:00:00.000Z",
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
    const result = await ingestSamples({ samples: [sample()] });
    expect(result).toEqual({ accepted: 1, rejected: 0, errors: [] });
    expect(db.select().from(healthMetrics).all()).toHaveLength(1);
  });

  it("updates an identical (metricType, startDate, endDate) sample in place rather than duplicating", async () => {
    await ingestSamples({ samples: [sample({ value: 82.3 })] });
    await ingestSamples({ samples: [sample({ value: 82.5 })] });

    const rows = db.select().from(healthMetrics).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(82.5);
  });

  it("defaults endDate to startDate for an instantaneous sample", async () => {
    await ingestSamples({ samples: [sample()] });
    const row = db.select().from(healthMetrics).all()[0]!;
    expect(row.endDate.toISOString()).toBe(row.startDate.toISOString());
  });

  it("partially accepts a batch with one invalid date, reporting its index", async () => {
    const result = await ingestSamples({
      samples: [sample(), sample({ startDate: "not-a-date", value: 1 })],
    });
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.errors).toEqual([{ index: 1, message: "invalid_date" }]);
  });

  it("publishes fitness.health_metric_received when a sample is new", async () => {
    await ingestSamples({ samples: [sample()] });
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fitness.health_metric_received", payload: { count: 1 } })
    );
  });

  it("derives sleepAsleep's value from (endDate - startDate) server-side, ignoring whatever the client sent", async () => {
    await ingestSamples({
      samples: [
        sample({
          metricType: "sleepAsleep",
          value: 0, // a Shortcut need not compute this - the server derives it
          unit: "min",
          startDate: "2026-09-08T00:00:00.000Z",
          endDate: "2026-09-08T03:00:00.000Z",
        }),
      ],
    });
    const row = db.select().from(healthMetrics).all()[0]!;
    expect(row.value).toBe(3 * 3600);
    expect(row.unit).toBe("s");
  });

  it("does not publish on a byte-identical resend", async () => {
    await ingestSamples({ samples: [sample()] });
    vi.mocked(publishEvent).mockClear();
    await ingestSamples({ samples: [sample()] });
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/health/ingest route", () => {
  it("401s with no token set in settings at all", async () => {
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "anything" },
      body: JSON.stringify({ samples: [sample()] }),
    });
    expect(res.status).toBe(401);
  });

  it("401s a wrong token", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "wrong" },
      body: JSON.stringify({ samples: [sample()] }),
    });
    expect(res.status).toBe(401);
  });

  it("400s a schema-invalid body", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "secret" },
      body: JSON.stringify({ samples: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("200s a valid batch with the correct accepted/rejected counts", async () => {
    db.insert(settings).values({ id: 1, healthIngestToken: "secret" }).run();
    const res = await app.request("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Health-Ingest-Token": "secret" },
      body: JSON.stringify({ samples: [sample()] }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accepted: 1, rejected: 0, errors: [] });
  });
});
