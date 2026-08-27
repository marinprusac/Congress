import { useCapitolSettings } from "@congress/congress-ui";

// CARTO's raster basemaps used to be free and keyless but now watermark
// every tile "API KEY REQUIRED" without one (see carto.com/basemaps/apikey)
// - switched to OSM's own tile server instead, which is still genuinely
// keyless. It has no native dark variant, so dark mode is faked with a CSS
// filter (`.map-tiles-dark` in mapMarker.css) rather than a second tile
// source, same "no third-party API key" constraint as before.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function useMapTileUrl(): string {
  return TILE_URL;
}

export function useMapTileClassName(): string {
  const { data } = useCapitolSettings();
  return data?.darkMode ? "map-tiles-dark" : "";
}
