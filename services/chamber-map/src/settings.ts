import { createSingleRowSettings } from "@congress/chamber-kit";
import type { Settings } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const { getSettings, updateSettings } = createSingleRowSettings<typeof settings.$inferSelect, Settings>({
  db,
  table: settings,
  toSettings: (row) => ({
    unknownClusterRadiusMeters: row.unknownClusterRadiusMeters,
    minDwellMs: row.minDwellMs,
    stoppedSpeedKmh: row.stoppedSpeedKmh,
    pollIntervalMs: row.pollIntervalMs,
  }),
  defaults: {
    unknownClusterRadiusMeters: 150,
    minDwellMs: 45 * 60 * 1000,
    stoppedSpeedKmh: 3,
    pollIntervalMs: 2 * 60 * 1000,
  },
});
