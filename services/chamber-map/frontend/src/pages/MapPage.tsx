import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";
import { useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchVisits, fetchTrips, fetchVisit, fetchVisitActiveAt } from "@/lib/api";
import { useMapTileUrl, useMapTileClassName, MAP_TILE_ATTRIBUTION } from "@/lib/mapTiles";
import { formatDuration } from "@/lib/formatDuration";
import { placeMarkerIcon } from "@/lib/markerIcon";
import { tripPositions } from "@/lib/tripPath";
import type { Trip, Visit } from "../../../src/types";
import "leaflet/dist/leaflet.css";
import "@/components/mapMarker.css";

function localDayBounds(dateStr: string): { from: string; to: string } {
  return {
    from: new Date(`${dateStr}T00:00:00`).toISOString(),
    to: new Date(`${dateStr}T23:59:59.999`).toISOString(),
  };
}

// Pulls the calendar-day part back out in local time - the same
// UTC-conversion trap toISOString() sets for shiftDate() below, worked
// around the same way.
function localDateStr(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function todayLocal(): string {
  return localDateStr(new Date());
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

// A bare time reads as "today" - true for every ordinary visit, since arrival
// is what the day query filters on, but not for a boundary carried in from
// outside that window (see the day-bookend logic below) or for a departure
// that spilled into a later day than its own arrival. Dates the two apart.
function formatTimeMaybeDated(iso: string, referenceDate: string): string {
  const time = formatTime(iso);
  if (localDateStr(new Date(iso)) === referenceDate) return time;
  return `${new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const MODE_COLOR: Record<Trip["mode"], string> = {
  walk: "#7c9c74",
  bike: "#c98a3a",
  transit: "#3a6ea5",
  unknown: "#8b8880",
};

// MapContainer's own center/zoom props only apply once, at first mount -
// react-leaflet ignores later changes to them. Visits load asynchronously
// (the map mounts before the query resolves), so without this the map
// would permanently lock onto its zoomed-out "no markers yet" fallback
// view instead of ever moving to show the day's actual locations once they
// arrive.
// Frames the day over where it was actually spent - the routes travelled as
// well as the places stopped at. Fitting to the markers alone would zoom
// tight around a single stop and leave that day's trip lines off-screen
// entirely, which for a day whose whole story is one long journey hides
// exactly the thing worth seeing. Both props must be memoized by the
// caller: a fresh array each render would re-fit the map continuously and
// fight the viewer's own panning.
function FitToDay({ markers, paths }: { markers: Visit[]; paths: [number, number][][] }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      ...markers.map((v): [number, number] => [v.latitude!, v.longitude!]),
      ...paths.flat(),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0]!, 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 });
  }, [markers, paths, map]);
  return null;
}

function TripEntry({ trip }: { trip: Trip }) {
  return (
    <li className="py-1 pl-6 text-xs text-dust">
      <span className="italic">
        {trip.mode} · {formatDuration(trip.durationMinutes)} · {trip.distanceKm.toFixed(1)} km
      </span>
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

  // Resolved once and reused for both drawing and framing, so the two can't
  // disagree about which trips are on the map.
  const tripLines = useMemo(
    () =>
      trips
        .map((trip) => ({ trip, positions: tripPositions(trip, visitsById) }))
        .filter((line): line is { trip: Trip; positions: [number, number][] } => line.positions !== null),
    [trips, visitsById]
  );
  const tripPaths = useMemo(() => tripLines.map((line) => line.positions), [tripLines]);

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

  // A day should never open or close on a bare route - the device was
  // always *somewhere* at midnight, even if that stay's own arrival (or, for
  // an entirely quiet day, its only visit at all) falls outside this day's
  // [from, to) window. The day's leading/trailing trip already names the
  // visit each case needs (fromVisitId/toVisitId), no day-window guesswork
  // required; a day with no visits or trips of its own at all instead asks
  // "where was the device as of this day's very first instant" directly.
  const firstEntry = entries[0] ?? null;
  const lastEntry = entries.length > 0 ? entries[entries.length - 1]! : null;
  const leadingTrip = firstEntry?.kind === "trip" ? firstEntry.trip : null;
  const trailingTrip = lastEntry?.kind === "trip" ? lastEntry.trip : null;
  const dayEmpty = entries.length === 0;

  const leadingVisitQuery = useQuery({
    queryKey: ["visit", leadingTrip?.fromVisitId],
    queryFn: () => fetchVisit(leadingTrip!.fromVisitId),
    enabled: leadingTrip !== null,
  });
  const trailingVisitQuery = useQuery({
    queryKey: ["visit", trailingTrip?.toVisitId],
    queryFn: () => fetchVisit(trailingTrip!.toVisitId),
    enabled: trailingTrip !== null,
  });
  const activeVisitQuery = useQuery({
    queryKey: ["visit-active-at", from],
    queryFn: () => fetchVisitActiveAt(from),
    enabled: dayEmpty,
  });

  const bookendVisits = [leadingVisitQuery.data, trailingVisitQuery.data, activeVisitQuery.data].filter(
    (v): v is Visit => v != null
  );
  const bookendsLoading =
    (leadingTrip !== null && leadingVisitQuery.isLoading) ||
    (trailingTrip !== null && trailingVisitQuery.isLoading) ||
    (dayEmpty && activeVisitQuery.isLoading);

  // One marker per distinct place (or per unplaced cluster) visited that
  // day, not one per visit - two stops at Home shouldn't draw two pins.
  // Bookend visits fold in here too, so a route-only or entirely-quiet day
  // still shows *something* on the map, not an empty tile.
  const markers = useMemo(() => {
    const byKey = new Map<string, Visit>();
    for (const v of [...visits, ...bookendVisits]) {
      if (v.status === "ignored" || v.latitude === null || v.longitude === null) continue;
      const key = v.placeId ? `place-${v.placeId}` : `visit-${v.id}`;
      if (!byKey.has(key)) byKey.set(key, v);
    }
    return [...byKey.values()];
  }, [visits, leadingVisitQuery.data, trailingVisitQuery.data, activeVisitQuery.data]);

  // entries, with a carried-over visit spliced onto whichever end(s) would
  // otherwise open or close on a bare route (see the query block above) - an
  // entirely quiet day replaces the empty list outright with its one
  // carried-over stay instead of appending to nothing.
  const displayEntries = useMemo(() => {
    if (dayEmpty) {
      return activeVisitQuery.data
        ? [{ at: activeVisitQuery.data.arrivedAt, kind: "visit" as const, visit: activeVisitQuery.data }]
        : [];
    }
    const items = [...entries];
    if (leadingVisitQuery.data) items.unshift({ at: leadingVisitQuery.data.arrivedAt, kind: "visit", visit: leadingVisitQuery.data });
    if (trailingVisitQuery.data) items.push({ at: trailingVisitQuery.data.arrivedAt, kind: "visit", visit: trailingVisitQuery.data });
    return items;
  }, [entries, dayEmpty, leadingVisitQuery.data, trailingVisitQuery.data, activeVisitQuery.data]);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          className="tap-target flex items-center justify-center text-accent"
          onClick={() => setDate((d) => shiftDate(d, -1))}
          aria-label="Previous day"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-transparent px-2 py-1 font-mono text-sm text-accent"
        />
        <button
          type="button"
          className="tap-target flex items-center justify-center text-accent"
          onClick={() => setDate((d) => shiftDate(d, 1))}
          aria-label="Next day"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" />
          </svg>
        </button>
      </div>

      <div
        className="mb-4 h-80 overflow-hidden rounded border border-dust"
        data-nav-swipe-ignore
      >
        <MapContainer
          center={markers[0] ? [markers[0].latitude!, markers[0].longitude!] : [20, 0]}
          zoom={markers.length ? 13 : 2}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={tileUrl} attribution={MAP_TILE_ATTRIBUTION} className={tileClassName} />
          <FitToDay markers={markers} paths={tripPaths} />
          {markers.map((v) => (
            <Marker key={v.id} position={[v.latitude!, v.longitude!]} icon={placeMarkerIcon}>
              <Popup>{v.placeName ?? v.adhocLabel ?? "Unclassified location"}</Popup>
            </Marker>
          ))}
          {tripLines.map(({ trip, positions }) => (
            <Polyline
              key={trip.id}
              positions={positions}
              pathOptions={{
                color: MODE_COLOR[trip.mode],
                weight: 3,
                dashArray: trip.mode === "unknown" || trip.mode === "transit" ? "4 4" : undefined,
              }}
            />
          ))}
        </MapContainer>
      </div>

      {visitsQuery.isLoading || tripsQuery.isLoading || bookendsLoading ? (
        <p className="font-mono text-sm text-dust">Loading —</p>
      ) : displayEntries.length === 0 ? (
        <p className="font-mono text-sm text-dust">— No visits recorded for this day —</p>
      ) : (
        <ul>
          {displayEntries.map((e) =>
            e.kind === "visit" ? (
              <li key={`visit-${e.visit.id}`} className="py-2">
                {e.visit.placeId !== null ? (
                  <Link
                    to={resolveChamberPath(`/p/${e.visit.placeId}`, "map", shellHosted)}
                    className="font-display text-ink hover:underline"
                  >
                    {e.visit.placeName ?? e.visit.adhocLabel ?? "Unclassified location"}
                  </Link>
                ) : (
                  <span className="font-display text-ink">{e.visit.placeName ?? e.visit.adhocLabel ?? "Unclassified location"}</span>
                )}
                <span className="ml-2 text-sm text-dust">
                  {formatTimeMaybeDated(e.visit.arrivedAt, date)}
                  {e.visit.departedAt ? ` – ${formatTimeMaybeDated(e.visit.departedAt, date)}` : " – now"}
                  {e.visit.durationMinutes !== null ? ` (${formatDuration(e.visit.durationMinutes)})` : ""}
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
