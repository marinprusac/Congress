import { useEffect } from "react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { useCapitolSettings } from "@congress/congress-ui";
import { InvalidateSizeOnResize } from "@/views/map/InvalidateSizeOnResize";
import { placeMarkerIcon } from "@/views/map/markerIcon";
import { MAP_TILE_ATTRIBUTION, useMapTileClassName, useMapTileUrl } from "@/views/map/mapTiles";
import { mapPoints, parseChatMap, type ChatMapSpec } from "./chatMap";
import "leaflet/dist/leaflet.css";
import "@/views/map/mapMarker.css";

function FitAll({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0]!, 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 });
  }, [map, points]);
  return null;
}

function ChatMap({ spec }: { spec: ChatMapSpec }) {
  const tileUrl = useMapTileUrl();
  const tileClassName = useMapTileClassName();
  const { data: settings } = useCapitolSettings();
  const color = settings?.darkMode ? "#7fbf9e" : "#2b4a3e";
  const points = mapPoints(spec);
  return (
    <div className="chat-map" style={{ height: spec.height }} data-nav-swipe-ignore>
      {/* One finger scrolls the chat on a phone; two fingers pan and zoom. */}
      <MapContainer center={points[0]!} zoom={15} style={{ height: "100%", width: "100%" }} dragging={!L.Browser.mobile} scrollWheelZoom={false}>
        <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} className={tileClassName} />
        <InvalidateSizeOnResize />
        <FitAll points={points} />
        {spec.circles.map((c, i) => (
          <Circle key={`c${i}`} center={[c.lat, c.lng]} radius={c.radius} pathOptions={{ color, weight: 1, fillOpacity: 0.08 }}>
            {c.label ? <Tooltip>{c.label}</Tooltip> : null}
          </Circle>
        ))}
        {spec.paths.map((p, i) => (
          <Polyline key={`p${i}`} positions={p} pathOptions={{ color, weight: 3, opacity: 0.8 }} />
        ))}
        {spec.markers.map((m, i) => (
          <Marker key={`m${i}`} position={[m.lat, m.lng]} icon={placeMarkerIcon}>
            {m.label ? <Popup>{m.label}</Popup> : null}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default ChatMap;
export { parseChatMap };
