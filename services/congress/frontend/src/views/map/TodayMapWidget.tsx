import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import { ViewCard } from "@congress/congress-ui";
import { fetchVisits, fetchTrips, fetchVisitActiveAt } from "./api";
import { useMapTileUrl, useMapTileClassName, MAP_TILE_ATTRIBUTION } from "./mapTiles";
import { InvalidateSizeOnResize } from "./InvalidateSizeOnResize";
import { placeMarkerIcon } from "./markerIcon";
import { tripPositions } from "./tripPath";
import { dayMarkers } from "./dayMarkers";
import type { Trip } from "./types";
import "leaflet/dist/leaflet.css";
import "./mapMarker.css";

function todayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

const MODE_COLOR: Record<Trip["mode"], string> = {
  walk: "#7c9c74",
  bike: "#c98a3a",
  transit: "#3a6ea5",
  unknown: "#8b8880",
};

export function TodayMapWidget() {
  const tileUrl = useMapTileUrl();
  const tileClassName = useMapTileClassName();
  const from = todayIso();
  const visitsQuery = useQuery({ queryKey: ["visits", "today-widget"], queryFn: () => fetchVisits({ from }) });
  const tripsQuery = useQuery({ queryKey: ["trips", "today-widget"], queryFn: () => fetchTrips({ from }) });
  // Where the day began - a stay from last night never "arrives" today.
  const carriedQuery = useQuery({
    queryKey: ["visit-active-at", from],
    queryFn: () => fetchVisitActiveAt(from),
  });

  const visits = visitsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];
  const visitsById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  const markers = useMemo(() => dayMarkers([...visits, carriedQuery.data]), [visits, carriedQuery.data]);

  return (
    <ViewCard
      isLoading={visitsQuery.isLoading || carriedQuery.isLoading}
      isError={visitsQuery.isError}
      errorLabel="Map unavailable."
      isEmpty={markers.length === 0}
      emptyLabel="— Nowhere recorded yet today —"
    >
      {markers.length > 0 && (
        <div className="h-full w-full overflow-hidden rounded" data-nav-swipe-ignore>
          <MapContainer
            center={[markers[0]!.latitude!, markers[0]!.longitude!]}
            zoom={12}
            style={{ height: "100%", width: "100%" }}
            zoomControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
          >
            <InvalidateSizeOnResize />
            <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} className={tileClassName} />
            {markers.map((v) => (
              <Marker key={v.id} position={[v.latitude!, v.longitude!]} icon={placeMarkerIcon} />
            ))}
            {trips.map((t) => {
              const positions = tripPositions(t, visitsById);
              if (!positions) return null;
              return <Polyline key={t.id} positions={positions} pathOptions={{ color: MODE_COLOR[t.mode], weight: 2 }} />;
            })}
          </MapContainer>
        </div>
      )}
    </ViewCard>
  );
}
