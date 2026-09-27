import { createSingleRowSettings } from "@congress/chamber-kit";
import type { AiSettings } from "@congress/shared-types";
import { db } from "../db/client.js";
import { aiSettings } from "../db/schema.js";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  contextPrompt: "",
  budgetCapUsd: 10,
  model: "claude-sonnet-5",
  retentionDays: 30,
  paused: false,
  pausedReason: null,
  maxPushesPerDay: 3,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  timeZone: null,
};

export const { getSettings: getAiSettings, updateSettings: updateAiSettings } = createSingleRowSettings<
  typeof aiSettings.$inferSelect,
  AiSettings
>({
  db,
  table: aiSettings,
  toSettings: (row) => ({
    contextPrompt: row.contextPrompt,
    budgetCapUsd: row.budgetCapUsd,
    model: row.model,
    retentionDays: row.retentionDays,
    paused: row.paused,
    pausedReason: row.pausedReason,
    maxPushesPerDay: row.maxPushesPerDay,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timeZone: row.timeZone,
  }),
  defaults: DEFAULT_AI_SETTINGS,
});
