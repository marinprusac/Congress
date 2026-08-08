import type { ChamberRegistryEntry } from "@congress/shared-types";

export async function fetchRegistry(): Promise<ChamberRegistryEntry[]> {
  const res = await fetch("/capitol/registry");
  if (!res.ok) {
    throw new Error(`Failed to fetch registry: ${res.status}`);
  }
  return res.json();
}
