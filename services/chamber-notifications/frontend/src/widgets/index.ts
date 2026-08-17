import type { ComponentType } from "react";
import { RecentAutomationsWidget } from "./RecentAutomationsWidget";
import { NotificationsWidget } from "./NotificationsWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  recent: RecentAutomationsWidget,
  bell: NotificationsWidget,
};
