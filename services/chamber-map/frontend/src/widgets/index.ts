import type { ComponentType } from "react";
import { RecentVisitsWidget } from "./RecentVisitsWidget";
import { TodayMapWidget } from "./TodayMapWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  "recent-visits": RecentVisitsWidget,
  "today-map": TodayMapWidget,
};
