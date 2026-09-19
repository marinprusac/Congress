import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeManifest, startFakeChamber, TEST_INTERNAL_TOKEN, type FakeChamber } from "@congress/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { currentActor, runWithActor } from "./actorContext.js";
import { createPublishEvent } from "./events.js";
import { callChamberTool, createMcpApp, mcpTextResult } from "./mcp.js";
import { mountManifestAndHealth } from "./routes.js";

describe("runWithActor / currentActor", () => {
  it("defaults to system outside any request", () => {
    expect(currentActor()).toBe("system");
  });

  it("scopes the actor to the call, across awaits", async () => {
    await runWithActor("deputy", async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentActor()).toBe("deputy");
    });
    expect(currentActor()).toBe("system");
  });

  it("ignores a missing or malformed actor rather than trusting it", () => {
    expect(runWithActor(undefined, currentActor)).toBe("system");
    expect(runWithActor("not valid!!", currentActor)).toBe("system");
    expect(runWithActor("", currentActor)).toBe("system");
  });
});

// A real ephemeral "Congress" that records what a Chamber publishes, plus a
// real Chamber whose REST route and MCP tool both publish an event - the two
// ways an action reaches a Chamber, and the two the actor has to survive.
describe("actor stamping on published events", () => {
  const open: FakeChamber[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close()));
  });

  async function setup() {
    const congress = await startFakeChamber((app) => app.post("/congress/events/publish", (c) => c.json({ ok: true })));
    const publishEvent = createPublishEvent({ chamber: "test", capitolUrl: congress.origin, internalToken: TEST_INTERNAL_TOKEN });

    const chamber = await startFakeChamber((app) => {
      mountManifestAndHealth(app as unknown as Hono<{ Bindings: HttpBindings }>, makeManifest("test", "http://127.0.0.1:1"));
      app.post("/api/do", async (c) => {
        await publishEvent({ type: "test.did", payload: {} });
        return c.json({ ok: true });
      });
      app.route(
        "/mcp",
        createMcpApp(
          "test",
          (server: McpServer) =>
            server.registerTool("do", { title: "Do", description: "Publishes an event." }, async () => {
              await publishEvent({ type: "test.did", payload: {} });
              return mcpTextResult({ ok: true });
            }),
          TEST_INTERNAL_TOKEN,
        ),
      );
    });
    open.push(congress, chamber);

    const published = () => congress.received.filter((r) => r.url === "/congress/events/publish").map((r) => JSON.parse(r.body));
    return { chamber, published, publishEvent };
  }

  it("stamps a REST request with the actor header the gateway set", async () => {
    const { chamber, published } = await setup();
    await fetch(`${chamber.origin}/api/do`, { method: "POST", headers: { "X-Congress-Actor": "me" } });
    expect(published()).toHaveLength(1);
    expect(published()[0].actor).toBe("me");
  });

  it("stamps an MCP tool call with the caller's actor", async () => {
    const { chamber, published } = await setup();
    await callChamberTool(`${chamber.origin}/mcp`, TEST_INTERNAL_TOKEN, "do", {}, "automation");
    expect(published()[0].actor).toBe("automation");
  });

  it("falls back to system for a call that carries no actor", async () => {
    const { chamber, published } = await setup();
    await fetch(`${chamber.origin}/api/do`, { method: "POST" });
    await callChamberTool(`${chamber.origin}/mcp`, TEST_INTERNAL_TOKEN, "do", {});
    expect(published().map((p) => p.actor)).toEqual(["system", "system"]);
  });

  it("lets an explicit actor on the event override the ambient one", async () => {
    const { published, publishEvent } = await setup();
    await runWithActor("me", () => publishEvent({ type: "test.did", payload: {}, actor: "deputy" }));
    expect(published()[0].actor).toBe("deputy");
  });

  it("keeps concurrent requests' actors separate", async () => {
    const { chamber, published } = await setup();
    await Promise.all([
      fetch(`${chamber.origin}/api/do`, { method: "POST", headers: { "X-Congress-Actor": "me" } }),
      callChamberTool(`${chamber.origin}/mcp`, TEST_INTERNAL_TOKEN, "do", {}, "deputy"),
    ]);
    expect(published().map((p) => p.actor).sort()).toEqual(["deputy", "me"]);
  });
});
