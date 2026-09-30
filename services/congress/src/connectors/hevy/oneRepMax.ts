// Epley formula. Only meaningful for a weight+rep set (not a duration/
// distance-based cardio set, and not a 0-or-negative rep count, which isn't
// real performed data) - null in those cases rather than a nonsensical
// number.
export function computeOneRepMax(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || reps == null || reps <= 0) return null;
  return weightKg * (1 + reps / 30);
}
