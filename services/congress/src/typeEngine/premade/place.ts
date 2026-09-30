import type { Premade } from "./index.js";

// Replaces the Map Chamber's places: the owner's named spots. The location
// connector reads them to recognise visits (it never writes them).
export const PLACE: Premade = {
  key: "place",
  batches: [
    [
      { op: "create_type", slug: "place", label: "Place", pluralLabel: "Places", icon: "map" },
      { op: "add_field", slug: "name", label: "Name", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "name" },
      { op: "add_field", slug: "latitude", label: "Latitude", kind: "number", options: { required: true } },
      { op: "add_field", slug: "longitude", label: "Longitude", kind: "number", options: { required: true } },
      { op: "add_field", slug: "radius", label: "Radius (m)", kind: "number" },
      { op: "set_map_point", point: { latitude: "latitude", longitude: "longitude", radius: "radius" } },
      { op: "add_field", slug: "notes", label: "Notes", kind: "richtext", options: { searchable: true } },
      { op: "set_layout", body: "notes" },
      // Hidden until the Map Chamber's cutover (phase 7c).
      { op: "set_type_meta", hidden: true },
    ],
  ],
};
