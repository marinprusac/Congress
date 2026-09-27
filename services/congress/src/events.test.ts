import { beforeAll, describe, expect, it } from "vitest";
import type { ChamberSubscription, EventDelivery } from "@congress/shared-types";
import { makeFakeChamberModule, migrationsDir, waitFor } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { detachChamber } from "./registry.js";
import { loadChamber } from "./chambers/loader.js";
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
  // A loaded, subscribed Chamber module that records every event it's handed.
  async function subscriber(name: string, subscriptions: ChamberSubscription[], onEvent?: (e: EventDelivery) => void) {
    const received: EventDelivery[] = [];
    const fake = makeFakeChamberModule(name, {
      subscriptions: () => subscriptions,
      onEvent: (e) => {
        received.push(e);
        onEvent?.(e);
      },
    });
    await loadChamber(fake, { envFor: () => ({}) });
    return received;
  }

  it("hands the event to a subscribed chamber's onEvent", async () => {
    const received = await subscriber("relay-a", [{ type: "tasks.due_soon" }]);
    publishEvent({ chamber: "tasks", type: "tasks.due_soon", payload: { taskId: 1 } });
    await waitFor(() => received.length > 0, 2_000, "delivery to relay-a");
    expect(received[0]).toMatchObject({ chamber: "tasks", type: "tasks.due_soon", payload: { taskId: 1 } });
  });

  it("relays who performed the action", async () => {
    const received = await subscriber("relay-actor", [{ type: "*" }]);
    publishEvent({ chamber: "tasks", type: "tasks.created", payload: {}, actor: "deputy" });
    await waitFor(() => received.length > 0, 2_000, "delivery to relay-actor");
    expect(received[0]!.actor).toBe("deputy");
  });

  it("stamps occurredAt when the publisher did not supply one, and keeps one it did", async () => {
    const received = await subscriber("relay-b", [{ type: "*" }]);
    publishEvent({ chamber: "tasks", type: "anything", payload: {} });
    publishEvent({ chamber: "tasks", type: "x", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" });
    await waitFor(() => received.length > 1, 2_000, "delivery to relay-b");
    expect(() => new Date(received[0]!.occurredAt).toISOString()).not.toThrow();
    expect(received[1]!.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reads subscriptions live, so a changed list takes effect without a restart", async () => {
    let subs: ChamberSubscription[] = [];
    const received: EventDelivery[] = [];
    await loadChamber(
      makeFakeChamberModule("relay-live", { subscriptions: () => subs, onEvent: (e) => void received.push(e) }),
      { envFor: () => ({}) }
    );
    publishEvent({ chamber: "notes", type: "notes.created", payload: {} });
    subs = [{ type: "notes.created" }];
    publishEvent({ chamber: "notes", type: "notes.created", payload: { second: true } });
    await waitFor(() => received.length > 0, 2_000, "delivery to relay-live");
    expect(received).toHaveLength(1);
    expect(received[0]!.payload).toEqual({ second: true });
  });

  it("skips a chamber whose subscriptions do not match, or that is detached", async () => {
    const wanted = await subscriber("relay-wanted", [{ type: "notes.created" }]);
    const ignored = await subscriber("relay-ignored", [{ type: "tasks.due_soon" }]);
    const detached = await subscriber("relay-detached", [{ type: "*" }]);
    detachChamber("relay-detached");

    publishEvent({ chamber: "notes", type: "notes.created", payload: {} });

    await waitFor(() => wanted.length > 0, 2_000, "delivery to relay-wanted");
    expect(ignored).toHaveLength(0);
    expect(detached.filter((e) => e.type === "notes.created")).toHaveLength(0);
  });

  it("keeps delivering to the others when one chamber's handler throws", async () => {
    await subscriber("relay-throws", [{ type: "boom.test" }], () => {
      throw new Error("handler bug");
    });
    const healthy = await subscriber("relay-healthy", [{ type: "boom.test" }]);
    publishEvent({ chamber: "x", type: "boom.test", payload: {} });
    await waitFor(() => healthy.length > 0, 2_000, "delivery to relay-healthy");
  });
});

// Congress's own log rules run in-process on every publish - no subscription
// entry, registry lookup, or HTTP hop involved (see events.ts).
describe("publishEvent -> log rules", () => {
  it("records to history without any subscribed chamber", async () => {
    const { db } = await import("./db/client.js");
    const { eventSettings } = await import("./db/schema.js");
    const { listHistory } = await import("./eventHistory.js");
    db.insert(eventSettings)
      .values({
        eventType: "inproc.test_event",
        chamber: "inproc",
        label: "In-process test",
        recordToHistory: true,
        notify: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    publishEvent({ chamber: "inproc", type: "inproc.test_event", payload: { n: 1 } });

    await waitFor(() => listHistory({ eventType: "inproc.test_event" }).length > 0, 2_000, "history row");
    expect(listHistory({ eventType: "inproc.test_event" })[0]).toMatchObject({ chamber: "inproc", payload: { n: 1 } });
  });
});
