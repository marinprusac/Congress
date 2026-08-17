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
    // Capitol has no widget of its own to compose onto the homepage grid -
    // it's the Chamber that renders that grid, not an entry in it.
    widget: "",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
};
