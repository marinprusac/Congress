import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { mountManifestAndHealth, mountSettingsRoutes, mountStaticFrontend } from "@congress/chamber-kit";
import { updateSettingsRequestSchema } from "./types.js";
import { manifest } from "./manifest.js";
import { getSettings, updateSettings } from "./settings.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
