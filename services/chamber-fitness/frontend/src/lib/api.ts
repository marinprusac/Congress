import type { WorkoutSummary, WorkoutDetail, Settings, HevySyncHealth } from "../../../src/types";
import { resolveApiBase, parseJsonResponse as json } from "@congress/congress-ui";

const API_BASE = resolveApiBase("fitness", import.meta.env.PROD);

export function fetchWorkouts(): Promise<WorkoutSummary[]> {
  return fetch(`${API_BASE}/workouts`).then((res) => json(res));
}

export function fetchRecentWorkouts(): Promise<WorkoutSummary[]> {
  return fetch(`${API_BASE}/workouts/recent`).then((res) => json(res));
}

export interface WeekStats {
  workoutCount: number;
  totalVolumeKg: number;
}

export function fetchWeekStats(): Promise<WeekStats> {
  return fetch(`${API_BASE}/workouts/week-stats`).then((res) => json(res));
}

export function fetchWorkout(id: number): Promise<WorkoutDetail> {
  return fetch(`${API_BASE}/workouts/${id}`).then((res) => json(res));
}

export function fetchSettings(): Promise<Settings> {
  return fetch(`${API_BASE}/settings`).then((res) => json(res));
}

export function updateSettings(input: Partial<Settings>): Promise<Settings> {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function fetchSyncHealth(): Promise<HevySyncHealth> {
  return fetch(`${API_BASE}/sync-health`).then((res) => json(res));
}

export function triggerSync(): Promise<HevySyncHealth> {
  return fetch(`${API_BASE}/sync`, { method: "POST" }).then((res) => json(res));
}
