import type { ComponentType } from "react";

// Keyed by the widget `id`s this Chamber declares in src/manifest.ts - none
// since the chat (and its "message Deputy" widget) moved to Congress.
export const widgets: Record<string, ComponentType> = {};
