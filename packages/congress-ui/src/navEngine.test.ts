import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavEngine, type NavDeps } from "./navEngine.js";
import { applyLocation, initialNavState, parseNavState, planColdStart, planSwitch, popTarget, tabOfPath, type NavAction, type NavState } from "./navStack.js";

// A browser history plus a router that commits asynchronously and batches
// (only the last location of a tick renders), the way React Router does.
class FakeBrowser {
  entries: { key: string; path: string }[] = [];
  index = 0;
  private nextKey = 0;
  private popListeners: (() => void)[] = [];
  private pendingAction: NavAction | null = null;
  engine!: NavEngine;
  scrolls: number[] = [];
  saved: NavState | null = null;

  constructor(path: string, key = "default") {
    this.entries = [{ key, path }];
  }

  get location() {
    return this.entries[this.index]!;
  }

  // History up to the current entry (forward entries may linger, as in a
  // real browser, until the next push).
  get paths() {
    return this.entries.slice(0, this.index + 1).map((e) => e.path);
  }

  private commit(action: NavAction) {
    this.pendingAction = this.pendingAction === null ? action : action;
    setTimeout(() => {
      if (this.pendingAction === null) return;
      const a = this.pendingAction;
      this.pendingAction = null;
      this.engine.onLocation({ ...this.location }, a);
    }, 0);
  }

  navigate(path: string, replace: boolean) {
    const entry = { key: `k${this.nextKey++}`, path };
    if (replace) this.entries[this.index] = entry;
    else {
      this.entries = [...this.entries.slice(0, this.index + 1), entry];
      this.index++;
    }
    this.commit(replace ? "REPLACE" : "PUSH");
  }

  // Browser back/forward, whoever asked for it.
  go(delta: number) {
    setTimeout(() => {
      this.index = Math.min(Math.max(0, this.index + delta), this.entries.length - 1);
      this.commit("POP");
      const listeners = this.popListeners;
      this.popListeners = [];
      for (const l of listeners) l();
    }, 0);
  }

  deps(): NavDeps {
    return {
      navigate: (path, replace) => this.navigate(path, replace),
      go: (delta) => this.go(delta),
      historyKey: () => this.location.key,
      historyIndex: () => this.index,
      nextPop: () => new Promise<void>((resolve) => this.popListeners.push(resolve)),
      transition: async (go) => {
        await go();
      },
      load: () => this.saved,
      save: (state) => {
        this.saved = JSON.parse(JSON.stringify(state)) as NavState;
      },
      scrollTo: (y) => this.scrolls.push(y),
    };
  }

  start() {
    this.engine = new NavEngine(this.deps());
    this.engine.onLocation({ ...this.location }, "POP");
    return this.engine;
  }
}

async function settle() {
  await vi.advanceTimersByTimeAsync(5);
}

// Lets an engine operation's history steps and commits play out.
async function run(op: Promise<void>) {
  await vi.advanceTimersByTimeAsync(20);
  await op;
}

describe("navStack", () => {
  it("assigns fixed pages to their tab", () => {
    expect(tabOfPath("/")).toBe("home");
    expect(tabOfPath("/search?q=x")).toBe("search");
    expect(tabOfPath("/chat")).toBe("chats");
    expect(tabOfPath("/chat/12")).toBe("chats");
    expect(tabOfPath("/chatter")).toBeNull();
    expect(tabOfPath("/notes/n/1")).toBeNull();
    expect(tabOfPath("/settings?from=home")).toBeNull();
  });

  it("gives a cold deep link a root underneath and strips the tab hint", () => {
    expect(planColdStart("/notes/n/1").paths).toEqual(["/", "/notes/n/1"]);
    expect(planColdStart("/chat/4")).toMatchObject({ tab: "chats", paths: ["/chat", "/chat/4"] });
    expect(planColdStart("/search?q=a")).toMatchObject({ tab: "search", paths: ["/search?q=a"] });
    expect(planColdStart("/tasks/t/2?navtab=notifications&x=1#h")).toMatchObject({ tab: "notifications", paths: ["/notifications", "/tasks/t/2?x=1#h"] });
    expect(planColdStart("/tasks/t/2?navtab=bogus")).toMatchObject({ tab: "home", paths: ["/", "/tasks/t/2"] });
  });

  it("truncates forward entries on push and keeps them on back", () => {
    let s = initialNavState();
    s = applyLocation(s, { key: "a", path: "/" }, "REPLACE");
    s = applyLocation(s, { key: "b", path: "/x" }, "PUSH");
    s = applyLocation(s, { key: "c", path: "/y" }, "PUSH");
    s = applyLocation(s, { key: "b", path: "/x" }, "POP");
    expect(s.stacks.home.pos).toBe(1);
    expect(s.stacks.home.entries).toHaveLength(3);
    s = applyLocation(s, { key: "d", path: "/z" }, "PUSH");
    expect(s.stacks.home.entries.map((e) => e.path)).toEqual(["/", "/x", "/z"]);
  });

  it("adopts an unknown back target as its own stack", () => {
    let s = initialNavState();
    s = applyLocation(s, { key: "a", path: "/" }, "REPLACE");
    s = applyLocation(s, { key: "zz", path: "/chat/3" }, "POP");
    expect(s.active).toBe("chats");
    expect(s.stacks.chats.entries).toEqual([{ key: "zz", path: "/chat/3", scroll: 0 }]);
    expect(s.stacks.home.entries[0]?.key).toBeNull();
  });

  it("pops to the tab root when nothing is underneath", () => {
    let s = initialNavState();
    s = applyLocation(s, { key: "a", path: "/notes/n/1" }, "REPLACE");
    expect(popTarget(s)).toEqual({ kind: "root", path: "/" });
    s = applyLocation(s, { key: "b", path: "/" }, "REPLACE");
    expect(popTarget(s)).toBeNull();
  });

  it("restores a tab up to where it was", () => {
    let s = initialNavState();
    s = { ...s, stacks: { ...s.stacks, search: { entries: [{ key: null, path: "/search", scroll: 40 }, { key: null, path: "/notes/n/1", scroll: 5 }, { key: null, path: "/fwd", scroll: 0 }], pos: 1 } } };
    expect(planSwitch(s, "search")).toMatchObject({ paths: ["/search", "/notes/n/1"], scrolls: [40, 5] });
  });

  it("rejects malformed saved state", () => {
    expect(parseNavState(null)).toBeNull();
    expect(parseNavState({ active: "nope", stacks: {} })).toBeNull();
    const good = JSON.parse(JSON.stringify(initialNavState())) as unknown;
    expect(parseNavState(good)).toEqual(initialNavState());
  });
});

describe("NavEngine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives a cold deep link a way back home", async () => {
    const b = new FakeBrowser("/notes/n/1");
    const engine = b.start();
    await settle();
    expect(b.paths).toEqual(["/", "/notes/n/1"]);
    expect(b.location.path).toBe("/notes/n/1");
    await run(engine.pop());
    expect(b.location.path).toBe("/");
    expect(engine.state.stacks.home.pos).toBe(0);
    // Nothing below the root: pop does nothing.
    await run(engine.pop());
    expect(b.index).toBe(0);
  });

  it("keeps each tab's stack and history equal to the active one", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.push("/notes/n/1"));
    await run(engine.push("/tasks/t/2"));
    expect(b.paths).toEqual(["/", "/notes/n/1", "/tasks/t/2"]);

    await run(engine.selectTab("search"));
    expect(b.paths).toEqual(["/search"]);
    expect(engine.activeTab()).toBe("search");
    await run(engine.push("/documents/d/3"));
    expect(b.paths).toEqual(["/search", "/documents/d/3"]);

    await run(engine.selectTab("home"));
    expect(b.paths).toEqual(["/", "/notes/n/1", "/tasks/t/2"]);
    expect(b.location.path).toBe("/tasks/t/2");

    // Back from here walks home's own stack, never into Search.
    await run(engine.pop());
    expect(b.location.path).toBe("/notes/n/1");

    await run(engine.selectTab("search"));
    expect(b.paths).toEqual(["/search", "/documents/d/3"]);
  });

  it("pops the active tab to its root when tapped again", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.push("/a"));
    await run(engine.push("/b"));
    await run(engine.selectTab("home"));
    expect(b.location.path).toBe("/");
    expect(b.index).toBe(0);
    expect(engine.state.stacks.home.pos).toBe(0);
  });

  it("follows browser back and forward", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.push("/a"));
    await run(engine.push("/b"));
    b.go(-2);
    await settle();
    expect(engine.state.stacks.home.pos).toBe(0);
    b.go(1);
    await settle();
    expect(engine.state.stacks.home.pos).toBe(1);
    expect(b.location.path).toBe("/a");
  });

  it("opens a chat from another tab inside Chats", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.push("/settings"));
    await run(engine.push("/chat/9"));
    expect(engine.activeTab()).toBe("chats");
    expect(b.paths).toEqual(["/chat", "/chat/9"]);
    await run(engine.pop());
    expect(b.location.path).toBe("/chat");
    // Home kept its place.
    await run(engine.selectTab("home"));
    expect(b.paths).toEqual(["/", "/settings"]);
  });

  it("opens a notification in the Notifications tab", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.open("/tasks/t/1", "notifications"));
    expect(engine.activeTab()).toBe("notifications");
    expect(b.paths).toEqual(["/notifications", "/tasks/t/1"]);
  });

  it("restores scroll on the way back and starts pushed pages at the top", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    engine.recordScroll(640);
    await run(engine.push("/a"));
    expect(b.scrolls.at(-1)).toBe(0);
    engine.recordScroll(12);
    await run(engine.pop());
    expect(b.scrolls.at(-1)).toBe(640);
    await run(engine.selectTab("search"));
    engine.recordScroll(3);
    await run(engine.selectTab("home"));
    expect(b.scrolls.at(-1)).toBe(640);
  });

  it("picks the saved stack back up after a reload", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.push("/a"));
    const saved = b.saved;
    const reloaded = new FakeBrowser("/a");
    reloaded.entries = b.entries.map((e) => ({ ...e }));
    reloaded.index = b.index;
    reloaded.saved = saved;
    const again = reloaded.start();
    await settle();
    expect(reloaded.paths).toEqual(["/", "/a"]);
    expect(again.state.stacks.home.pos).toBe(1);
    await run(again.pop());
    expect(reloaded.location.path).toBe("/");
  });

  it("tracks the router's own pushes and replaces", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    b.navigate("/notes/new", false);
    await settle();
    b.navigate("/notes/n/5", true);
    await settle();
    expect(engine.state.stacks.home.entries.map((e) => e.path)).toEqual(["/", "/notes/n/5"]);
    await run(engine.pop());
    expect(b.location.path).toBe("/");
  });

  it("serializes fast taps", async () => {
    const b = new FakeBrowser("/");
    const engine = b.start();
    await settle();
    await run(engine.push("/a"));
    void engine.selectTab("search");
    void engine.selectTab("chats");
    const last = engine.selectTab("home");
    await vi.advanceTimersByTimeAsync(50);
    await last;
    expect(b.paths).toEqual(["/", "/a"]);
    expect(engine.activeTab()).toBe("home");
  });
});
