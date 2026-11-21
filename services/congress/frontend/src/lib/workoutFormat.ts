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
