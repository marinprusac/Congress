import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import { useCapitolSettings } from "@congress/congress-ui";
import { useMapTileUrl, MAP_TILE_ATTRIBUTION } from "@/lib/mapTiles";
import { placeMarkerIcon } from "@/lib/markerIcon";
import "leaflet/dist/leaflet.css";
import "./mapMarker.css";

function Recenter({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude]);
    // Only re-run when the coordinates actually change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);
  return null;
}

function ClickToMove({ onChange }: { onChange: (next: { latitude: number; longitude: number }) => void }) {
  useMapEvents({
    click(e) {
      onChange({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
  });
  return null;
}

export interface PlacePickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChange: (next: { latitude: number; longitude: number }) => void;
  height?: number;
  /** Disables click-to-move/drag - used for the small homepage widget map. */
  readOnly?: boolean;
}

export function PlacePicker({ latitude, longitude, radiusMeters, onChange, height = 260, readOnly = false }: PlacePickerProps) {
  const tileUrl = useMapTileUrl();
  const { data: capitolSettings } = useCapitolSettings();
  const circleColor = capitolSettings?.darkMode ? "#7fbf9e" : "#2b4a3e";
  const initialCenter = useRef<[number, number]>([latitude, longitude]);

  return (
    <div style={{ height }} className="overflow-hidden rounded border border-dust">
      <MapContainer center={initialCenter.current} zoom={16} style={{ height: "100%", width: "100%" }} dragging={!readOnly} scrollWheelZoom={!readOnly}>
        <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} />
        <Recenter latitude={latitude} longitude={longitude} />
        {!readOnly && <ClickToMove onChange={onChange} />}
        <Marker
          position={[latitude, longitude]}
          icon={placeMarkerIcon}
          draggable={!readOnly}
          eventHandlers={{
            dragend: (e) => {
              const pos = (e.target as L.Marker).getLatLng();
              onChange({ latitude: pos.lat, longitude: pos.lng });
            },
          }}
        />
        <Circle center={[latitude, longitude]} radius={radiusMeters} pathOptions={{ color: circleColor, weight: 1, fillOpacity: 0.08 }} />
      </MapContainer>
    </div>
  );
}
