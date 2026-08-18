import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Decided (docs/deputy-chamber-plan.md §2): Deputy exposes no MCP tools of
// its own in v1 - it's a pure consumer of every other Chamber's tools, not a
// callable target itself. No `ask_deputy` delegation tool, no self-status
// tool: this avoids a second unattended-trigger surface (something else
// deciding to wake Deputy up) and the self-modification risk of Deputy being
// callable by, say, an Automation. The /mcp mount still exists (createMcpApp
// in mcp/server.ts) for contract uniformity with every other Chamber - it
// just registers nothing.
export function registerTools(_server: McpServer): void {}
