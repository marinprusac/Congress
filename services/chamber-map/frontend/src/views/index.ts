import type { ComponentType } from "react";
import { TodayMapWidget } from "./TodayMapWidget";

// Home feed cards, keyed by the view ids src/manifest.ts declares with
// `card: true`. ("Visits to classify" has no card - it opens /pending.)
export const cards: Record<string, ComponentType> = {
  "today-map": TodayMapWidget,
};
