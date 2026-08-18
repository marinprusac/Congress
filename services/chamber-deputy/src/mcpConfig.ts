import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRegistry } from "@congress/chamber-kit";
import { env } from "./env.js";

// One `type: "http"` MCP server entry per active, MCP-capable Chamber - the
// same live registry lookup Automation Chamber's remoteTools.ts does, just
// every Chamber instead of one resolved target (docs/deputy-chamber-plan.md
// §5). Deputy itself is excluded even though its own /mcp mount is
// contract-compliant: it registers no tools (see mcp/tools.ts), so
// including it would just be a no-op entry.
export interface McpConfigFile {
  path: string;
  cleanup: () => Promise<void>;
}

export async function writeMcpConfigFile(): Promise<McpConfigFile> {
  const registry = await fetchRegistry(env.CAPITOL_URL, env.CONGRESS_INTERNAL_TOKEN);

  const mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string> }> = {};
  for (const chamber of registry) {
    if (chamber.name === "deputy" || chamber.status !== "active" || !chamber.mcpUrl) continue;
    mcpServers[chamber.name] = {
      type: "http",
      url: chamber.mcpUrl,
      headers: { "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN },
    };
  }

  const dir = await mkdtemp(join(tmpdir(), "deputy-mcp-"));
  const path = join(dir, "mcp.json");
  await writeFile(path, JSON.stringify({ mcpServers }, null, 2));

  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
