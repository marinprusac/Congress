import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

// This is Congress's own self-descriptive manifest (served at GET /manifest,
// not registered into the chamber registry - Congress is the registry
// owner, not a registrant). It has no widgets of its own to compose onto
// Capitol's canvas.
export const capitolManifest: Manifest = {
  name: "congress",
  displayName: "Congress",
  version: "0.1.0",
  routes: {
    home: "/",
    settings: "/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [],
  events: [],
};
