import { useCapitolSettings } from "@congress/congress-ui";

// CARTO's free, keyless basemaps - no third-party API key, no per-request
// coordinate leak beyond the tile provider itself (unavoidable for any
// slippy map). Light/dark variants swapped via Congress's own dark-mode
// setting, same as every other themed surface in this system.
const LIGHT_TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const DARK_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function useMapTileUrl(): string {
  const { data } = useCapitolSettings();
  return data?.darkMode ? DARK_TILE_URL : LIGHT_TILE_URL;
}
