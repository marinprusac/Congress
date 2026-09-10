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
//
// Congress's own /mcp (search_exhibits/resolve_exhibits/get_exhibit_chip/
// get_exhibit_connections/create_exhibit_connection/delete_exhibit_connection
// - see services/congress/src/mcp/tools.ts) is added explicitly below rather
// than picked up from the registry loop above: per the Chamber contract,
// Congress is the registry owner, not a registrant, so it never calls
// register/heartbeat on itself and never appears in fetchRegistry()'s
// result. Without this, Deputy has no way to mint a valid
// [[exhibit:chamber:id|Name]] token or add a manual Connection, and no way
// to discover that gap either - every other MCP-capable chamber it does see
// (notes/documents/etc.) only exposes search/resolve for its own exhibits,
// not chip-building or connections, so the absence looks like "this feature
// doesn't exist" rather than "this one server is missing".
export interface McpConfigFile {
  path: string;
  cleanup: () => Promise<void>;
}

export async function writeMcpConfigFile(): Promise<McpConfigFile> {
  const registry = await fetchRegistry(env.CAPITOL_URL, env.CONGRESS_INTERNAL_TOKEN);

  const mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string> }> = {
    congress: {
      type: "http",
      url: `${env.CAPITOL_URL}/mcp`,
      headers: { "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN },
    },
  };
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
