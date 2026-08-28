import type { ComponentType } from "react";
import { MessageDeputyWidget } from "./MessageDeputyWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  message: MessageDeputyWidget,
};
