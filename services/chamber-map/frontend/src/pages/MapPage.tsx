import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import { Link } from "react-router-dom";
import { useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchVisits, fetchTrips } from "@/lib/api";
import { useMapTileUrl, MAP_TILE_ATTRIBUTION } from "@/lib/mapTiles";
import { placeMarkerIcon } from "@/lib/markerIcon";
import type { Trip, Visit } from "../../../src/types";
import "leaflet/dist/leaflet.css";
import "@/components/mapMarker.css";

function localDayBounds(dateStr: string): { from: string; to: string } {
  return {
    from: new Date(`${dateStr}T00:00:00`).toISOString(),
    to: new Date(`${dateStr}T23:59:59.999`).toISOString(),
  };
}

function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const MODE_COLOR: Record<Trip["mode"], string> = {
  walk: "#7c9c74",
  bike: "#c98a3a",
  drive: "#a6231f",
  unknown: "#8b8880",
};

export function MapPage() {
  const [date, setDate] = useState(todayLocal());
  const shellHosted = useShellHosted();
  const tileUrl = useMapTileUrl();
  const { from, to } = localDayBounds(date);

  const visitsQuery = useQuery({ queryKey: ["visits", from, to], queryFn: () => fetchVisits({ from, to }) });
  const tripsQuery = useQuery({ queryKey: ["trips", from, to], queryFn: () => fetchTrips({ from, to }) });

  const visits = visitsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];
  const visitsById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  // One marker per distinct place (or per unplaced cluster) visited that
  // day, not one per visit - two stops at Home shouldn't draw two pins.
  const markers = useMemo(() => {
    const byKey = new Map<string, Visit>();
    for (const v of visits) {
      if (v.status === "ignored" || v.latitude === null || v.longitude === null) continue;
      const key = v.placeId ? `place-${v.placeId}` : `visit-${v.id}`;
      if (!byKey.has(key)) byKey.set(key, v);
    }
    return [...byKey.values()];
  }, [visits]);

  const entries = useMemo(() => {
    const items: { at: string; node: ReactNode }[] = [];
    for (const v of visits) {
      if (v.status === "ignored") continue;
      items.push({
        at: v.arrivedAt,
        node: (
          <li key={`visit-${v.id}`} className="border-b border-dust py-2">
            <span className="font-display text-ink">{v.placeName ?? v.adhocLabel ?? "Unclassified location"}</span>
            <span className="ml-2 text-sm text-dust">
              {formatTime(v.arrivedAt)}
              {v.departedAt ? ` – ${formatTime(v.departedAt)}` : " – now"}
              {v.durationMinutes !== null ? ` (${v.durationMinutes} min)` : ""}
            </span>
          </li>
        ),
      });
    }
    for (const t of trips) {
      items.push({
        at: t.departedAt,
        node: (
          <li key={`trip-${t.id}`} className="border-b border-dust py-2 text-sm text-slate italic">
            {t.mode} · {t.fromLabel} → {t.toLabel} · {t.durationMinutes} min · {t.distanceKm.toFixed(1)} km
          </li>
        ),
      });
    }
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [visits, trips]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button className="tap-target text-accent hover:underline" onClick={() => setDate((d) => shiftDate(d, -1))}>
            ← Prev
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-dust bg-parchment px-2 py-1 font-mono text-sm text-ink"
          />
          <button className="tap-target text-accent hover:underline" onClick={() => setDate((d) => shiftDate(d, 1))}>
            Next →
          </button>
        </div>
        <Link to={resolveChamberPath("/places", "map", shellHosted)} className="text-sm text-accent hover:underline">
          Manage places
        </Link>
      </div>

      <div className="mb-4 h-80 overflow-hidden rounded border border-dust">
        <MapContainer
          center={markers[0] ? [markers[0].latitude!, markers[0].longitude!] : [20, 0]}
          zoom={markers.length ? 13 : 2}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} />
          {markers.map((v) => (
            <Marker key={v.id} position={[v.latitude!, v.longitude!]} icon={placeMarkerIcon}>
              <Popup>{v.placeName ?? v.adhocLabel ?? "Unclassified location"}</Popup>
            </Marker>
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
                pathOptions={{ color: MODE_COLOR[t.mode], weight: 3, dashArray: t.mode === "unknown" ? "4 4" : undefined }}
              />
            );
          })}
        </MapContainer>
      </div>

      {visitsQuery.isLoading || tripsQuery.isLoading ? (
        <p className="font-mono text-sm text-dust">Loading —</p>
      ) : entries.length === 0 ? (
        <p className="font-mono text-sm text-dust">— No visits recorded for this day —</p>
      ) : (
        <ul>{entries.map((e) => e.node)}</ul>
      )}
    </section>
  );
}
