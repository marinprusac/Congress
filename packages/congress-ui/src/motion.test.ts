import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMIT_TIMEOUT_MS, flipDeltas, markRouteCommitted, presenceStep, runNavigation, setRoutePreloader, staggerDelayMs, STAGGER_MAX_ITEMS } from "./motion.js";

describe("presenceStep", () => {
  it("starts closing when an open thing closes", () => {
    expect(presenceStep({ prevOpen: true, closing: false }, false)).toEqual({ prevOpen: false, closing: true });
  });

  it("cancels an exit when reopened mid-way", () => {
    expect(presenceStep({ prevOpen: false, closing: true }, true)).toEqual({ prevOpen: true, closing: false });
  });

  it("returns the same state object when nothing changed", () => {
    const state = { prevOpen: false, closing: false };
    expect(presenceStep(state, false)).toBe(state);
  });
});

describe("flipDeltas", () => {
  it("reports moved items as the offset from their old spot", () => {
    const prev = new Map([
      ["a", { top: 0, left: 0 }],
      ["b", { top: 100, left: 0 }],
    ]);
    const next = new Map([
      ["b", { top: 0, left: 0 }],
      ["a", { top: 100, left: 0 }],
    ]);
    expect(flipDeltas(prev, next).moved).toEqual([
      { key: "b", dx: 0, dy: 100 },
      { key: "a", dx: 0, dy: -100 },
    ]);
  });

  it("separates new items and ignores sub-threshold jitter", () => {
    const prev = new Map([["a", { top: 0, left: 0 }]]);
    const next = new Map([
      ["a", { top: 0.4, left: 0 }],
      ["c", { top: 50, left: 0 }],
    ]);
    expect(flipDeltas(prev, next)).toEqual({ moved: [], entered: ["c"] });
  });
});

describe("staggerDelayMs", () => {
  it("steps per item up to a cap", () => {
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(2, 30)).toBe(60);
    expect(staggerDelayMs(50, 30)).toBe(STAGGER_MAX_ITEMS * 30);
    expect(staggerDelayMs(-1)).toBe(0);
  });
});

interface FakeTransition {
  finished: Promise<void>;
  skipTransition: ReturnType<typeof vi.fn>;
}

describe("runNavigation", () => {
  let transitions: FakeTransition[];
  let root: { dataset: Record<string, string> };

  function stubDom({ viewTransitions = true, reduced = false } = {}) {
    transitions = [];
    root = { dataset: {} };
    const win = Object.assign(new EventTarget(), {
      matchMedia: () => ({ matches: reduced }),
    });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      visibilityState: "visible",
      documentElement: root,
      startViewTransition: viewTransitions
        ? (update: () => Promise<void>) => {
            const t: FakeTransition = { finished: Promise.resolve().then(update), skipTransition: vi.fn() };
            transitions.push(t);
            return t;
          }
        : undefined,
    });
  }

  beforeEach(() => stubDom());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("navigates immediately when the shell never signalled a commit", () => {
    const go = vi.fn();
    runNavigation(go, "push");
    expect(go).toHaveBeenCalledOnce();
    expect(transitions).toHaveLength(0);
  });

  it("falls back to a plain navigation without View Transitions", () => {
    stubDom({ viewTransitions: false });
    markRouteCommitted();
    const go = vi.fn();
    runNavigation(go, "push");
    expect(go).toHaveBeenCalledOnce();
  });

  it("skips the animation under reduced motion", () => {
    stubDom({ reduced: true });
    markRouteCommitted();
    const go = vi.fn();
    runNavigation(go, "tab");
    expect(go).toHaveBeenCalledOnce();
    expect(transitions).toHaveLength(0);
  });

  it("animates once the new route commits, then clears the kind", async () => {
    markRouteCommitted();
    let kindDuringTransition: string | undefined;
    const go = vi.fn(() => {
      kindDuringTransition = root.dataset.navTransition;
      markRouteCommitted();
    });
    runNavigation(go, "push");
    await vi.waitFor(() => expect(transitions).toHaveLength(1));
    await transitions[0]!.finished;
    expect(kindDuringTransition).toBe("push");
    await Promise.resolve();
    expect(go).toHaveBeenCalledOnce();
    expect(transitions[0]!.skipTransition).not.toHaveBeenCalled();
    expect(root.dataset.navTransition).toBeUndefined();
  });

  it("skips the animation when the route never commits", async () => {
    vi.useFakeTimers();
    markRouteCommitted();
    runNavigation(() => {}, "pop");
    await vi.advanceTimersByTimeAsync(0);
    expect(transitions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(COMMIT_TIMEOUT_MS + 1);
    expect(transitions[0]!.skipTransition).toHaveBeenCalled();
  });

  it("waits for a route preload before starting", async () => {
    markRouteCommitted();
    let release!: () => void;
    const preloader = vi.fn(() => new Promise<void>((r) => (release = r)));
    setRoutePreloader(preloader);
    const go = vi.fn(() => markRouteCommitted());
    runNavigation(go, "push", "/notes/n/1");
    expect(preloader).toHaveBeenCalledWith("/notes/n/1");
    await Promise.resolve();
    expect(transitions).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(go).toHaveBeenCalledOnce());
  });
});
