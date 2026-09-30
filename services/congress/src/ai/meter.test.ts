import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, HALF_LIFE_MS, THRESHOLDS, afterGate, eventWeight, initialMeter, observe, reading, shouldFire } from "./meter.js";

const H = 60 * 60 * 1000;
const opts = { heartbeatHours: 4, sensitivity: "normal" as const, quiet: false };

describe("meter", () => {
  it("fires once enough events pile up", () => {
    let s = initialMeter(0);
    for (let i = 0; i < 5; i++) s = observe(s, 1, 1000 * i);
    expect(shouldFire(s, 5000, opts)).toBe(false);
    s = observe(s, 1, 6000);
    expect(shouldFire(s, 6000, opts)).toBe(true);
  });

  it("decays pressure by half every half-life", () => {
    const s = observe(initialMeter(0), 4, 0);
    // No heartbeat contribution with an enormous heartbeat window.
    expect(reading(s, HALF_LIFE_MS, 10_000, "normal")).toBeCloseTo(2, 2);
  });

  it("fires on the heartbeat alone after the configured quiet stretch", () => {
    const s = initialMeter(0);
    expect(shouldFire(s, 3.9 * H, opts)).toBe(false);
    expect(shouldFire(s, 4 * H, opts)).toBe(true);
  });

  it("never fires in quiet hours or during a cooldown", () => {
    const busy = observe(initialMeter(0), 100, 0);
    expect(shouldFire(busy, 0, { ...opts, quiet: true })).toBe(false);
    const acted = afterGate(busy, 0, true);
    expect(shouldFire(observe(acted, 100, 1000), 1000, opts)).toBe(false);
    expect(shouldFire(observe(acted, 100, COOLDOWN_MS), COOLDOWN_MS, opts)).toBe(true);
  });

  it("spends the pressure and restarts the heartbeat after the gate looks", () => {
    const s = afterGate(observe(initialMeter(0), 5, 0), 2 * H, false);
    expect(s.pressure).toBe(0);
    expect(s.cooldownUntil).toBe(0);
    expect(shouldFire(s, 5 * H, opts)).toBe(false);
  });

  it("respects sensitivity", () => {
    const s = observe(initialMeter(0), THRESHOLDS.high, 0);
    expect(shouldFire(s, 0, { ...opts, sensitivity: "high" })).toBe(true);
    expect(shouldFire(s, 0, { ...opts, sensitivity: "low" })).toBe(false);
  });
});

describe("eventWeight", () => {
  const watched = new Set(["tasks.overdue"]);
  it("ignores the AI's own events and weights watched ones up", () => {
    expect(eventWeight({ type: "notes.created", actor: "congress" }, watched)).toBe(0);
    expect(eventWeight({ type: "congress.ai_chat_run" }, watched)).toBe(0);
    expect(eventWeight({ type: "tasks.overdue" }, watched)).toBe(3);
    expect(eventWeight({ type: "notes.created", actor: "system" }, watched)).toBe(1);
    expect(eventWeight({ type: "logs.rule_updated" }, watched)).toBe(0.25);
  });
});
