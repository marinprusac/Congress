import { fetchRegistry, listChamberTools } from "@congress/chamber-kit";
import { env } from "./env.js";

// Backs the editor's chamber+tool picker - a live tools/list call against
// whichever Chamber the owner picked, not a declared catalog like events
// (manifestEventSchema): MCP already gives every tool a full input schema
// for free, so there's nothing worth pre-declaring separately.
export async function listToolsForChamber(chamberName: string) {
  const registry = await fetchRegistry(env.CAPITOL_URL, env.CONGRESS_INTERNAL_TOKEN);
  const target = registry.find((c) => c.name === chamberName);
  if (!target || !target.mcpUrl) return null;
  return listChamberTools(target.mcpUrl, env.CONGRESS_INTERNAL_TOKEN);
}
