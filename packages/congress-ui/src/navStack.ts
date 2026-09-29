// The shell's navigation model: one stack of pages per tab, and browser
// history always equal to the active tab's stack (so browser back, the iOS
// edge-swipe and every in-app back button agree). Pure state transitions
// only - navEngine.ts drives the router and history from them.

export type NavTab = "home" | "search" | "chats" | "notifications";

export const NAV_TABS: readonly NavTab[] = ["home", "search", "chats", "notifications"];

export const TAB_ROOT: Record<NavTab, string> = {
  home: "/",
  search: "/search",
  chats: "/chat",
  notifications: "/notifications",
};

// Query parameter a cold link (a push-notification tap opening a fresh
// window) uses to say which tab it belongs to. Stripped on arrival.
export const NAV_TAB_PARAM = "navtab";

export interface NavEntry {
  // The router's location key for this entry while it's live in browser
  // history; null once it no longer is (a tab switched away from).
  key: string | null;
  path: string;
  scroll: number;
}

export interface NavStack {
  entries: NavEntry[];
  // The current entry. Entries after it are browser-forward entries.
  pos: number;
}

export interface NavState {
  active: NavTab;
  stacks: Record<NavTab, NavStack>;
}

export type NavAction = "PUSH" | "REPLACE" | "POP";

export function pathnameOf(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

function isNavTab(value: unknown): value is NavTab {
  return typeof value === "string" && (NAV_TABS as readonly string[]).includes(value);
}

// The tab a path always belongs to, whichever tab it was opened from. Any
// other page (a Chamber page, a view, Settings) belongs to the tab it was
// pushed onto.
export function tabOfPath(path: string): NavTab | null {
  const pathname = pathnameOf(path);
  if (pathname === "/") return "home";
  if (pathname === "/search") return "search";
  if (pathname === "/notifications") return "notifications";
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "chats";
  return null;
}

export function isTabRoot(path: string, tab: NavTab): boolean {
  return pathnameOf(path) === TAB_ROOT[tab];
}

function rootStack(tab: NavTab): NavStack {
  return { entries: [{ key: null, path: TAB_ROOT[tab], scroll: 0 }], pos: 0 };
}

export function initialNavState(): NavState {
  return {
    active: "home",
    stacks: { home: rootStack("home"), search: rootStack("search"), chats: rootStack("chats"), notifications: rootStack("notifications") },
  };
}

export function activeStack(state: NavState): NavStack {
  return state.stacks[state.active];
}

export function currentEntry(state: NavState): NavEntry {
  const stack = activeStack(state);
  return stack.entries[stack.pos] ?? { key: null, path: TAB_ROOT[state.active], scroll: 0 };
}

function withStack(state: NavState, tab: NavTab, stack: NavStack): NavState {
  return { ...state, stacks: { ...state.stacks, [tab]: stack } };
}

// A tab left behind keeps its pages (up to where it was) but not their
// history entries - those get overwritten by the next tab's.
function detached(stack: NavStack): NavStack {
  return { entries: stack.entries.slice(0, stack.pos + 1).map((e) => ({ ...e, key: null })), pos: stack.pos };
}

// Brings the model in line with a location the router just committed.
export function applyLocation(state: NavState, loc: { key: string; path: string }, action: NavAction): NavState {
  const stack = activeStack(state);
  const found = stack.entries.findIndex((e) => e.key === loc.key);
  if (found !== -1) {
    // Already known (a repeat notification of the same commit, or back /
    // forward onto an entry this stack holds).
    if (found === stack.pos && stack.entries[found]?.path === loc.path) return state;
    const entries = stack.entries.map((e, i) => (i === found ? { ...e, path: loc.path } : e));
    return withStack(state, state.active, { entries, pos: found });
  }
  if (action === "PUSH") {
    const entries = [...stack.entries.slice(0, stack.pos + 1), { key: loc.key, path: loc.path, scroll: 0 }];
    return withStack(state, state.active, { entries, pos: entries.length - 1 });
  }
  if (action === "REPLACE") {
    const entries = stack.entries.map((e, i) => (i === stack.pos ? { key: loc.key, path: loc.path, scroll: e.scroll } : e));
    return withStack(state, state.active, { entries, pos: stack.pos });
  }
  // Back/forward onto an entry this model doesn't know (history from before
  // this document, or a stack that drifted): adopt it as a fresh stack.
  const owner = tabOfPath(loc.path) ?? state.active;
  const adopted: NavStack = { entries: [{ key: loc.key, path: loc.path, scroll: 0 }], pos: 0 };
  const base = owner === state.active ? state : withStack(state, state.active, detached(stack));
  return { ...withStack(base, owner, adopted), active: owner };
}

export interface RebuildPlan {
  tab: NavTab;
  // History steps back to the active stack's first entry (0 when already there).
  back: number;
  // The first replaces that entry; each later one is pushed.
  paths: string[];
  scrolls: number[];
}

// Switching to `tab`: back to the current stack's root entry, then rebuild
// history as the target tab's stack. With `open`, the target tab starts
// over as its root plus that page.
export function planSwitch(state: NavState, tab: NavTab, open?: string): RebuildPlan {
  const back = activeStack(state).pos;
  if (open !== undefined) {
    const paths = isTabRoot(open, tab) ? [open] : [TAB_ROOT[tab], open];
    return { tab, back, paths, scrolls: paths.map(() => 0) };
  }
  const target = state.stacks[tab];
  const entries = target.entries.slice(0, target.pos + 1);
  if (entries.length === 0) return { tab, back, paths: [TAB_ROOT[tab]], scrolls: [0] };
  return { tab, back, paths: entries.map((e) => e.path), scrolls: entries.map((e) => e.scroll) };
}

export function completeRebuild(state: NavState, plan: RebuildPlan, keys: (string | null)[]): NavState {
  const entries = plan.paths.map((path, i) => ({ key: keys[i] ?? null, path, scroll: plan.scrolls[i] ?? 0 }));
  const base = plan.tab === state.active ? state : withStack(state, state.active, detached(activeStack(state)));
  return { ...withStack(base, plan.tab, { entries, pos: entries.length - 1 }), active: plan.tab };
}

// A document loaded straight onto `path` (a bookmark, a reload that lost its
// state, a notification tap): give it the tab it belongs to and a root
// underneath, so back leads somewhere in the app.
export function planColdStart(path: string): RebuildPlan {
  const [pathname, rest = ""] = splitQuery(path);
  const params = new URLSearchParams(rest.split("#")[0]);
  const hint = params.get(NAV_TAB_PARAM);
  params.delete(NAV_TAB_PARAM);
  const hash = rest.includes("#") ? rest.slice(rest.indexOf("#")) : "";
  const query = params.toString();
  const clean = `${pathname}${query ? `?${query}` : ""}${hash}`;
  const tab = tabOfPath(clean) ?? (isNavTab(hint) ? hint : "home");
  const paths = isTabRoot(clean, tab) ? [clean] : [TAB_ROOT[tab], clean];
  return { tab, back: 0, paths, scrolls: paths.map(() => 0) };
}

function splitQuery(path: string): [string, string?] {
  const i = path.search(/[?#]/);
  if (i === -1) return [path];
  return [path.slice(0, i), path[i] === "?" ? path.slice(i + 1) : path.slice(i)];
}

// Where pop() goes from the current entry: the entry below it, or - with
// nothing below - the tab's root, unless already there.
export function popTarget(state: NavState): { kind: "back"; path: string } | { kind: "root"; path: string } | null {
  const stack = activeStack(state);
  const below = stack.entries[stack.pos - 1];
  if (below) return { kind: "back", path: below.path };
  const root = TAB_ROOT[state.active];
  return isTabRoot(currentEntry(state).path, state.active) ? null : { kind: "root", path: root };
}

export function recordScroll(state: NavState, y: number): NavState {
  const stack = activeStack(state);
  const entry = stack.entries[stack.pos];
  if (!entry || entry.scroll === y) return state;
  // Mutated in place: this runs on every scroll frame and never needs to
  // re-render anything.
  entry.scroll = y;
  return state;
}

// Rehydrates a saved state, or null if it's not one.
export function parseNavState(raw: unknown): NavState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<NavState>;
  if (!isNavTab(value.active) || !value.stacks || typeof value.stacks !== "object") return null;
  const stacks = {} as Record<NavTab, NavStack>;
  for (const tab of NAV_TABS) {
    const stack = (value.stacks as Partial<Record<NavTab, NavStack>>)[tab];
    if (!stack || !Array.isArray(stack.entries) || stack.entries.length === 0 || typeof stack.pos !== "number") return null;
    const entries = stack.entries.map((e) => ({
      key: typeof e?.key === "string" ? e.key : null,
      path: typeof e?.path === "string" ? e.path : TAB_ROOT[tab],
      scroll: typeof e?.scroll === "number" ? e.scroll : 0,
    }));
    stacks[tab] = { entries, pos: Math.min(Math.max(0, Math.floor(stack.pos)), entries.length - 1) };
  }
  return { active: value.active, stacks };
}
