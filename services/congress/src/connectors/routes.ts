import { Hono } from "hono";
import { requireSession } from "../sessionAuth.js";
import { listConnectorStatuses, runningConnector, syncConnector } from "./registry.js";

// Mounted at /congress/connectors. Session is required per route, not with
// use("*"), which would also cover Google's cookie-less OAuth callback.
export const connectorRoutes = new Hono();

const panelApps = new Map<string, Hono>();
const hookApps = new Map<string, Hono>();

// The rest of the path after /connectors/<name><marker>, as a request for the connector's own app.
function forward(c: { req: { url: string; raw: Request } }, name: string, marker: string, app: Hono) {
  const url = new URL(c.req.url);
  const at = `/connectors/${name}${marker}`;
  const rest = url.pathname.slice(url.pathname.indexOf(at) + at.length) || "/";
  return app.fetch(new Request(new URL(rest + url.search, "http://connector"), c.req.raw));
}

// No session: a device (e.g. an iOS Shortcut) calls these; the connector checks its own secret.
connectorRoutes.all("/:name/hook/*", async (c) => {
  const name = c.req.param("name");
  const running = runningConnector(name);
  if (!running?.connector.hooks) return c.json({ error: "unknown connector" }, 404);
  let hooks = hookApps.get(name);
  if (!hooks) {
    hooks = running.connector.hooks(running.ctx);
    hookApps.set(name, hooks);
  }
  return forward(c, name, "/hook", hooks);
});

connectorRoutes.get("/:name/series/:kind", requireSession, (c) => {
  const running = runningConnector(c.req.param("name"));
  if (!running?.connector.read.series) return c.json({ error: "unknown connector" }, 404);
  const limit = Number(c.req.query("limit") ?? 1000);
  return c.json(running.connector.read.series(c.req.param("kind"), { from: c.req.query("from"), to: c.req.query("to"), limit }));
});

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
  return forward(c, name, "", panel);
});
