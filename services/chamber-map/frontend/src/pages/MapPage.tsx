import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";
import { useShellHosted, resolveChamberPath, showToast } from "@congress/congress-ui";
import { fetchVisits, fetchTrips, labelTrip } from "@/lib/api";
import { useMapTileUrl, useMapTileClassName, MAP_TILE_ATTRIBUTION } from "@/lib/mapTiles";
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
  // toISOString() converts to UTC, which silently shifts the date by a day
  // in any timezone ahead of UTC (local midnight is still "yesterday" in
  // UTC) - pull the parts back out in local time instead, the same way
  // todayLocal() has to work around the same trap.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

// MapContainer's own center/zoom props only apply once, at first mount -
// react-leaflet ignores later changes to them. Visits load asynchronously
// (the map mounts before the query resolves), so without this the map
// would permanently lock onto its zoomed-out "no markers yet" fallback
// view instead of ever moving to show the day's actual locations once they
// arrive.
function FitToMarkers({ markers }: { markers: Visit[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0]!.latitude!, markers[0]!.longitude!], 13);
      return;
    }
    const bounds = L.latLngBounds(markers.map((v): [number, number] => [v.latitude!, v.longitude!]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
  }, [markers, map]);
  return null;
}

// A commute between two different known places auto-labels itself
// ("commute to Work" - see tracking.ts's handleTransition); a same-place
// round trip (t.needsLabel - see visits.ts's toTrip) stays genuinely
// unlabeled instead, but still starts collapsed like every other trip - only
// an explicit click opens the editor, never the page load itself.
function TripEntry({ trip }: { trip: Trip }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(trip.label ?? "");
  const editRef = useRef<HTMLSpanElement>(null);

  const mutation = useMutation({
    mutationFn: () => labelTrip(trip.id, { label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      showToast(label.trim() ? "Labeled" : "Label cleared");
      setEditing(false);
    },
  });

  // A click anywhere outside the input/save control closes editing without
  // saving - same as Escape below, just for the "clicked elsewhere" case.
  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: PointerEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [editing]);

  return (
    <li className="py-1 pl-6 text-xs text-dust">
      <span className="italic">
        {trip.mode} · {trip.durationMinutes} min · {trip.distanceKm.toFixed(1)} km
        {trip.label ? ` · "${trip.label}"` : ""}
      </span>{" "}
      {editing ? (
        <span ref={editRef} className="inline-flex items-center gap-1 align-middle">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") mutation.mutate();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder='e.g. "walking the dog"'
            className="w-36 border-b border-dust bg-transparent px-1 text-xs text-ink focus:outline-none focus-visible:border-accent"
          />
          <button disabled={mutation.isPending} onClick={() => mutation.mutate()} className="text-accent hover:underline disabled:opacity-50">
            save
          </button>
        </span>
      ) : (
        <button onClick={() => setEditing(true)} className="text-accent hover:underline">
          {trip.label ? "rename" : "label"}
        </button>
      )}
    </li>
  );
}

export function MapPage() {
  const [date, setDate] = useState(todayLocal());
  const shellHosted = useShellHosted();
  const tileUrl = useMapTileUrl();
  const tileClassName = useMapTileClassName();
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
    const items: ({ at: string; kind: "visit"; visit: Visit } | { at: string; kind: "trip"; trip: Trip })[] = [];
    for (const v of visits) {
      if (v.status === "ignored") continue;
      items.push({ at: v.arrivedAt, kind: "visit", visit: v });
    }
    for (const t of trips) {
      items.push({ at: t.departedAt, kind: "trip", trip: t });
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

      <div
        className="mb-4 h-80 overflow-hidden rounded border border-dust"
        data-pull-gesture-ignore
        data-nav-swipe-ignore
      >
        <MapContainer
          center={markers[0] ? [markers[0].latitude!, markers[0].longitude!] : [20, 0]}
          zoom={markers.length ? 13 : 2}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} className={tileClassName} />
          <FitToMarkers markers={markers} />
          {markers.map((v) => (
            <Marker key={v.id} position={[v.latitude!, v.longitude!]} icon={placeMarkerIcon}>
              <Popup>{v.placeName ?? v.adhocLabel ?? "Unclassified location"}</Popup>
            </Marker>
          ))}
          {trips.map((t) => {
            const fromVisit = visitsById.get(t.fromVisitId);
            const toVisit = visitsById.get(t.toVisitId);
            if (!fromVisit || !toVisit || fromVisit.latitude === null || toVisit.latitude === null) return null;
            // t.path is the real sequence of GPS fixes recorded while in
            // transit (tracking.ts) - endpoints included so it connects
            // visually to the place markers even when both ends are the same
            // place (a same-place round trip with no dot in between). Falls
            // back to a straight line only for a trip with no recorded path
            // (e.g. one from before this was tracked, or a Chamber restart
            // mid-trip lost the in-memory accumulator) - genuinely all we
            // know in that case, not a substitute for the real thing.
            const positions: [number, number][] =
              t.path && t.path.length > 0
                ? [
                    [fromVisit.latitude, fromVisit.longitude!],
                    ...t.path.map((p): [number, number] => [p.latitude, p.longitude]),
                    [toVisit.latitude, toVisit.longitude!],
                  ]
                : [
                    [fromVisit.latitude, fromVisit.longitude!],
                    [toVisit.latitude, toVisit.longitude!],
                  ];
            return (
              <Polyline
                key={t.id}
                positions={positions}
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
        <ul>
          {entries.map((e) =>
            e.kind === "visit" ? (
              <li key={`visit-${e.visit.id}`} className="py-2">
                <span className="font-display text-ink">{e.visit.placeName ?? e.visit.adhocLabel ?? "Unclassified location"}</span>
                <span className="ml-2 text-sm text-dust">
                  {formatTime(e.visit.arrivedAt)}
                  {e.visit.departedAt ? ` – ${formatTime(e.visit.departedAt)}` : " – now"}
                  {e.visit.durationMinutes !== null ? ` (${e.visit.durationMinutes} min)` : ""}
                </span>
                {e.visit.status === "pending" && (
                  <Link to={resolveChamberPath("/pending", "map", shellHosted)} className="ml-2 text-sm text-accent hover:underline">
                    Label it →
                  </Link>
                )}
              </li>
            ) : (
              <TripEntry key={`trip-${e.trip.id}`} trip={e.trip} />
            )
          )}
        </ul>
      )}
    </section>
  );
}
