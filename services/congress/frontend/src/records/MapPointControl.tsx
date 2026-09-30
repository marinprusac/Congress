import { useQuery } from "@tanstack/react-query";
import { PlacePicker } from "@/views/map/PlacePicker";
import { fetchVisitActiveAt } from "@/views/map/api";

export interface MapPoint {
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
}

const FALLBACK: [number, number] = [45.815, 15.982];
const DEFAULT_RADIUS = 100;

// A type's paired latitude/longitude(/radius) fields as one map: drag or tap
// to move the point. A new one starts where the owner last was.
export function MapPointControl({ value, onChange, hasRadius, readOnly }: { value: MapPoint; onChange: (next: MapPoint) => void; hasRadius: boolean; readOnly?: boolean }) {
  const unset = value.latitude === null || value.longitude === null;
  const lastSeen = useQuery({ queryKey: ["location", "now"], queryFn: () => fetchVisitActiveAt(new Date().toISOString()).catch(() => null), enabled: unset, staleTime: 60_000 });
  const guess: [number, number] = lastSeen.data?.latitude != null && lastSeen.data.longitude != null ? [lastSeen.data.latitude, lastSeen.data.longitude] : FALLBACK;
  const [lat, lon] = unset ? guess : [value.latitude!, value.longitude!];
  const radius = value.radius ?? DEFAULT_RADIUS;

  const useMyLocation = () =>
    navigator.geolocation?.getCurrentPosition((pos) => onChange({ ...value, latitude: pos.coords.latitude, longitude: pos.coords.longitude, radius: value.radius ?? (hasRadius ? DEFAULT_RADIUS : null) }));

  return (
    <div className="space-y-2">
      <PlacePicker
        key={unset ? "unset" : "set"}
        latitude={lat}
        longitude={lon}
        radiusMeters={hasRadius ? radius : 0}
        readOnly={readOnly}
        onChange={(p) => onChange({ ...value, latitude: round(p.latitude), longitude: round(p.longitude), radius: value.radius ?? (hasRadius ? DEFAULT_RADIUS : null) })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-slate">
        <span>{unset ? "Tap the map to set the place" : `${value.latitude!.toFixed(5)}, ${value.longitude!.toFixed(5)}`}</span>
        {!readOnly && (
          <span className="flex items-center gap-3">
            {hasRadius && (
              <label className="flex items-center gap-1">
                radius
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={radius}
                  onChange={(e) => onChange({ ...value, radius: Number(e.target.value) || DEFAULT_RADIUS })}
                  className="w-16 border border-dust bg-parchment px-1 py-0.5 text-ink"
                />
                m
              </label>
            )}
            <button type="button" onClick={useMyLocation} className="tap-target uppercase tracking-wide text-accent hover:underline">
              Use my location
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
