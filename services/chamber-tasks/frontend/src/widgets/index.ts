import type { ComponentType } from "react";
import { OpenTasksWidget } from "./OpenTasksWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  open: OpenTasksWidget,
};
