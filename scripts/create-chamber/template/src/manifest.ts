import type { Manifest } from "@congress/shared-types";

export const manifest: Manifest = {
  name: "__CHAMBER_NAME__",
  displayName: "__CHAMBER_DISPLAY__",
  version: "0.1.0",
  routes: {
    home: "/__CHAMBER_NAME__",
    settings: "/__CHAMBER_NAME__/settings",
  },
  // Views are only genuine screens that can't be expressed as a list of
  // exhibits (a map, an agenda) - most Chambers have none; their exhibits
  // reach the home feed (src/feedRules.ts) and Search on their own.
  // exhibitTypes is what the home screen's "+" can create here.
  views: [],
  exhibitTypes: [{ type: "item", label: "Item", createPath: "/new" }],
  events: [],
};
