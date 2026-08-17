import { createMcpApp } from "@congress/chamber-kit";
import { registerTools } from "./tools.js";
import { env } from "../env.js";

export const mcpApp = createMcpApp("congress", registerTools, env.CONGRESS_INTERNAL_TOKEN);
