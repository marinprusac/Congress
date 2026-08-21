import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import { WidgetPreviewShell } from "@congress/congress-ui";
import { fetchVisits, fetchTrips } from "@/lib/api";
import { useMapTileUrl, MAP_TILE_ATTRIBUTION } from "@/lib/mapTiles";
import { placeMarkerIcon } from "@/lib/markerIcon";
import type { Trip, Visit } from "../../../src/types";
import "leaflet/dist/leaflet.css";
import "@/components/mapMarker.css";

function todayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

const MODE_COLOR: Record<Trip["mode"], string> = {
  walk: "#7c9c74",
  bike: "#c98a3a",
  drive: "#a6231f",
  unknown: "#8b8880",
};

export function TodayMapWidget() {
  const tileUrl = useMapTileUrl();
  const from = todayIso();
  const visitsQuery = useQuery({ queryKey: ["visits", "today-widget"], queryFn: () => fetchVisits({ from }) });
  const tripsQuery = useQuery({ queryKey: ["trips", "today-widget"], queryFn: () => fetchTrips({ from }) });

  const visits = visitsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];
  const visitsById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  const markers = useMemo(() => {
    const byKey = new Map<string, Visit>();
    for (const v of visits) {
      if (v.status === "ignored" || v.latitude === null || v.longitude === null) continue;
      const key = v.placeId ? `place-${v.placeId}` : `visit-${v.id}`;
      if (!byKey.has(key)) byKey.set(key, v);
    }
    return [...byKey.values()];
  }, [visits]);

  return (
    <WidgetPreviewShell
      label="Today's Map"
      addHref="/"
      addLabel="Open"
      ownChamber="map"
      isLoading={visitsQuery.isLoading}
      isError={visitsQuery.isError}
      errorLabel="Map unavailable."
      isEmpty={markers.length === 0}
      emptyLabel="— Nowhere recorded yet today —"
    >
      <div className="h-full w-full overflow-hidden rounded">
        <MapContainer
          center={[markers[0]!.latitude!, markers[0]!.longitude!]}
          zoom={12}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
        >
          <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} />
          {markers.map((v) => (
            <Marker key={v.id} position={[v.latitude!, v.longitude!]} icon={placeMarkerIcon} />
          ))}
          {trips.map((t) => {
            const fromVisit = visitsById.get(t.fromVisitId);
            const toVisit = visitsById.get(t.toVisitId);
            if (!fromVisit || !toVisit || fromVisit.latitude === null || toVisit.latitude === null) return null;
            return (
              <Polyline
                key={t.id}
                positions={[
                  [fromVisit.latitude, fromVisit.longitude!],
                  [toVisit.latitude, toVisit.longitude!],
                ]}
                pathOptions={{ color: MODE_COLOR[t.mode], weight: 2 }}
              />
            );
          })}
        </MapContainer>
      </div>
    </WidgetPreviewShell>
  );
}
