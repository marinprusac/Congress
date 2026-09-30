import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startFakeChamber, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { describe, expect, it } from "vitest";
import { callChamberTool, createMcpApp, listChamberTools, mcpTextResult } from "./mcp.js";

function registerEchoTool(server: McpServer) {
  server.registerTool(
    "echo",
    { title: "Echo", description: "Echoes back its input.", inputSchema: { msg: z.string() } },
    async ({ msg }) => mcpTextResult({ echoed: msg })
  );
}

async function startMcpFakeChamber() {
  const chamber = await startFakeChamber((app) => {
    app.route("/mcp", createMcpApp("test", registerEchoTool, TEST_INTERNAL_TOKEN));
  });
  return { ...chamber, mcpUrl: `${chamber.origin}/mcp` };
}

describe("mcpTextResult", () => {
  it("wraps a value as a single JSON text content block", () => {
    expect(mcpTextResult({ a: 1 })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }],
    });
  });
});

describe("createMcpApp auth gate", () => {
  it("rejects a request with no internal token", async () => {
    const chamber = await startMcpFakeChamber();
    try {
      const res = await fetch(chamber.mcpUrl, { method: "POST", headers: { "Content-Type": "application/json" } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    } finally {
      await chamber.close();
    }
  });

  it("rejects a request with a mismatched internal token", async () => {
    const chamber = await startMcpFakeChamber();
    try {
      const res = await fetch(chamber.mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Congress-Internal-Token": "wrong-token" },
      });
      expect(res.status).toBe(401);
    } finally {
      await chamber.close();
    }
  });
});

describe("listChamberTools / callChamberTool", () => {
  it("lists the tools a target Chamber registered", async () => {
    const chamber = await startMcpFakeChamber();
    try {
      const tools = await listChamberTools(chamber.mcpUrl, TEST_INTERNAL_TOKEN);
      expect(tools.map((t) => t.name)).toEqual(["echo"]);
    } finally {
      await chamber.close();
    }
  });

  it("calls a tool and returns its result", async () => {
    const chamber = await startMcpFakeChamber();
    try {
      const result = await callChamberTool(chamber.mcpUrl, TEST_INTERNAL_TOKEN, "echo", { msg: "hi" });
      const content = (result as { content: { type: string; text: string }[] }).content;
      expect(JSON.parse(content[0]!.text)).toEqual({ echoed: "hi" });
    } finally {
      await chamber.close();
    }
  });

  it("rejects rather than hanging when the token is wrong", async () => {
    const chamber = await startMcpFakeChamber();
    try {
      await expect(listChamberTools(chamber.mcpUrl, "wrong-token")).rejects.toThrow();
      await expect(callChamberTool(chamber.mcpUrl, "wrong-token", "echo", { msg: "hi" })).rejects.toThrow();
    } finally {
      await chamber.close();
    }
  });
});
