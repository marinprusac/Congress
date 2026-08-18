import { createSingleRowSettings } from "@congress/chamber-kit";
import type { Settings } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

// Proposed defaults from docs/deputy-chamber-plan.md §1/§6/§8/§11 - every one
// of these is a Settings field specifically so it's cheap to override without
// a redeploy, not a hardcoded constant.
const DEFAULT_SETTINGS: Settings = {
  personaPrompt: "",
  checkupIntervalMs: 20 * 60 * 1000,
  chatIdleWindowMs: 30 * 60 * 1000,
  budgetCapUsd: 10,
  model: "claude-sonnet-5",
  retentionDays: 30,
  paused: false,
  pausedReason: null,
};

export const { getSettings, updateSettings } = createSingleRowSettings<typeof settings.$inferSelect, Settings>({
  db,
  table: settings,
  toSettings: (row) => ({
    personaPrompt: row.personaPrompt,
    checkupIntervalMs: row.checkupIntervalMs,
    chatIdleWindowMs: row.chatIdleWindowMs,
    budgetCapUsd: row.budgetCapUsd,
    model: row.model,
    retentionDays: row.retentionDays,
    paused: row.paused,
    pausedReason: row.pausedReason,
  }),
  defaults: DEFAULT_SETTINGS,
});
