import { createMcpApp } from "@congress/chamber-kit";
import { registerTools } from "./tools.js";

export const mcpApp = createMcpApp("documents", registerTools);
