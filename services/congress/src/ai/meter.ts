// The proactive meter: a free, in-memory measure of "enough has happened
// that the AI should take a look". Events add pressure that decays; time
// since the gate last looked adds a heartbeat. Crossing the threshold asks
// the (cheap) gate model whether a real run is worth it.

export type Sensitivity = "low" | "normal" | "high";

export const THRESHOLDS: Record<Sensitivity, number> = { low: 12, normal: 6, high: 3 };
// Pressure halves every 2 hours: a burst matters, a trickle doesn't pile up.
export const HALF_LIFE_MS = 2 * 60 * 60 * 1000;
// After the gate says act, don't look again for a while.
export const COOLDOWN_MS = 30 * 60 * 1000;

export interface MeterState {
  pressure: number;
  updatedAt: number;
  lastGateAt: number;
  cooldownUntil: number;
}

export function initialMeter(now: number): MeterState {
  return { pressure: 0, updatedAt: now, lastGateAt: now, cooldownUntil: 0 };
}

function decayed(state: MeterState, now: number): number {
  const dt = Math.max(0, now - state.updatedAt);
  return state.pressure * Math.pow(0.5, dt / HALF_LIFE_MS);
}

export function observe(state: MeterState, weight: number, now: number): MeterState {
  return { ...state, pressure: decayed(state, now) + weight, updatedAt: now };
}

// Event pressure plus a heartbeat term that reaches the threshold on its
// own after `heartbeatHours` without a look.
export function reading(state: MeterState, now: number, heartbeatHours: number, sensitivity: Sensitivity): number {
  const heartbeat = ((now - state.lastGateAt) / (heartbeatHours * 60 * 60 * 1000)) * THRESHOLDS[sensitivity];
  return decayed(state, now) + Math.max(0, heartbeat);
}

export function shouldFire(state: MeterState, now: number, opts: { heartbeatHours: number; sensitivity: Sensitivity; quiet: boolean }): boolean {
  if (opts.quiet || now < state.cooldownUntil) return false;
  return reading(state, now, opts.heartbeatHours, opts.sensitivity) >= THRESHOLDS[opts.sensitivity];
}

// The gate looked: event pressure is spent, the heartbeat restarts, and an
// "act" verdict also starts a cooldown.
export function afterGate(state: MeterState, now: number, acted: boolean): MeterState {
  return { pressure: 0, updatedAt: now, lastGateAt: now, cooldownUntil: acted ? now + COOLDOWN_MS : state.cooldownUntil };
}

export interface EventLike {
  type: string;
  actor?: string;
}

// The AI's own doings never count; watched events count triple.
export function eventWeight(event: EventLike, watchedTypes: Set<string>): number {
  if (event.actor === "congress" || event.type.startsWith("congress.ai_")) return 0;
  if (watchedTypes.has(event.type)) return 3;
  if (event.type === "congress.app_updated" || event.type === "logs.rule_updated") return 0.25;
  return 1;
}
