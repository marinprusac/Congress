import type { ComponentType } from "react";
import { RecentWorkoutsWidget } from "./RecentWorkoutsWidget";
import { WeekStatsWidget } from "./WeekStatsWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  "recent-workouts": RecentWorkoutsWidget,
  "week-stats": WeekStatsWidget,
};
