// Drives the router and browser history from navStack.ts's model. The shell
// owns the one instance (StackNavigator) and publishes it on `window`, so a
// Chamber's bundle - with its own copy of congress-ui - reaches the same
// engine (see ShellHostContext.tsx for why this can't be React Context).

import {
  activeStack,
  applyLocation,
  completeRebuild,
  currentEntry,
  initialNavState,
  isTabRoot,
  planColdStart,
  planSwitch,
  popTarget,
  recordScroll,
  TAB_ROOT,
  tabOfPath,
  type NavAction,
  type NavState,
  type NavTab,
  type RebuildPlan,
} from "./navStack.js";
import type { TransitionKind } from "./motion.js";

export type NavTransition = TransitionKind | "none";

export interface NavDeps {
  // The shell router's navigate, with absolute paths only.
  navigate(path: string, replace: boolean): void;
  go(delta: number): void;
  // The router's key for the current history entry, read right after a
  // navigate() (which writes history synchronously).
  historyKey(): string | null;
  // The router's index of the current history entry within this document,
  // or null if unknown - a bound on how far back is still this app.
  historyIndex(): number | null;
  // Resolves on the next popstate (or after a timeout).
  nextPop(): Promise<void>;
  transition(go: () => void | Promise<void>, kind: NavTransition, target: string): Promise<void>;
  load(): NavState | null;
  save(state: NavState): void;
  scrollTo(y: number): void;
}

export interface PushOptions {
  replace?: boolean;
  transition?: NavTransition;
}

// What a Chamber bundle may call. Keep it small and stable: an older
// Chamber build can meet a newer shell.
export interface NavEngineApi {
  push(path: string, options?: PushOptions): Promise<void>;
  pop(options?: { transition?: NavTransition }): Promise<void>;
  selectTab(tab: NavTab): Promise<void>;
  open(path: string, tab: NavTab): Promise<void>;
}

// How long an operation waits for the router to commit what it started.
export const SETTLE_TIMEOUT_MS = 1000;

export class NavEngine implements NavEngineApi {
  state: NavState = initialNavState();
  private initialized = false;
  private rebuilding = false;
  private expectKey: string | null = null;
  private expectTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private settleWaiters: (() => void)[] = [];
  private listeners = new Set<() => void>();

  constructor(private deps: NavDeps) {}

  // ---- Observing the router ----

  onLocation(loc: { key: string; path: string }, action: NavAction): void {
    if (!this.initialized) {
      this.initialized = true;
      this.init(loc);
      return;
    }
    if (this.rebuilding) return;
    if (this.expectKey !== null) {
      // Intermediate commits of a rebuild are already accounted for.
      if (loc.key !== this.expectKey) return;
      this.clearExpect();
      this.deps.scrollTo(currentEntry(this.state).scroll);
      this.changed();
      return;
    }
    const before = currentEntry(this.state);
    if (before.key === loc.key && before.path === loc.path) {
      this.settled();
      return;
    }
    this.state = applyLocation(this.state, loc, action);
    if (action === "PUSH") this.deps.scrollTo(0);
    else if (action === "POP") this.deps.scrollTo(currentEntry(this.state).scroll);
    this.changed();
  }

  private init(loc: { key: string; path: string }): void {
    const saved = this.deps.load();
    if (saved && saved.stacks[saved.active].entries.some((e) => e.key === loc.key)) {
      // A reload: history still holds this stack.
      this.state = applyLocation(saved, loc, "POP");
      this.deps.scrollTo(currentEntry(this.state).scroll);
      this.changed();
      return;
    }
    if (saved) this.state = saved;
    void this.runRebuild(planColdStart(loc.path));
  }

  recordScroll(y: number): void {
    if (this.rebuilding || this.expectKey !== null) return;
    recordScroll(this.state, y);
  }

  flush(): void {
    this.deps.save(this.state);
  }

  activeTab(): NavTab {
    return this.state.active;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Operations (serialized: each plans from the state the last left) ----

  push(path: string, options: PushOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      const owner = tabOfPath(path);
      if (owner && owner !== this.state.active) return this.rebuildWith(planSwitch(this.state, owner, path), "tab");
      if (owner && isTabRoot(path, owner)) return this.toRoot(path);
      const current = currentEntry(this.state);
      if (path === current.path) return;
      const kind = options.transition ?? (options.replace ? "none" : "push");
      await this.navigateAndSettle(() => this.deps.navigate(path, Boolean(options.replace)), kind, path);
    });
  }

  pop({ transition = "pop" }: { transition?: NavTransition } = {}): Promise<void> {
    return this.enqueue(async () => {
      const target = popTarget(this.state);
      if (!target) return;
      if (target.kind === "back") {
        await this.navigateAndSettle(() => this.deps.go(-1), transition, target.path);
      } else {
        await this.rebuildWith({ tab: this.state.active, back: 0, paths: [target.path], scrolls: [0] }, transition);
      }
    });
  }

  // A tab-bar tap: another tab restores its stack; the active one pops to
  // its root.
  selectTab(tab: NavTab): Promise<void> {
    return this.enqueue(async () => {
      if (tab !== this.state.active) return this.rebuildWith(planSwitch(this.state, tab), "tab");
      const first = activeStack(this.state).entries[0];
      await this.toRoot(first && isTabRoot(first.path, tab) ? first.path : TAB_ROOT[tab]);
    });
  }

  // Opens `path` in `tab`, which starts over as its root plus that page (a
  // notification tap).
  open(path: string, tab: NavTab): Promise<void> {
    // A page with a tab of its own (a chat) still opens there.
    return this.enqueue(() => this.rebuildWith(planSwitch(this.state, tabOfPath(path) ?? tab, path), "tab"));
  }

  private async toRoot(rootPath: string): Promise<void> {
    const stack = activeStack(this.state);
    const first = stack.entries[0];
    if (stack.pos === 0 && first?.path === rootPath) {
      this.deps.scrollTo(0);
      return;
    }
    if (stack.pos > 0 && first?.path === rootPath && first.key !== null) {
      await this.navigateAndSettle(() => this.deps.go(-stack.pos), "pop", rootPath);
      return;
    }
    await this.rebuildWith({ tab: this.state.active, back: stack.pos, paths: [rootPath], scrolls: [0] }, "pop");
  }

  // ---- Mechanics ----

  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async navigateAndSettle(go: () => void, kind: NavTransition, target: string): Promise<void> {
    const settled = this.waitSettled();
    await this.deps.transition(go, kind, target);
    await settled;
  }

  private async rebuildWith(plan: RebuildPlan, kind: NavTransition): Promise<void> {
    const settled = this.waitSettled();
    await this.deps.transition(() => this.runRebuild(plan), kind, plan.paths[plan.paths.length - 1] ?? "/");
    await settled;
  }

  // Back to the stack's first entry, then history rewritten as `plan.paths`.
  private async runRebuild(plan: RebuildPlan): Promise<void> {
    this.rebuilding = true;
    try {
      const index = this.deps.historyIndex();
      const back = index === null ? plan.back : Math.min(plan.back, index);
      if (back > 0) {
        const popped = this.deps.nextPop();
        this.deps.go(-back);
        await popped;
      }
      const keys = plan.paths.map((path, i) => {
        this.deps.navigate(path, i === 0);
        return this.deps.historyKey();
      });
      this.state = completeRebuild(this.state, plan, keys);
      this.expect(keys[keys.length - 1] ?? null);
    } finally {
      this.rebuilding = false;
    }
    this.deps.save(this.state);
    this.emit();
  }

  private expect(key: string | null): void {
    this.clearExpect();
    if (key === null) return;
    this.expectKey = key;
    // The commit should follow at once; don't let a lost one wedge the model.
    this.expectTimer = setTimeout(() => {
      this.expectKey = null;
      this.settled();
    }, SETTLE_TIMEOUT_MS);
  }

  private clearExpect(): void {
    if (this.expectTimer !== undefined) clearTimeout(this.expectTimer);
    this.expectTimer = undefined;
    this.expectKey = null;
  }

  private waitSettled(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.settleWaiters.push(done);
    });
  }

  private settled(): void {
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    for (const done of waiters) done();
  }

  private changed(): void {
    this.deps.save(this.state);
    this.emit();
    this.settled();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

// ---- The shared instance ----

type NavWindow = Window & { __congressNav?: NavEngineApi };

export function publishNavEngine(engine: NavEngineApi): void {
  (window as NavWindow).__congressNav = engine;
}

export function getNavEngine(): NavEngineApi | undefined {
  return typeof window === "undefined" ? undefined : (window as NavWindow).__congressNav;
}
