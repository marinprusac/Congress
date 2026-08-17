import type { ComponentType } from "react";
import { RecentLogsWidget } from "./RecentLogsWidget";
import { UrgentLogsWidget } from "./UrgentLogsWidget";
import { NotificationsWidget } from "./NotificationsWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  "recent-logs": RecentLogsWidget,
  "urgent-logs": UrgentLogsWidget,
  bell: NotificationsWidget,
};
