import type { Manifest } from "@congress/shared-types";

// The minimum manifest a Chamber module carries. Kept here so a change to the
// manifest contract breaks one place instead of every suite.
export function makeManifest(name: string, overrides: Partial<Manifest> = {}): Manifest {
  return {
    name,
    displayName: `${name[0]?.toUpperCase()}${name.slice(1)} Chamber`,
    version: "0.1.0",
    routes: { home: `/${name}`, settings: `/${name}/settings` },
    views: [],
    exhibitTypes: [],
    events: [],
    ...overrides,
  };
}
