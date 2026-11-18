import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunOutcome } from "./engine.js";

vi.mock("./engine.js", () => ({ runAi: vi.fn() }));

import { db, runMigrations } from "../db/client.js";
import { locationDb, runLocationMigrations } from "../connectors/location/db/client.js";
import { visits } from "../connectors/location/db/schema.js";
import { reviewCandidates } from "../connectors/location/review.js";
import { updateAiSettings } from "./settings.js";
import { classifyPromptBody, maybeClassify, MAX_ATTEMPTS, resetClassifier } from "./classifier.js";

const out = (o: Partial<RunOutcome> = {}): RunOutcome => ({
  runId: "r", ok: true, refused: false, cancelled: false, response: "Done.", sessionId: null, errorMessage: null,
  transcript: [], activity: [], costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 1, ...o,
});

const NOW = Date.parse("2026-11-18T12:00:00Z");
const stop = (id: number) =>
  locationDb
    .insert(visits)
    .values({
      id,
      status: "pending",
      clusterLatitude: 45.8,
      clusterLongitude: 15.97,
      arrivedAt: new Date(NOW - (500 - id) * 60_000),
      departedAt: new Date(NOW - 100 * 60_000),
      pendingNotifiedAt: new Date(NOW - 400 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runLocationMigrations();
});

beforeEach(async () => {
  for (const t of ["visit_reviews", "visits", "places"]) locationDb.run(sql.raw(`delete from ${t}`));
  db.run(sql`delete from ai_settings`);
  await updateAiSettings({ classifierEnabled: true, linkerIntervalMinutes: 15 });
  resetClassifier();
});

describe("the place classifier pass", () => {
  it("runs once for the waiting stops on the cheap model, then marks them reviewed", async () => {
    stop(1);
    stop(2);
    const run = vi.fn().mockResolvedValue(out());
    expect(await maybeClassify(NOW, run)).not.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    const [body, model] = run.mock.calls[0]!;
    expect(body).toContain("stop #1");
    expect(body).toContain("stop #2");
    expect(model).toBe("claude-haiku-5-5");
    expect(await reviewCandidates(NOW)).toEqual([]);
    // Nothing left: no more runs.
    expect(await maybeClassify(NOW + 3_600_000, run)).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for its interval and respects the switches", async () => {
    stop(1);
    const run = vi.fn().mockResolvedValue(out());
    await maybeClassify(NOW, run);
    stop(3);
    expect(await maybeClassify(NOW + 5 * 60_000, run)).toBeNull();
    expect(await maybeClassify(NOW + 16 * 60_000, run)).not.toBeNull();

    resetClassifier();
    stop(4);
    await updateAiSettings({ classifierEnabled: false });
    expect(await maybeClassify(NOW, run)).toBeNull();
    await updateAiSettings({ classifierEnabled: true, proactiveEnabled: false });
    expect(await maybeClassify(NOW, run)).toBeNull();
    await updateAiSettings({ proactiveEnabled: true, paused: true });
    expect(await maybeClassify(NOW, run)).toBeNull();
    await updateAiSettings({ paused: false });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps stops through a refused run and retries a failed one a few times, then gives up", async () => {
    stop(1);
    const run = vi.fn().mockResolvedValue(out({ ok: false, refused: true }));
    await maybeClassify(NOW, run);
    expect((await reviewCandidates(NOW)).length).toBe(1);

    run.mockResolvedValue(out({ ok: false, errorMessage: "boom" }));
    for (let i = 1; i <= MAX_ATTEMPTS; i++) await maybeClassify(NOW + i * 16 * 60_000, run);
    expect(run).toHaveBeenCalledTimes(1 + MAX_ATTEMPTS);
    expect(await reviewCandidates(NOW)).toEqual([]);
  });

  it("tells the AI to ask, with a map, only when unsure, and carries each stop's evidence", async () => {
    stop(7);
    const [c] = await reviewCandidates(NOW);
    const body = classifyPromptBody([{ visit: c!, nearbyPlaces: [{ id: "p1", name: "Cafe", distanceMeters: 40, radiusMeters: 100 }], pastLabels: [{ label: "Dentist", times: 2 }] }]);
    expect(body).toContain("stop #7");
    expect(body).toContain("Cafe (p1, 40 m away, radius 100 m)");
    expect(body).toContain('"Dentist" x2');
    expect(body).toContain("ask_question");
    expect(body).toContain("map block");
  });
});
