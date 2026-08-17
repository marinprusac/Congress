import type { ComponentType } from "react";
import { RecentDocumentsWidget } from "./RecentDocumentsWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  recent: RecentDocumentsWidget,
};
