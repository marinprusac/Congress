import { Hono } from "hono";
import { requireSession } from "../sessionAuth.js";
import { listConnectorStatuses, runningConnector, syncConnector } from "./registry.js";

// Mounted at /congress/connectors. Session is required per route, not with
// use("*"), which would also cover Google's cookie-less OAuth callback.
export const connectorRoutes = new Hono();

const panelApps = new Map<string, Hono>();

connectorRoutes.get("/", requireSession, (c) => c.json(listConnectorStatuses()));

connectorRoutes.post("/:name/sync", requireSession, async (c) => {
  const status = await syncConnector(c.req.param("name"));
  return status ? c.json(status) : c.json({ error: "unknown connector" }, 404);
});

connectorRoutes.all("/:name/*", requireSession, async (c) => {
  const name = c.req.param("name");
  const running = runningConnector(name);
  if (!running?.connector.routes) return c.json({ error: "unknown connector" }, 404);
  let panel = panelApps.get(name);
  if (!panel) {
    panel = running.connector.routes(running.ctx);
    panelApps.set(name, panel);
  }
  const url = new URL(c.req.url);
  const marker = `/connectors/${name}`;
  const rest = url.pathname.slice(url.pathname.indexOf(marker) + marker.length) || "/";
  return panel.fetch(new Request(new URL(rest + url.search, "http://connector"), c.req.raw));
});
