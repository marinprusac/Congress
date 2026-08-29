import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeManifest, migrationsDir, startFakeChamber, type FakeChamber, waitFor, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { deregisterChamber, registerChamber } from "./registry.js";
import { publishEvent, subscriptionMatches } from "./events.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

describe("subscriptionMatches", () => {
  // Congress's coarse gate. Too narrow and a Chamber's own rules never get
  // the chance to run; too wide and every Chamber is woken for everything.
  it("matches an exact event type", () => {
    expect(subscriptionMatches([{ type: "tasks.due_soon" }], "tasks.due_soon")).toBe(true);
    expect(subscriptionMatches([{ type: "tasks.due_soon" }], "tasks.overdue")).toBe(false);
  });

  it("matches everything through the '*' wildcard", () => {
    expect(subscriptionMatches([{ type: "*" }], "anything.at.all")).toBe(true);
  });

  it("matches nothing when the chamber subscribes to nothing", () => {
    expect(subscriptionMatches([], "tasks.due_soon")).toBe(false);
  });

  it("matches if any single subscription matches", () => {
    const subs = [{ type: "a" }, { type: "b" }];
    expect(subscriptionMatches(subs, "b")).toBe(true);
  });
});

describe("publishEvent fan-out", () => {
  const chambers: FakeChamber[] = [];

  async function subscriber(name: string, subscriptions: Parameters<typeof registerChamber>[1]) {
    const fake = await startFakeChamber((app) => app.post("/api/events/receive", (c) => c.json({ ok: true })));
    chambers.push(fake);
    registerChamber(makeManifest(name, fake.origin), subscriptions);
    return fake;
  }

  afterAll(async () => {
    await Promise.all(chambers.map((c) => c.close()));
  });

  it("delivers to a subscribed chamber, authenticated with the internal token", async () => {
    const fake = await subscriber("relay-a", [{ type: "tasks.due_soon" }]);

    publishEvent({ chamber: "tasks", type: "tasks.due_soon", payload: { taskId: 1 } });

    await waitFor(() => fake.received.length > 0, 2_000, "delivery to relay-a");
    const delivery = fake.received[0]!;
    expect(delivery.method).toBe("POST");
    expect(delivery.url).toBe("/api/events/receive");
    expect(delivery.headers["x-congress-internal-token"]).toBe(TEST_INTERNAL_TOKEN);
    expect(JSON.parse(delivery.body)).toMatchObject({ chamber: "tasks", type: "tasks.due_soon", payload: { taskId: 1 } });
  });

  it("stamps occurredAt when the publisher did not supply one", async () => {
    const fake = await subscriber("relay-b", [{ type: "*" }]);
    publishEvent({ chamber: "tasks", type: "anything", payload: {} });
    await waitFor(() => fake.received.length > 0, 2_000, "delivery to relay-b");
    expect(() => new Date(JSON.parse(fake.received[0]!.body).occurredAt).toISOString()).not.toThrow();
  });

  it("preserves an occurredAt the publisher did supply", async () => {
    const fake = await subscriber("relay-c", [{ type: "*" }]);
    publishEvent({ chamber: "tasks", type: "x", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" });
    await waitFor(() => fake.received.length > 0, 2_000, "delivery to relay-c");
    expect(JSON.parse(fake.received[0]!.body).occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("skips a chamber whose subscriptions do not match", async () => {
    const wanted = await subscriber("relay-wanted", [{ type: "notes.created" }]);
    const ignored = await subscriber("relay-ignored", [{ type: "tasks.due_soon" }]);

    publishEvent({ chamber: "notes", type: "notes.created", payload: {} });

    await waitFor(() => wanted.received.length > 0, 2_000, "delivery to relay-wanted");
    expect(ignored.received).toHaveLength(0);
  });

  it("skips a chamber that is registered but offline", async () => {
    const fake = await subscriber("relay-offline", [{ type: "*" }]);
    deregisterChamber("relay-offline");

    publishEvent({ chamber: "x", type: "y", payload: {} });

    await new Promise((r) => setTimeout(r, 100));
    expect(fake.received).toHaveLength(0);
  });
});

describe("publishEvent delivery retries", () => {
  // Retries wait seconds to minutes, so this half stubs fetch and drives
  // fake timers rather than doing real I/O.
  const realFetch = globalThis.fetch;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  // A publish fans out to every subscribed chamber, and earlier tests in
  // this file leave several registered - so the stub has to answer for all
  // of them while only *counting* the one under test.
  function stubFetch(targetOrigin: string, handler: (attempt: number) => Response) {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.startsWith(targetOrigin)) return new Response(null, { status: 204 });
      calls.push(url);
      return handler(calls.length);
    }) as unknown as typeof fetch;
    return calls;
  }

  it("retries a rejected delivery on the documented delay schedule and stops once it succeeds", async () => {
    const origin = "http://127.0.0.1:19001";
    registerChamber(makeManifest("retry-a", origin), [{ type: "*" }]);
    const calls = stubFetch(origin, (attempt) => new Response(null, { status: attempt < 3 ? 500 : 204 }));
    vi.useFakeTimers();

    publishEvent({ chamber: "x", type: "y", payload: {} });

    // First attempt has no delay at all.
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    // Nothing more until the 5s mark.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);

    // Third attempt at +15s succeeds, so the chain stops there.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(3);
  });

  it("gives up after the last delay rather than retrying forever", async () => {
    const origin = "http://127.0.0.1:19002";
    registerChamber(makeManifest("retry-b", origin), [{ type: "*" }]);
    const calls = stubFetch(origin, () => {
      throw new Error("ECONNREFUSED");
    });
    vi.useFakeTimers();

    publishEvent({ chamber: "x", type: "y", payload: {} });

    // 0 + 5s + 15s + 30s + 90s = five attempts, then done.
    await vi.advanceTimersByTimeAsync(200_000);
    expect(calls).toHaveLength(5);
  });

  it("skips an attempt against a chamber the sweep has since marked offline", async () => {
    const origin = "http://127.0.0.1:19003";
    registerChamber(makeManifest("retry-c", origin), [{ type: "*" }]);
    const calls = stubFetch(origin, () => new Response(null, { status: 500 }));
    vi.useFakeTimers();

    publishEvent({ chamber: "x", type: "y", payload: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    // The registry is re-read on every attempt precisely so a delivery to a
    // chamber that is now known-down doesn't burn the full timeout.
    deregisterChamber("retry-c");
    await vi.advanceTimersByTimeAsync(200_000);
    expect(calls).toHaveLength(1);
  });
});
