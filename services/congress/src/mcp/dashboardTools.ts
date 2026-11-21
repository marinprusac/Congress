import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dashboardCardInputSchema } from "@congress/shared-types";
import { mcpTextResult } from "../kit/mcp.js";
import { addCard, DashboardError, listDashboardForAi, removeCards, reorderCards, updateCard } from "../dashboard.js";

const BLOCKS_HELP =
  'blocks: any mix of {"type":"text","text":markdown}, {"type":"record","id":"<record id>","note"?}, {"type":"stat","value":"3","label":"tasks due"}, {"type":"facts","items":[{"label","value"}]}, {"type":"list","items":[markdown],"ordered"?}, {"type":"time","start":ISO,"end"?,"allDay"?,"label"?}. Text and list items may hold [[record:...]] tokens (copy them from search_records) which render as tappable chips.';

// The dashboard on the home screen belongs to the AI: these tools are the only way anything gets on it or off it.
export function registerDashboardTools(server: McpServer) {
  const guard = async (fn: () => unknown) => {
    try {
      return mcpTextResult(fn());
    } catch (err) {
      if (err instanceof DashboardError) return mcpTextResult({ error: "dashboard", message: err.message });
      throw err;
    }
  };

  server.registerTool(
    "dashboard_list",
    { title: "List Dashboard", description: "Every card currently on the owner's home dashboard, top first, exactly as you wrote it. Look before you add, so nothing is duplicated or left stale.", inputSchema: {} },
    async () => mcpTextResult(listDashboardForAi())
  );

  server.registerTool(
    "dashboard_add",
    {
      title: "Add Dashboard Card",
      description: `Put a card on the owner's home dashboard - the first thing they see. Only you manage it: add what matters right now, keep it current, take off what no longer does. Cards carry their information inline (never a bare 'open X' link), stay few and glanceable, and should expire (expiresAt) when they stop being true. ${BLOCKS_HELP}`,
      inputSchema: { ...dashboardCardInputSchema.shape, position: z.enum(["top", "bottom"]).optional().describe("Default top.") },
    },
    async ({ position, ...card }) => guard(() => ({ ok: true, id: addCard(card, position) }))
  );

  server.registerTool(
    "dashboard_update",
    {
      title: "Update Dashboard Card",
      description: `Change a card in place (fields you leave out stay). kicker, color and expiresAt accept null to clear. blocks replaces the whole body. ${BLOCKS_HELP}`,
      inputSchema: {
        id: z.number().int(),
        title: dashboardCardInputSchema.shape.title.optional(),
        kicker: dashboardCardInputSchema.shape.kicker.nullable(),
        color: dashboardCardInputSchema.shape.color.nullable(),
        size: dashboardCardInputSchema.shape.size,
        blocks: dashboardCardInputSchema.shape.blocks.optional(),
        expiresAt: dashboardCardInputSchema.shape.expiresAt,
      },
    },
    async ({ id, ...patch }) => guard(() => (updateCard(id, patch) ? { ok: true, id } : { error: "not_found", id }))
  );

  server.registerTool(
    "dashboard_remove",
    { title: "Remove Dashboard Cards", description: "Take cards off the dashboard.", inputSchema: { ids: z.array(z.number().int()).min(1).max(30) } },
    async ({ ids }) => guard(() => ({ ok: true, removed: removeCards(ids) }))
  );

  server.registerTool(
    "dashboard_reorder",
    { title: "Reorder Dashboard", description: "Put these cards first, in this order; the rest follow in their current order.", inputSchema: { ids: z.array(z.number().int()).min(1).max(30) } },
    async ({ ids }) => guard(() => (reorderCards(ids), { ok: true }))
  );
}
