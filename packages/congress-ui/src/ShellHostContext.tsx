import { useEffect, useState } from "react";

// A plain global flag, deliberately not React Context: congress-ui is a
// source-only workspace package, recompiled independently into Capitol's
// own bundle *and* every Chamber's remote entry (see chamber-kit's build
// docs) - each bundle's own `createContext()` call would produce a
// *different* context object, so a <Provider> set in one bundle wouldn't be
// visible to useContext() in another even though it's "the same" source
// file (confirmed by testing: it silently read the default value). A
// window flag has no such identity problem - there's only ever one "is the
// current page shell-hosted or not" answer for the whole document anyway,
// never a per-subtree one, so it doesn't need to be reactive either.
const SHELL_FLAG = "__CONGRESS_SHELL_HOSTED__";

// Capitol's own main.tsx calls this once, before its first render (it
// always acts as the shell for every Chamber it mounts via ChamberHost -
// there's no need to call this again per-Chamber, since they run in the
// same already-flagged document). A Chamber's own standalone main.tsx never
// calls this, so useShellHosted() defaults to false there.
export function markShellHosted(): void {
  (window as unknown as Record<string, boolean>)[SHELL_FLAG] = true;
}

// The one signal ChamberPicker/ChamberHeader/navigateToExhibit need to know
// whether a top-level chamber switch can be a same-document <Link> (true:
// this is Capitol's shell, no basename in the way) or has to stay a real
// navigation via a plain <a> (false: this is a Chamber's own standalone
// boot, under its own `BrowserRouter basename="/<chamber>"` - a <Link> to
// another Chamber's absolute path would resolve *within* that basename
// instead of escaping it, e.g. "/documents" becoming "/notes/documents").
function readShellFlag(): boolean {
  return Boolean((window as unknown as Record<string, boolean>)[SHELL_FLAG]);
}

// A widget mounted directly onto Capitol's canvas (via a dynamically
// imported remote-entry.js, resolved and rendered behind its own Suspense
// boundary independently of Congress's own top-level render) can complete
// its first render in a narrow window before markShellHosted() has taken
// effect for it - confirmed by observation, not just theory: a widget's
// link can render pointing at the current page itself (the raw, unresolved
// addHref) even though the exact same flag/function correctly resolves a
// moment later for a full Chamber page reached via ChamberHost. Since the
// flag itself only ever flips false -> true, never back, a plain `useState`
// initializer plus one re-check in an effect (which always runs after the
// commit that might have raced the flag) is enough to self-correct: a
// widget that raced and lost gets exactly one extra render with the correct
// value, and one that didn't race pays for an effect that's a same-value
// no-op.
export function useShellHosted(): boolean {
  const [hosted, setHosted] = useState(readShellFlag);
  useEffect(() => {
    if (!hosted && readShellFlag()) setHosted(true);
  }, [hosted]);
  return hosted;
}

// A Chamber's own components (ChamberHeader's titleHref, ChamberPicker's
// Subnav, navigateToExhibit's same-Chamber branch) all write "this
// Chamber's own root-relative" targets like "/", "/new", "/e/1" - fine as
// literal <Link>/navigate() targets in standalone mode, where the Chamber's
// own `BrowserRouter basename="/<chamber>"` implicitly re-adds the prefix
// (and `useLocation().pathname` is equally basename-stripped, so comparing
// against the same un-prefixed string for "is this the active link" still
// lines up). Shell-hosted, there's no basename doing that, so the same
// literal string needs the chamber's own prefix added explicitly to land in
// the right place under Congress's single, basename-less Router - and
// `useLocation().pathname` there is the full unstripped path, so an active
// check needs the same prefix added to compare correctly too. "capitol" is
// an ordinary Chamber name here like any other (it used to be a special
// no-op case, back when Capitol *was* the shell itself and sat at "/" -
// since the Congress/Capitol split, Congress is the shell and Capitol is
// just the Chamber registered as "capitol", proxied at "/capitol" the same
// as every other Chamber). Only chamberName "" (no Chamber owns this page -
// Congress's own shell chrome) stays a no-op passthrough.
export function resolveChamberPath(path: string, chamberName: string, shellHosted: boolean): string {
  if (!shellHosted || !chamberName) return path;
  return path === "/" ? `/${chamberName}` : `/${chamberName}${path}`;
}
