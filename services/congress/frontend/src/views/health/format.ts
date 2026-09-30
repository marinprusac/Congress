import type { HealthMetric } from "@/lib/fitnessApi";

// Active and resting energy come one row per day each, stamped with the same start.
export function mergeCalories(active: HealthMetric[], resting: HealthMetric[]) {
  const byDate = new Map<string, { startDate: string; active: number; resting: number }>();
  for (const m of active) byDate.set(m.startDate, { ...(byDate.get(m.startDate) ?? { startDate: m.startDate, active: 0, resting: 0 }), active: m.value });
  for (const m of resting) byDate.set(m.startDate, { ...(byDate.get(m.startDate) ?? { startDate: m.startDate, active: 0, resting: 0 }), resting: m.value });
  return [...byDate.values()].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

export interface WorkoutSet {
  index: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  oneRepMax: number | null;
}

// Whichever of weight/reps/duration/distance the set has (Hevy shares one shape).
export function formatSet(set: WorkoutSet): string {
  if (set.weightKg != null && set.reps != null) return `${set.weightKg} kg × ${set.reps}`;
  if (set.weightKg != null) return `${set.weightKg} kg`;
  if (set.reps != null) return `${set.reps} reps`;
  if (set.durationSeconds != null) return `${Math.floor(set.durationSeconds / 60)}:${String(Math.round(set.durationSeconds % 60)).padStart(2, "0")}`;
  if (set.distanceMeters != null) return set.distanceMeters >= 1000 ? `${(set.distanceMeters / 1000).toFixed(2)} km` : `${set.distanceMeters} m`;
  return "—";
}
