import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

// Congress has no widget of its own to compose onto a homepage - for now it
// still serves the homepage directly (see the Congress/Capitol split plan,
// Phase 2, for when a real "capitol" Chamber takes that over).
export const capitolManifest: Manifest = {
  name: "congress",
  displayName: "Congress",
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
