import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { serveChamberIcon } from "./gateway.js";

const app = new Hono();
app.get("/congress/chambers/:name/icon", (c) => serveChamberIcon(c, c.req.param("name")));

describe("serveChamberIcon", () => {
  it("serves a view's or type's mark as an SVG, cacheable", async () => {
    for (const name of ["e", "events", "fitness", "map", "whatsapp"]) {
      const res = await app.request(`/congress/chambers/${name}/icon`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(await res.text()).toContain("<svg");
    }
  });

  it("404s a name with no mark, so the caller falls back to a generic one", async () => {
    const res = await app.request("/congress/chambers/nosuch/icon");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "chamber_not_found", chamber: "nosuch" });
  });
});
