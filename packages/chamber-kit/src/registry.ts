import type { ChamberRegistryEntry } from "@congress/shared-types";

// Server-side counterpart to congress-ui's own fetchRegistry (which reads
// the browser session cookie) - for a Chamber's own backend, e.g.
// Automation Chamber resolving a target Chamber's mcpUrl out of the live
// registry before calling one of its tools. Congress's own
// /congress/registry route accepts either auth (see
// requireSessionOrInternalToken, services/congress/src/auth.ts).
export async function fetchRegistry(capitolUrl: string, internalToken: string): Promise<ChamberRegistryEntry[]> {
  const res = await fetch(`${capitolUrl}/congress/registry`, {
    headers: { "X-Congress-Internal-Token": internalToken },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
  return (await res.json()) as ChamberRegistryEntry[];
}
