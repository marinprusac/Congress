import type { Manifest } from "@congress/shared-types";

// The minimum a Chamber has to send to POST /congress/register. Kept here
// rather than rebuilt in each suite so a change to the manifest contract
// breaks one place instead of six.
export function makeManifest(name: string, origin = "http://127.0.0.1:9", overrides: Partial<Manifest> = {}): Manifest {
  return {
    name,
    displayName: `${name[0]?.toUpperCase()}${name.slice(1)} Chamber`,
    version: "0.1.0",
    routes: { home: `/${name}`, settings: `/${name}/settings` },
    widgets: [],
    events: [],
    apiBase: `${origin}/api`,
    mcpUrl: `${origin}/mcp`,
    healthUrl: `${origin}/health`,
    ...overrides,
  };
}
