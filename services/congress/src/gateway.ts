import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { Context } from "hono";

// A view's or type's mark (frontend/public/icons/<name>.svg, copied into dist/ by
// the build). Public: an icon carries nothing sensitive. Any miss is a 404
// and the caller falls back to a generic mark.
const icon = (name: string) => fileURLToPath(new URL(`../frontend/public/icons/${name}.svg`, import.meta.url));
// Runtime exhibit types share one mark ("e"); the views that replaced Chambers keep their names, so pins keep theirs.
const CORE_ICONS: Record<string, string> = {
  e: icon("record"),
  types: icon("record"),
  builder: icon("record"),
  events: icon("events"),
  fitness: icon("fitness"),
  map: icon("map"),
  whatsapp: icon("whatsapp"),
};

export async function serveChamberIcon(c: Context, name: string): Promise<Response> {
  const core = CORE_ICONS[name];
  if (!core) return c.json({ error: "chamber_not_found", chamber: name }, 404);
  const svg = await readFile(core);
  return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
}
