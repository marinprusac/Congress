import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "capitol",
  displayName: "Capitol",
  version: "0.1.0",
  routes: {
    home: "/capitol",
    settings: "/capitol/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // Capitol has no widgets of its own to compose onto its own canvas - it's
  // the Chamber that renders the canvas, not an entry on it.
  widgets: [],
  events: [],
};
