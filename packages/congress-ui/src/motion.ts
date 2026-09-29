// Page transitions (View Transitions API) plus the pure helpers behind the
// other motion hooks. State lives on `window`, not module scope: congress-ui
// is compiled into every bundle separately (see ShellHostContext.tsx).

export type TransitionKind = "push" | "pop" | "tab";

const COMMIT_EVENT = "congress:route-commit";
// How long a transition waits for the new route to commit before giving up
// on the animation (the page still updates, just without the slide).
export const COMMIT_TIMEOUT_MS = 350;
// How long navigation waits on a route preload (a Chamber's remote entry)
// before starting anyway.
export const PRELOAD_TIMEOUT_MS = 400;

interface ViewTransitionLike {
  finished: Promise<void>;
  skipTransition(): void;
}

interface MotionState {
  // Set by the shell's RouteCommitSignal; without it there's nothing to wait
  // on, so navigation just happens without a transition.
  signal?: boolean;
  preloader?: (path: string) => Promise<unknown> | undefined;
  current?: ViewTransitionLike | null;
}

type MotionWindow = Window & { __congressMotion?: MotionState };

function motionState(win: MotionWindow = window as MotionWindow): MotionState {
  return (win.__congressMotion ??= {});
}

export function markRouteCommitted(): void {
  motionState().signal = true;
  window.dispatchEvent(new Event(COMMIT_EVENT));
}

// The shell registers how to warm a route (e.g. fetch a Chamber's bundle) so
// the transition animates the real page, not a loading state.
export function setRoutePreloader(fn: (path: string) => Promise<unknown> | undefined): void {
  motionState().preloader = fn;
}

export function preloadRoute(path: string): Promise<unknown> | undefined {
  try {
    return motionState().preloader?.(path);
  } catch {
    return undefined;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => ViewTransitionLike;
};

export function canTransition(doc: TransitionDocument = document as TransitionDocument): boolean {
  return Boolean(motionState().signal) && typeof doc.startViewTransition === "function" && !prefersReducedMotion() && doc.visibilityState === "visible";
}

function waitForCommit(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (committed: boolean) => {
      clearTimeout(timer);
      window.removeEventListener(COMMIT_EVENT, onCommit);
      resolve(committed);
    };
    const onCommit = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    window.addEventListener(COMMIT_EVENT, onCommit);
  });
}

function withTimeout(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!promise) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

// Runs `go` (a router navigation) inside a view transition of the given kind.
// `html[data-nav-transition]` selects the animation in motion.css. `go` may
// be async (a tab switch steps back through history first); the returned
// promise settles once it has run.
export function runNavigation(go: () => void | Promise<void>, kind: TransitionKind, target?: string): Promise<void> {
  const doc = document as TransitionDocument;
  if (!canTransition(doc)) return settle(go);
  return withTimeout(target ? preloadRoute(target) : undefined, PRELOAD_TIMEOUT_MS).then(
    () =>
      new Promise<void>((resolve) => {
        const state = motionState();
        state.current?.skipTransition();
        const root = doc.documentElement;
        root.dataset.navTransition = kind;
        let vt!: ViewTransitionLike;
        try {
          vt = doc.startViewTransition!(async () => {
            const committed = waitForCommit(COMMIT_TIMEOUT_MS);
            try {
              await go();
            } finally {
              resolve();
            }
            // Snapshotting a page that never changed would slide it onto itself.
            if (!(await committed)) queueMicrotask(() => vt.skipTransition());
          });
        } catch {
          delete root.dataset.navTransition;
          void settle(go).then(resolve);
          return;
        }
        state.current = vt;
        vt.finished.finally(() => {
          if (state.current !== vt) return;
          state.current = null;
          delete root.dataset.navTransition;
        });
      })
  );
}

// Calls `go` right away (synchronously), resolving once it's done.
function settle(go: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(go()).then(
      () => undefined,
      () => undefined
    );
  } catch {
    return Promise.resolve();
  }
}

// Plain left clicks only - modifier clicks keep the browser's own behavior.
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

// ---- Presence (mount through an exit animation) ----

export interface PresenceState {
  prevOpen: boolean;
  closing: boolean;
}

export function presenceStep(state: PresenceState, open: boolean): PresenceState {
  if (open === state.prevOpen) return state;
  return { prevOpen: open, closing: !open };
}

// ---- FLIP (animate list items to their new positions) ----

export interface Box {
  top: number;
  left: number;
}

export interface FlipResult {
  moved: { key: string; dx: number; dy: number }[];
  entered: string[];
}

export function flipDeltas(prev: Map<string, Box>, next: Map<string, Box>, threshold = 1): FlipResult {
  const moved: FlipResult["moved"] = [];
  const entered: string[] = [];
  for (const [key, box] of next) {
    const before = prev.get(key);
    if (!before) {
      entered.push(key);
      continue;
    }
    const dx = before.left - box.left;
    const dy = before.top - box.top;
    if (Math.abs(dx) >= threshold || Math.abs(dy) >= threshold) moved.push({ key, dx, dy });
  }
  return { moved, entered };
}

export const STAGGER_MAX_ITEMS = 8;

// Entrance delay for the i-th item of a first load; later items share the cap.
export function staggerDelayMs(index: number, stepMs = 35): number {
  return Math.min(Math.max(index, 0), STAGGER_MAX_ITEMS) * stepMs;
}
