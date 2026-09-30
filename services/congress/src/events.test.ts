import { beforeAll, describe, expect, it } from "vitest";
import { migrationsDir, waitFor } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { onEventPublished, publishEvent } from "./events.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

describe("publishEvent observers", () => {
  it("hands every publish to in-process observers, with who did it and when", () => {
    const seen: { type: string; actor?: string; occurredAt: string }[] = [];
    const off = onEventPublished((e) => void seen.push(e));
    publishEvent({ chamber: "types", type: "x.one", payload: {}, actor: "deputy" });
    publishEvent({ chamber: "types", type: "x.two", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" });
    off();
    publishEvent({ chamber: "types", type: "x.three", payload: {} });
    expect(seen.map((e) => e.type)).toEqual(["x.one", "x.two"]);
    expect(seen[0]!.actor).toBe("deputy");
    expect(() => new Date(seen[0]!.occurredAt).toISOString()).not.toThrow();
    expect(seen[1]!.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps publishing when an observer throws", () => {
    const off = onEventPublished(() => {
      throw new Error("observer bug");
    });
    const seen: string[] = [];
    const off2 = onEventPublished((e) => void seen.push(e.type));
    expect(() => publishEvent({ chamber: "types", type: "x.boom", payload: {} })).not.toThrow();
    off();
    off2();
    expect(seen).toEqual(["x.boom"]);
  });
});

// Congress's own log rules run in-process on every publish (see events.ts).
describe("publishEvent -> log rules", () => {
  it("records to history for any event type", async () => {
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
