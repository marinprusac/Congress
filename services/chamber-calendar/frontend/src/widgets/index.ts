import type { ComponentType } from "react";
import { UpcomingEventsWidget } from "./UpcomingEventsWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  upcoming: UpcomingEventsWidget,
};
