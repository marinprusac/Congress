import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeManifest, startFakeChamber, TEST_INTERNAL_TOKEN, type FakeChamber } from "@congress/test-support";
import type { ChamberRegistryEntry } from "@congress/shared-types";

// Congress never registers itself (it's the registry owner, not a
// registrant - see the Chamber contract in CLAUDE.md), so its own /mcp
// (search_exhibits/resolve_exhibits/get_exhibit_chip/create_exhibit_connection/
// etc., see services/congress/src/mcp/tools.ts) never shows up in
// fetchRegistry()'s result the way every other Chamber's does. This suite
// pins CAPITOL_URL at a fake registry server per test (module-load env, so
// vi.resetModules() + a fresh dynamic import is required, same convention as
// swapping DB_PATH) and asserts writeMcpConfigFile() adds that "congress"
// entry itself regardless of what the live registry contains.
let fakeCongress: FakeChamber | undefined;

function registryEntry(name: string, origin: string, overrides: Partial<ChamberRegistryEntry> = {}): ChamberRegistryEntry {
  return {
    ...makeManifest(name, origin),
    status: "active",
    registeredAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    subscriptions: [],
    ...overrides,
  };
}

async function loadWriteMcpConfigFile(capitolUrl: string) {
  process.env.CAPITOL_URL = capitolUrl;
  vi.resetModules();
  const mod = await import("./mcpConfig.js");
  return mod.writeMcpConfigFile;
}

beforeEach(() => {
  fakeCongress = undefined;
});

afterEach(async () => {
  await fakeCongress?.close();
});

describe("writeMcpConfigFile", () => {
  it("always includes Congress's own /mcp, even though it's absent from the registry", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.get("/congress/registry", (c) => c.json([registryEntry("notes", "http://127.0.0.1:8011")]));
    });

    const writeMcpConfigFile = await loadWriteMcpConfigFile(fakeCongress.origin);
    const { path, cleanup } = await writeMcpConfigFile();
    try {
      const config = JSON.parse(await readFile(path, "utf-8"));
      expect(config.mcpServers.congress).toEqual({
        type: "http",
        url: `${fakeCongress.origin}/mcp`,
        headers: { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN },
      });
      expect(config.mcpServers.notes).toEqual({
        type: "http",
        url: "http://127.0.0.1:8011/mcp",
        headers: { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN },
      });
    } finally {
      await cleanup();
    }
  });

  it("excludes deputy itself and any inactive/registered-but-unreachable Chamber", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.get("/congress/registry", (c) =>
        c.json([
          registryEntry("deputy", "http://127.0.0.1:8018"),
          registryEntry("tasks", "http://127.0.0.1:8014", { status: "offline" }),
          registryEntry("automation", "http://127.0.0.1:8017"),
        ])
      );
    });

    const writeMcpConfigFile = await loadWriteMcpConfigFile(fakeCongress.origin);
    const { path, cleanup } = await writeMcpConfigFile();
    try {
      const config = JSON.parse(await readFile(path, "utf-8"));
      expect(Object.keys(config.mcpServers).sort()).toEqual(["automation", "congress"]);
    } finally {
      await cleanup();
    }
  });
});
