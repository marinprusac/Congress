import type { Manifest } from "@congress/shared-types";

// Congress's own self-description (GET /manifest). Not in the chamber
// registry - Congress hosts the Chambers, it isn't one.
export const capitolManifest: Manifest = {
  name: "congress",
  displayName: "Congress",
  version: "0.1.0",
  routes: {
    home: "/",
    settings: "/settings",
  },
  views: [],
  exhibitTypes: [],
  events: [],
};
