import { z } from "zod";

// A ```map code block in a chat reply: JSON the AI writes to draw places on a map.
//   { "markers": [{ "lat": 45.8, "lng": 15.97, "label": "Cafe" }],
//     "paths": [[[45.8, 15.97], [45.81, 15.98]]],
//     "circles": [{ "lat": 45.8, "lng": 15.97, "radius": 100, "label": "Home" }] }

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const label = z.string().max(80).optional();

export const chatMapSchema = z
  .object({
    markers: z.array(z.object({ lat, lng, label })).max(100).default([]),
    paths: z.array(z.array(z.tuple([lat, lng])).min(2).max(500)).max(20).default([]),
    circles: z.array(z.object({ lat, lng, radius: z.number().positive().max(100_000), label })).max(50).default([]),
    height: z.number().int().min(120).max(500).default(240),
  })
  .refine((m) => m.markers.length + m.paths.length + m.circles.length > 0, "empty map");

export type ChatMapSpec = z.infer<typeof chatMapSchema>;

// The spec for a block's text, or null when it isn't (yet) valid JSON of that shape.
export function parseChatMap(code: string): ChatMapSpec | null {
  let json: unknown;
  try {
    json = JSON.parse(code);
  } catch {
    return null;
  }
  const parsed = chatMapSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// Every point the map should frame.
export function mapPoints(spec: ChatMapSpec): [number, number][] {
  return [...spec.markers.map((m): [number, number] => [m.lat, m.lng]), ...spec.paths.flat(), ...spec.circles.map((c): [number, number] => [c.lat, c.lng])];
}
