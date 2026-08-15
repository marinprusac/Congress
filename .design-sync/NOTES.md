# Design-sync notes for @congress/exhibit-ui

## Repo-specific setup

- **Package shape**: `packages/exhibit-ui` has no `dist/` and no build script — it's a source-only workspace package consumed directly by every Chamber's own Vite build. Converter runs in **synth-entry mode** (no `--entry` flag). Confirmed with the user before proceeding.
- **`--node-modules` anchor**: `@congress/exhibit-ui` doesn't self-resolve inside its own `node_modules` (it isn't its own dependency). Every converter/resync command must point `--node-modules` at a *consuming* package's node_modules instead — `services/capitol/node_modules` is used throughout (it has the workspace symlink to `packages/exhibit-ui`, plus `react`/`react-dom`/`react-router-dom`/`@tanstack/react-query`/`@types/react` all resolvable there).
- **`extraEntries` path depth**: because `PKG_DIR` resolves as `<node-modules>/@congress/exhibit-ui` (not real-pathed through the workspace symlink), the `extraEntries` path to `.design-sync/preview-support.tsx` needs 5 `../` segments from that anchor: `"../../../../../.design-sync/preview-support.tsx"`. This is stable as long as `--node-modules` continues to point at a `services/<name>/node_modules` directory (same nesting depth for every Chamber) — if you ever anchor from somewhere else, recompute with `python3 -c "import os; print(os.path.relpath('<repo>/.design-sync/preview-support.tsx', '<node-modules>/@congress/exhibit-ui'))"`.
- **CSS entry is NOT `src/styles.css` directly** — that file is a Tailwind v4 *source* (`@import "tailwindcss"`, `@theme`, `@fontsource/*` imports), meant to be compiled by a consumer's build, not copied raw. `cssEntry` points at `.design-sync-compiled/styles.css` instead — see below.

## Compiled CSS: how it's generated and how to regenerate it

`cfg.cssEntry` must resolve **inside the package root** (`packages/exhibit-ui/`), unlike `extraEntries` which is only bounded to the workspace root — so the compiled stylesheet lives inside the package itself, at `packages/exhibit-ui/.design-sync-compiled/` (styles.css + fonts/). This directory is design-sync tooling output, not part of the real npm package's API — it's committed for reproducibility but is clearly dot-prefixed and self-contained.

**To regenerate before a re-sync** (needed if `packages/exhibit-ui/src/styles.css` or any component's Tailwind class usage changed):

```bash
pnpm --filter chamber-notes build:web
CSS_FILE=$(ls services/chamber-notes/frontend/dist/assets/index-*.css)
rm -rf packages/exhibit-ui/.design-sync-compiled
mkdir -p packages/exhibit-ui/.design-sync-compiled/fonts
cp "$CSS_FILE" packages/exhibit-ui/.design-sync-compiled/styles.css
grep -o 'url(/notes/assets/[^)]*)' packages/exhibit-ui/.design-sync-compiled/styles.css \
  | sed 's#url(/notes/assets/##;s/)//' | sort -u \
  | while read -r f; do cp "services/chamber-notes/frontend/dist/assets/$f" "packages/exhibit-ui/.design-sync-compiled/fonts/$f"; done
sed -i 's#url(/notes/assets/#url(./fonts/#g' packages/exhibit-ui/.design-sync-compiled/styles.css
```

Why chamber-notes specifically: any consuming service works, because `packages/exhibit-ui/src/styles.css` has `@source "./"`, which makes Tailwind scan **exhibit-ui's own source** for utility classes regardless of which service compiles it — so the output always contains exhibit-ui's full utility-class surface, plus some harmless extra classes from whichever service's own pages you happened to build. chamber-notes was picked because it renders the widest variety of exhibit-ui components across its own pages (NoteViewPage in particular touches ExhibitSharingBadge, ShareControl, ExhibitPickerDropdown, ExhibitLinksLayout, GlobalExhibitSearch), so it needs the fewest one-off class additions.

**Known limitation — this is a static snapshot, not live**: `preview-rebuild.mjs` (used for per-component authoring iteration) does NOT regenerate this compiled CSS — it only re-runs esbuild/emit against the existing `.design-sync-compiled/styles.css`. If an authored preview's `.tsx` uses a Tailwind utility class that wasn't present in chamber-notes' build at the time the CSS was last compiled, that class is silently absent from the shipped stylesheet — the element renders unstyled/unsized with no error. **Always grep the compiled CSS before using a new utility class**: `grep -o '\.<class>{[^}]*}' packages/exhibit-ui/.design-sync-compiled/styles.css`. In practice, sticking to classes already used in the real app's own `.tsx` files (which is what every preview should be doing anyway, per "port real usage, don't invent") avoids this entirely.

## Provider setup

`.design-sync/preview-support.tsx` (extraEntries-merged into the bundle, exported as `PreviewProviders`) does two things every exhibit-ui component preview needs:
1. Wraps children in `QueryClientProvider` (most components use `useQuery`/`useExhibitSearch` etc.) + `MemoryRouter` (`ChamberLayout`/`ChamberPicker` use `Link`/`useLocation`/`useNavigate`).
2. Installs a `window.fetch` mock (module-load side effect, guarded by `window.__dsFetchMocked`) that intercepts every `/capitol/*` endpoint these components call and returns realistic canned JSON matching `@congress/shared-types` response shapes — registry (4 chambers), exhibit search/resolve, sharing/shares, backlinks/frontlinks, settings. Without this, every data-fetching component would render perpetually empty/loading in an isolated preview (no real Congress backend to hit). See the file for the exact canned data (e.g. share token `8b6b7e2a-...`, exhibit ids `note-9`/`task-1`/`note-99`(deleted)/`document-4`(unavailable) — authored previews reference these same ids so resolved/deleted/unavailable states all show correctly).

## Known render warns / resolved quirks

- **`ChamberPicker`**: renders two `position: fixed` `<nav>` elements (desktop sidebar, mobile bottom bar) — fixed positioning escapes a normal grid cell (collapses to a ~85px sliver). Fixed via `cfg.overrides.ChamberPicker: {"cardMode": "single", "primaryStory": "InNotes", "viewport": "1280x800"}`.
- **`ExhibitPickerDropdown`**: needs its backing `useExhibitPicker` hook's dropdown-open state to be true, which depends on the textarea's cursor sitting after a `[[` trigger. `autoFocus` alone does NOT move the caret to the end of a pre-filled value (browsers leave `selectionStart` at 0) — the hook's open-detection effect then sees an empty prefix and never opens. Fixed in the preview with a merged ref callback that calls `el.focus(); el.setSelectionRange(content.length, content.length)` before handing off to the hook's own `fieldProps.ref`, so the caret is correct before the hook's effect reads it.
- **Icon sizing (`CapitolMark`/`ChamberMark`)**: stick to `h-8 w-8` (the actual size used everywhere in the real app) — other Tailwind size classes may not exist in the compiled CSS snapshot (see "Known limitation" above).

## Component scope

15 files export from `packages/exhibit-ui/src/index.tsx`'s public API surface; the converter (synth-entry mode, discovers from actual exports) found **14 components** — `CopyLinkButton` and `ShareFieldsEditor` are real components in the source tree but are **not re-exported from the package's public barrel** (`index.tsx`), so they're correctly excluded — a design consuming `@congress/exhibit-ui` could never import them. `ChamberMarks.tsx` contributes 2 separate components (`CapitolMark`, `ChamberMark`) since both are individually exported.

## Re-sync risks

- The compiled CSS (`packages/exhibit-ui/.design-sync-compiled/`) is committed but **goes stale** the moment `packages/exhibit-ui/src/styles.css` changes (new tokens/fonts) or any component starts using a Tailwind class not yet in the snapshot — regenerate per the recipe above before re-running the converter if exhibit-ui's styling changed since the last sync.
- `extraEntries`'s 5-level-up relative path assumes `--node-modules` is always a `services/<name>/node_modules` directory. If a future re-sync anchors from somewhere else (a different nesting depth), that path breaks silently (`! extraEntries: ... not found — skipped`) and previews needing `PreviewProviders` will fail with a provider error — recompute the path per the note above.
- The mock fetch data in `preview-support.tsx` is hand-written to match `@congress/shared-types` schemas as of this sync — if those shared types change shape (new required fields, renamed fields), the mocks won't be updated automatically and previews may render with `undefined` values in unexpected places. No runtime validation catches this — it would show up as a visual regression on next re-sync's render check.
- All 14 components are authored (not floor cards) as of this sync — a future re-sync only needs to re-author if source props/behavior changed enough to invalidate a grade (grades follow source hashes automatically).
