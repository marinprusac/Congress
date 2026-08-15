import type { ChamberRegistryEntry } from "@congress/shared-types";

// Shared by WidgetGrid (Capitol's homepage) and ChamberPicker (every
// frontend) - moved here so a Chamber's own frontend can fetch the registry
// too, not just Capitol's.
export async function fetchRegistry(): Promise<ChamberRegistryEntry[]> {
  const res = await fetch("/capitol/registry");
  if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
  return res.json();
}
