import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

// Capitol has no widget of its own to compose onto a homepage - it is the homepage.
export const capitolManifest: Manifest = {
  name: "capitol",
  displayName: "Capitol",
  version: "0.1.0",
  routes: {
    home: "/",
    settings: "/settings",
    widget: "",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
};
