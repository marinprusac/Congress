import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTOR_HEADER } from "@congress/shared-types";
import { env } from "../env.js";
import { listChambers } from "../registry.js";
import { getLocalSource } from "../exhibitSources.js";
import { RUN_ID_HEADER, THREAD_ID_HEADER, type RunContextInfo } from "./runContext.js";

// One `type: "http"` MCP server entry per active, MCP-capable Chamber, plus
// Congress's own /mcp (exhibit search/resolve/chips/Connections, logs) -
// Congress is the registry owner, not a registrant, so it never appears in
// its own registry and has to be added explicitly. The file is handed to
// `claude --strict-mcp-config`, so these are the only MCP servers a run
// ever sees.
export interface McpConfigFile {
  path: string;
  cleanup: () => Promise<void>;
}

// Congress's own /mcp as reachable from this same host. A wildcard bind
// address isn't connectable, so fall back to loopback for it.
export function selfBaseUrl(): string {
  const host = env.HOST === "0.0.0.0" || env.HOST === "::" ? "127.0.0.1" : env.HOST;
  return `http://${host}:${env.PORT}`;
}

// `actor` is stamped on every tool call this run makes (ACTOR_HEADER), so
// whatever event a called Chamber publishes as a side effect is attributed
// to whoever asked for the run rather than the owner.
// The Congress entry also carries the run/thread ids, so asks it creates
// land in the right thread (see runContext.ts).
export function buildMcpServers(
  actor: string,
  run: RunContextInfo = { runId: null, threadId: null }
): Record<string, { type: "http"; url: string; headers: Record<string, string> }> {
  const headers = { "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN, [ACTOR_HEADER]: actor };
  const congressHeaders: Record<string, string> = { ...headers };
  if (run.runId) congressHeaders[RUN_ID_HEADER] = run.runId;
  if (run.threadId) congressHeaders[THREAD_ID_HEADER] = String(run.threadId);
  const mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string> }> = {
    congress: { type: "http", url: `${selfBaseUrl()}/mcp`, headers: congressHeaders },
  };
  if (getLocalSource("e")) mcpServers.types = { type: "http", url: `${selfBaseUrl()}/mcp/types`, headers };
  for (const chamber of listChambers()) {
    if (chamber.status !== "active" || !chamber.mcpUrl) continue;
    mcpServers[chamber.name] = { type: "http", url: chamber.mcpUrl, headers };
  }
  return mcpServers;
}

// `empty`: a config with no servers at all (the gate), so the CLI can't fall
// back to whatever MCP servers this machine's user has configured.
export async function writeMcpConfigFile(actor: string, run?: RunContextInfo, opts: { empty?: boolean } = {}): Promise<McpConfigFile> {
  const dir = await mkdtemp(join(tmpdir(), "congress-ai-mcp-"));
  const path = join(dir, "mcp.json");
  await writeFile(path, JSON.stringify({ mcpServers: opts.empty ? {} : buildMcpServers(actor, run) }, null, 2));
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
