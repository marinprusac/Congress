import { z } from "zod";
import { SOURCE_COLORS } from "./sourceColors.js";

// The home dashboard: free-form cards the AI puts there and takes off. Each
// card is a stack of blocks; text and list items are Markdown and may carry
// [[record:...]] tokens, which render as tappable chips.

export const DASHBOARD_MAX_CARDS = 30;

const iso = z.string().datetime({ offset: true });

export const dashboardBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(2000) }),
  // A record shown as a tappable row, with an optional note under it.
  z.object({ type: z.literal("record"), id: z.string().min(1), note: z.string().max(200).optional() }),
  // One big figure with its label ("3" / "tasks due today").
  z.object({ type: z.literal("stat"), value: z.string().min(1).max(40), label: z.string().min(1).max(60), note: z.string().max(120).optional() }),
  z.object({ type: z.literal("facts"), items: z.array(z.object({ label: z.string().min(1).max(40), value: z.string().max(120) })).min(1).max(12) }),
  z.object({ type: z.literal("list"), items: z.array(z.string().min(1).max(300)).min(1).max(15), ordered: z.boolean().optional() }),
  // A moment or range, formatted in the owner's own time zone by the browser.
  z.object({ type: z.literal("time"), label: z.string().max(20).optional(), start: iso, end: iso.optional(), allDay: z.boolean().optional() }),
]);
export type DashboardBlock = z.infer<typeof dashboardBlockSchema>;

export const dashboardCardInputSchema = z.object({
  title: z.string().min(1).max(120),
  // A short label above the title ("Today", "Heads up").
  kicker: z.string().max(30).optional(),
  color: z.enum(SOURCE_COLORS).optional(),
  // "wide" spans more of the grid on desktop; on a phone every card is full width.
  size: z.enum(["normal", "wide"]).optional(),
  blocks: z.array(dashboardBlockSchema).max(12),
  // The card leaves the dashboard by itself after this moment.
  expiresAt: iso.nullable().optional(),
});
export type DashboardCardInput = z.infer<typeof dashboardCardInputSchema>;

// A record block as sent to the browser: resolved to its current name and link,
// or null when the record is gone.
export type ResolvedDashboardBlock =
  | Exclude<DashboardBlock, { type: "record" }>
  | { type: "record"; id: string; note?: string; record: { name: string; url: string; chamber: string; type?: string } | null };

export interface DashboardCard {
  id: number;
  title: string;
  kicker: string | null;
  color: (typeof SOURCE_COLORS)[number] | null;
  size: "normal" | "wide";
  blocks: ResolvedDashboardBlock[];
  expiresAt: string | null;
  updatedAt: string;
}
