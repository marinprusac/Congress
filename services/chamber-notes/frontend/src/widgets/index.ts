import type { ComponentType } from "react";
import { PinnedNotesWidget } from "./PinnedNotesWidget";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts.
export const widgets: Record<string, ComponentType> = {
  pinned: PinnedNotesWidget,
};
