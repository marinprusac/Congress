import { makeManifest, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapitolRegistration } from "./registerWithCapitol.js";

const CAPITOL_URL = "http://127.0.0.1:19999";

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

// Stubs the global fetch and records every call - the same technique
// services/congress/src/events.test.ts uses for its own retry/backoff suite,
// since this is timing-precision testing, not wire-format handling that
// would need a real server.
function stubFetch(handler: (call: Call, attempt: number) => Response | never) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), init: (init ?? {}) as Call["init"] };
    calls.push(call);
    return handler(call, calls.length);
  }) as unknown as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe("registerWithCapitolUntilSuccess", () => {
  it("resolves on the first attempt when Capitol responds ok, posting manifest + subscriptions with the auth header", async () => {
    const calls = stubFetch(() => new Response(null, { status: 200 }));
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
      getSubscriptions: () => [{ type: "*" }],
    });

    await reg.registerWithCapitolUntilSuccess();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${CAPITOL_URL}/congress/register`);
    expect(calls[0]!.init.headers).toMatchObject({ "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN });
    const body = JSON.parse(calls[0]!.init.body!);
    expect(body).toMatchObject({ name: "test", subscriptions: [{ type: "*" }] });
  });

  it("retries on a non-ok response and on a thrown network error, succeeding on a later attempt", async () => {
    const calls = stubFetch((_call, attempt) => {
      if (attempt === 1) return new Response(null, { status: 500 });
      if (attempt === 2) throw new Error("ECONNREFUSED");
      return new Response(null, { status: 200 });
    });
    vi.useFakeTimers();

    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });

    const done = reg.registerWithCapitolUntilSuccess();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(3);
    await done;
  });

  it("doubles the backoff on each failed attempt, capped at 30s", async () => {
    const calls = stubFetch(() => new Response(null, { status: 500 }));
    vi.useFakeTimers();

    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });

    void reg.registerWithCapitolUntilSuccess();

    // Attempt 1 fires immediately; the schedule after that is
    // 1000, 2000, 4000, 8000, 16000 (6 attempts, landing at cumulative 31000ms).
    const cumulativeDelays = [0, 1_000, 2_000, 4_000, 8_000, 16_000];
    for (let i = 0; i < cumulativeDelays.length; i++) {
      await vi.advanceTimersByTimeAsync(cumulativeDelays[i]!);
      expect(calls).toHaveLength(i + 1);
    }

    // The pending sleep before attempt 7 is min(32000, 30000) - pin the
    // exact 30s cap with a millisecond-boundary check, rather than only
    // asserting an eventual call count that a lower cap would also satisfy
    // by the time a coarser checkpoint is reached.
    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(7);

    reg.stopHeartbeat();
  });

  it("stopHeartbeat halts a pending retry chain", async () => {
    const calls = stubFetch(() => new Response(null, { status: 500 }));
    vi.useFakeTimers();

    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });

    void reg.registerWithCapitolUntilSuccess();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    reg.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });
});

describe("heartbeatNow", () => {
  it("posts the current getSubscriptions() output, read fresh on every call", async () => {
    let current: { type: string }[] = [{ type: "a" }];
    const calls = stubFetch(() => new Response(null, { status: 200 }));
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
      getSubscriptions: () => current,
    });

    await reg.heartbeatNow();
    expect(JSON.parse(calls[0]!.init.body!)).toMatchObject({ name: "test", subscriptions: [{ type: "a" }] });

    current = [{ type: "b" }];
    await reg.heartbeatNow();
    expect(JSON.parse(calls[1]!.init.body!)).toMatchObject({ subscriptions: [{ type: "b" }] });
  });

  it("defaults to an empty subscriptions array when getSubscriptions is omitted", async () => {
    const calls = stubFetch(() => new Response(null, { status: 200 }));
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });

    await reg.heartbeatNow();
    expect(JSON.parse(calls[0]!.init.body!).subscriptions).toEqual([]);
  });

  it("swallows a non-ok response without throwing", async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });
    await expect(reg.heartbeatNow()).resolves.toBeUndefined();
  });

  it("swallows a thrown network error without throwing", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });
    await expect(reg.heartbeatNow()).resolves.toBeUndefined();
  });
});

describe("deregisterFromCapitol", () => {
  it("posts the manifest name to /congress/deregister", async () => {
    const calls = stubFetch(() => new Response(null, { status: 200 }));
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });

    await reg.deregisterFromCapitol();
    expect(calls[0]!.url).toBe(`${CAPITOL_URL}/congress/deregister`);
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({ name: "test" });
  });

  it("swallows a thrown network error without throwing", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 30_000,
    });
    await expect(reg.deregisterFromCapitol()).resolves.toBeUndefined();
  });
});

describe("startHeartbeat / stopHeartbeat", () => {
  it("fires heartbeatNow on the configured interval until stopped", async () => {
    const calls = stubFetch(() => new Response(null, { status: 200 }));
    vi.useFakeTimers();

    const reg = createCapitolRegistration({
      manifest: makeManifest("test"),
      capitolUrl: CAPITOL_URL,
      internalToken: TEST_INTERNAL_TOKEN,
      heartbeatIntervalMs: 1_000,
    });

    reg.startHeartbeat();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toHaveLength(3);

    reg.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(3);
  });
});
