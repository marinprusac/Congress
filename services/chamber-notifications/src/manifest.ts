import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "notifications",
  displayName: "Notifications",
  version: "0.1.0",
  routes: {
    home: "/notifications",
    settings: "/notifications/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // Optional: set to "markdown" once this Chamber's exhibit bodies use
  // [[wikilink]]/Markdown syntax, so Capitol's Exhibit Sharing viewer knows
  // to render them that way for logged-out viewers - see
  // services/congress/frontend/src/pages/SharedViewPage.tsx.
  // contentFormat: "markdown",
  // width/height are in canvas cells, fixed by this Chamber, not
  // user-resizable. See frontend/src/widgets/ for the matching components.
  widgets: [
    { id: "recent", width: 2, height: 3, label: "Recent" },
    // The bell+panel notification center itself - see NotificationsWidget's
    // own comment for why this replaced the old Capitol-header-mounted bell.
    { id: "bell", width: 1, height: 1, label: "Notifications" },
  ],
  // This Chamber only ever consumes other Chambers' events (see events.ts),
  // it doesn't publish any of its own.
  events: [],
};
