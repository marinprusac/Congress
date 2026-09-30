import { createMcpApp } from "../kit/mcp.js";
import { registerTools } from "./tools.js";
import { env } from "../env.js";

export const mcpApp = createMcpApp("congress", registerTools, env.CONGRESS_INTERNAL_TOKEN);
