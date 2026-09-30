import L from "leaflet";

// A plain CSS dot instead of Leaflet's default pin image - the default icon
// references relative image paths that don't resolve under Vite's bundler
// without extra asset-copying config. Styled in components/mapMarker.css -
// import that alongside this wherever it's used.
export const placeMarkerIcon = L.divIcon({
  className: "map-place-marker",
  html: '<div class="map-place-marker-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});
