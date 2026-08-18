import type { ComponentType } from "react";
import { MessageDeputyWidget } from "./MessageDeputyWidget";
import { RecentActivityWidget } from "./RecentActivityWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  message: MessageDeputyWidget,
  "recent-activity": RecentActivityWidget,
};
