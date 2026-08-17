import type { ComponentType } from "react";
import { RecentAutomationsWidget } from "./RecentAutomationsWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  recent: RecentAutomationsWidget,
};
