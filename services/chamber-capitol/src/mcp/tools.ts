import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Capitol has no domain content of its own (no Exhibits, no items) - it's
// the widget-canvas Chamber, and Congress already exposes list_chambers/
// get_chamber_status/search_exhibits/resolve_exhibits for everything an MCP
// client would actually want. This Chamber still mounts /mcp (see
// server.ts) for contract uniformity, just with nothing registered yet.
export function registerTools(_server: McpServer) {}
