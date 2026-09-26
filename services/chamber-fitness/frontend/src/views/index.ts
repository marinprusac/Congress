import type { ComponentType } from "react";
import { HealthSnapshotWidget } from "./HealthSnapshotWidget";

// Home feed cards, keyed by the view ids src/manifest.ts declares with
// `card: true`.
export const cards: Record<string, ComponentType> = {
  health: HealthSnapshotWidget,
};
