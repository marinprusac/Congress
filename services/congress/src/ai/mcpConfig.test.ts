import { migrationsDir, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../db/client.js";
import { buildMcpServers } from "./mcpConfig.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

describe("buildMcpServers", () => {
  it("always includes Congress's own /mcp", () => {
    const servers = buildMcpServers("congress");
    expect(servers.congress).toEqual({
      type: "http",
      url: "http://127.0.0.1:3000/mcp",
      headers: { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN, "X-Congress-Actor": "congress" },
    });
  });

  it("adds builder mode's server only when asked", () => {
    expect(Object.keys(buildMcpServers("congress"))).toEqual(["congress"]);
    expect(Object.keys(buildMcpServers("congress", undefined, { builder: true })).sort()).toEqual(["builder", "congress"]);
  });

  it("adds internet mode's server only when asked", () => {
    expect(buildMcpServers("congress")).not.toHaveProperty("web");
    expect(Object.keys(buildMcpServers("congress", undefined, { internet: true })).sort()).toEqual(["congress", "web"]);
  });

  it("attributes every tool call to the caller that asked for the run", () => {
    const servers = buildMcpServers("deputy");
    expect(servers.congress?.headers["X-Congress-Actor"]).toBe("deputy");
    expect(buildMcpServers("deputy", undefined, { builder: true }).builder?.headers["X-Congress-Actor"]).toBe("deputy");
  });
});
