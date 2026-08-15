// A plain global flag, deliberately not React Context: exhibit-ui is a
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
export function useShellHosted(): boolean {
  return Boolean((window as unknown as Record<string, boolean>)[SHELL_FLAG]);
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
// the right place under Capitol's single, basename-less Router - and
// `useLocation().pathname` there is the full unstripped path, so an active
// check needs the same prefix added to compare correctly too. Capitol
// itself never has a basename in either mode, so its own root-style targets
// ("/shares", "/settings") are already correct as-is - chamberName "" or
// "capitol" is a no-op passthrough.
export function resolveChamberPath(path: string, chamberName: string, shellHosted: boolean): string {
  if (!shellHosted || !chamberName || chamberName === "capitol") return path;
  return path === "/" ? `/${chamberName}` : `/${chamberName}${path}`;
}
