import type { ChamberRegistryEntry, ChamberWidget } from "@congress/shared-types";

export async function fetchRegistry(): Promise<ChamberRegistryEntry[]> {
  const res = await fetch("/capitol/registry");
  if (!res.ok) {
    throw new Error(`Failed to fetch registry: ${res.status}`);
  }
  return res.json();
}

export async function fetchChamberWidget(chamberName: string): Promise<ChamberWidget> {
  const res = await fetch(`/api/${chamberName}/widget`);
  if (!res.ok) {
    throw new Error(`Widget unavailable: ${res.status}`);
  }
  return res.json();
}
