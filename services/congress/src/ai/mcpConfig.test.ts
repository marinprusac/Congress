import { makeManifest, migrationsDir, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../db/client.js";
import { registerChamber, deregisterChamber } from "../registry.js";
import { buildMcpServers } from "./mcpConfig.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  registerChamber(makeManifest("notes", "http://127.0.0.1:8011"));
  registerChamber(makeManifest("tasks", "http://127.0.0.1:8014"));
  deregisterChamber("tasks");
  registerChamber(makeManifest("silent", "http://127.0.0.1:8099", { mcpUrl: undefined }));
});

describe("buildMcpServers", () => {
  it("always includes Congress's own /mcp, which never appears in its own registry", () => {
    const servers = buildMcpServers("congress");
    expect(servers.congress).toEqual({
      type: "http",
      url: "http://127.0.0.1:3000/mcp",
      headers: { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN, "X-Congress-Actor": "congress" },
    });
  });

  it("includes every active MCP-capable Chamber and skips offline or MCP-less ones", () => {
    const servers = buildMcpServers("congress");
    expect(Object.keys(servers).sort()).toEqual(["congress", "notes"]);
    expect(servers.notes?.url).toBe("http://127.0.0.1:8011/mcp");
  });

  it("attributes every tool call to the caller that asked for the run", () => {
    const servers = buildMcpServers("deputy");
    expect(servers.congress?.headers["X-Congress-Actor"]).toBe("deputy");
    expect(servers.notes?.headers["X-Congress-Actor"]).toBe("deputy");
  });
});
