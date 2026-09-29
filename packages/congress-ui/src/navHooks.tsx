import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useNavigationType, type NavigateFunction, type To } from "react-router-dom";
import { useShellHosted } from "./ShellHostContext.js";
import { isPlainClick, runNavigation } from "./motion.js";
import { getNavEngine, NavEngine, publishNavEngine, SETTLE_TIMEOUT_MS, type NavDeps, type NavTransition, type PushOptions } from "./navEngine.js";
import { parseNavState, type NavState, type NavTab } from "./navStack.js";

// Stack navigation for every page, shell and Chamber alike: push to drill
// in, pop to go back to where the owner came from. Shell-hosted, these go
// through the shell's one NavEngine; standalone (a Chamber's own dev
// server) they fall back to plain router navigation.

function toPath(to: To): string {
  if (typeof to === "string") return to;
  return `${to.pathname ?? ""}${to.search ?? ""}${to.hash ?? ""}`;
}

export interface StackNav {
  push(to: To, options?: PushOptions): void;
  pop(options?: { transition?: NavTransition }): void;
}

export function useStackNav(): StackNav {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  return useMemo(
    () => ({
      push(to, options = {}) {
        const engine = getNavEngine();
        if (engine) void engine.push(toPath(to), options);
        else navigate(to, { replace: options.replace });
      },
      pop(options) {
        const engine = getNavEngine();
        if (engine) {
          void engine.pop(options);
          return;
        }
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else if (shellHosted) navigate("/");
        // Standalone, "home" is Congress's root, outside this Chamber's router.
        else window.location.assign("/");
      },
    }),
    [navigate, shellHosted]
  );
}

type StackLinkProps = ComponentProps<typeof Link> & { transition?: NavTransition };

// A <Link> that pushes onto the stack (or replaces its top with `replace`).
// Modifier clicks keep the browser's own behavior.
export const StackLink = forwardRef<HTMLAnchorElement, StackLinkProps>(function StackLink({ transition, onClick, to, replace, ...rest }, ref) {
  const nav = useStackNav();
  return (
    <Link
      ref={ref}
      to={to}
      replace={replace}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (!isPlainClick(e) || rest.target) return;
        e.preventDefault();
        nav.push(to, { replace, transition });
      }}
      {...rest}
    />
  );
});

// ---- The shell's engine ----

const STORAGE_KEY = "congress:nav";

let shellEngine: NavEngine | null = null;
// Bumped by any new scroll restore or by the owner touching the page, which
// cancels a restore still retrying.
let restoreToken = 0;

function restoreScroll(y: number): void {
  const token = ++restoreToken;
  window.scrollTo(0, y);
  if (y <= 0) return;
  // The page may still be growing into its height (cached data rendering).
  let frames = 0;
  const tick = () => {
    if (token !== restoreToken || frames++ > 30 || Math.abs(window.scrollY - y) < 2) return;
    window.scrollTo(0, y);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function browserDeps(navigateRef: { current: NavigateFunction }): NavDeps {
  const historyState = () => window.history.state as { key?: unknown; idx?: unknown } | null;
  return {
    navigate: (path, replace) => void navigateRef.current(path, { replace }),
    go: (delta) => void navigateRef.current(delta),
    historyKey: () => {
      const key = historyState()?.key;
      return typeof key === "string" ? key : null;
    },
    historyIndex: () => {
      const idx = historyState()?.idx;
      return typeof idx === "number" ? idx : null;
    },
    // Registered after the router's own listener, so it runs once the router
    // has taken the pop in.
    nextPop: () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          window.removeEventListener("popstate", done);
          resolve();
        };
        const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
        window.addEventListener("popstate", done);
      }),
    transition: (go, kind, target) => (kind === "none" ? Promise.resolve(go()).then(() => undefined) : runNavigation(go, kind, target)),
    load: () => {
      try {
        return parseNavState(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null"));
      } catch {
        return null;
      }
    },
    save: (state: NavState) => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Private mode or full storage: the stacks just won't survive a reload.
      }
    },
    scrollTo: restoreScroll,
  };
}

// Mounted once inside the shell's Router. Keeps the engine in step with
// every committed location - including plain <Link>s and navigate() calls
// that don't go through it - and records scroll positions.
export function StackNavigator() {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  if (!shellEngine) {
    shellEngine = new NavEngine(browserDeps(navigateRef));
    publishNavEngine(shellEngine);
  }
  const engine = shellEngine;

  useLayoutEffect(() => {
    engine.onLocation({ key: location.key, path: `${location.pathname}${location.search}${location.hash}` }, action);
  }, [engine, location.key, location.pathname, location.search, location.hash, action]);

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    const onScroll = () => engine.recordScroll(window.scrollY);
    const cancelRestore = () => void restoreToken++;
    const onHide = () => engine.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") engine.flush();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", cancelRestore, { passive: true });
    window.addEventListener("wheel", cancelRestore, { passive: true });
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("wheel", cancelRestore);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [engine]);

  return null;
}

// The shell's active tab (for the tab bar), or null outside the shell.
export function useActiveNavTab(): NavTab | null {
  return useSyncExternalStore(
    (listener) => shellEngine?.subscribe(listener) ?? (() => {}),
    () => shellEngine?.activeTab() ?? null
  );
}

export function selectNavTab(tab: NavTab): void {
  void getNavEngine()?.selectTab(tab);
}

// Opens `path` in `tab` (a notification tap), or navigates the whole
// document when there's no engine yet (the login gate is up).
export function openInTab(path: string, tab: NavTab): void {
  const engine = getNavEngine();
  if (engine) void engine.open(path, tab);
  else window.location.assign(path);
}
