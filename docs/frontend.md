# Frontend: shell, navigation and theming

How the PWA shell, home feed, views, stack navigation and theming fit together. Mobile-first rules live in `CLAUDE.md`.

## Home: feed, views and the shell

Congress's shell has one navigation: a tab bar — Home · Search · + · Chats · Notifications (`components/TabBar.tsx`; Settings is the gear on Home) — fixed to the bottom on a phone (it publishes `--mobile-nav-height`, which every bottom-docked element already offsets by) and a slim left rail on desktop (`--chamber-picker-width`). Views have **no navigation of their own**: a page has a back button (`ChamberLayout` → `useBackNavigation`).

- **Home** (`pages/HomePage.tsx`): the nameplate (`ChamberHeader` `variant="nameplate"`: wordmark, gear, 5px rule), the "Congress asks" strip, the owner's pinned views (a rail of labelled source squares, `settings.pinnedViews`), then the **feed**: `GET /congress/feed` (`services/congress/src/feed.ts`) gathers every source's scored candidates (the type engine's feed rules, connectors' `feed()`), merges and ranks them (`rankFeed` — the one place a smarter ranker, e.g. Haiku, can later slot in) and resolves exhibits. **Every feed item shows its information inline**: a record candidate carries a `preview` (title, ISO time the browser formats in the owner's zone, short fields, a plain-text excerpt — see `kit/feedText.ts`'s `plainTextPreview`), and only views with a feed card appear. A bare "open X" row never belongs in the feed.
- **Feed layout** (`lib/feedLayout.ts`): the first ranked record with a preview is the **lead story** (a headline; a view card never leads); records show a **kicker** (type label underlined in the type's colour, plus the reason) instead of an icon; a view card is a **figure** whose header is a caption (its label as a source-coloured chip, reason, Open). On a phone the feed is one column; from 641px it is a 12-column grid in ranker order (lead 8, records 4, view cards 6). `useFlipList` needs each item wrapper (`.feed-slot`) to stay a direct child of `.home-feed`, and the press/hover movement lives on `.feed-card`, never the wrapper.
- **Views** (`views/coreViews.ts`) are **only genuine screens** that can't be expressed as a list of records — the calendar's Timeline and Week, the Map's today map and classify queue, Health, the WhatsApp chat list. A list of records ("open tasks", "upcoming events") is never a view: those reach the feed through the type's feed rules and Search on their own. A view has a `fullPath` (its full screen), and/or `card: true` with a `Card` component rendered in Congress's own frame (`components/ViewSlot.tsx` — title, reason, open link, per-card error boundary). A source shows once its type is in use.
- **Search** (`pages/SearchPage.tsx`) lists every view as a catalog when empty, plus recent records; while typing, matching views and records. **"+"** (`components/CreateSheet.tsx`) lists every type the owner can create by hand and opens its editor. **Notifications** is the Logs inbox as a page.

## Stack navigation

Navigation is a stack of pages **per tab** (Home, Search, Chats, Notifications), with browser history always equal to the active tab's stack — so browser back, the iOS edge-swipe and every in-app back button do the same thing. The model is pure (`congress-ui`'s `navStack.ts`); `navEngine.ts` drives the router and history from it; the shell mounts `StackNavigator` once and publishes the engine on `window` (not Context, for the same reason as `useShellHosted`), so a Chamber bundle reaches the same instance.

- **Push** (`StackLink`, `useStackNav().push`) drills in on the current tab; **pop** (`useStackNav().pop`, `useBackNavigation`) goes back to the page underneath, or the tab's root when there's none. After a Delete/Cancel a page pops — it never navigates "home", which would stack a second root and leave the deleted page one back.
- Chat pages (`/chat/*`) and the four tab roots always belong to their own tab: pushing one from elsewhere switches tabs (Home's "Congress asks" → `[/chat, /chat/5]`). Anything else (a Chamber page, a view, Settings) belongs to the tab it was pushed from.
- A tab tap (`selectNavTab`) restores that tab's stack by stepping history back to the current stack's root and rewriting it as the target's; tapping the active tab pops it to its root. Stacks and scroll positions persist in `sessionStorage` across reloads.
- A cold load of a deep link (bookmark, notification tap) gets its tab's root underneath (`planColdStart`); a notification's tab rides on `?navtab=` and is stripped. With the app open, `sw.ts` posts the URL to the page instead of reloading it (`openInTab`).
- A plain `<Link>`/`navigate()` still works — `StackNavigator` reconciles every committed location — but goes without the push/pop transition, so new code uses `StackLink`/`useStackNav`. A `replace` is fine for swapping the top page (after a create, Calendar's Timeline/Week switch).

## Settings & theming

Owner-wide (not per-device) preferences use a single-row settings table — `id` always `1`, select-then-insert-or-update — via `kit/settings.ts`'s `createSingleRowSettings`. Congress's dark mode setting is applied everywhere (every feed card is a real component in the same document, not an iframe) through `useAppliedTheme`/`useCapitolSettings` in `congress-ui`, plus a pre-paint inline bootstrap script in `frontend/index.html` that applies a cached `localStorage` theme value before first render to avoid a flash of the wrong theme. The home screen's pinned views live on the same Congress settings row (`pinnedViews`, edited in Settings → Home).

## Visual language

Newsprint ground, ink, one yellow highlight, and a flat source palette. Tokens are in `packages/congress-ui/src/styles.css`:

- **Ground and paper**: `--color-parchment` is the page; `--color-paper` is the lighter stock cards, sheets and inputs sit on. Dark mode flips both (`:root[data-theme="dark"]`) and the ink becomes cream, so shadows read as cream edges.
- **Hard shadow, never blur**: `--shadow-hard` (4px), `--shadow-hard-sm` (3px), `--shadow-hard-up` for bottom-docked sheets, `--border-heavy` (2px), `--rule-heavy` (5px, under every header and above the tab bar). Pressing something moves it onto its shadow (`translate: 3px 3px; box-shadow: none`); the shared `.btn` (`shared.css`, `--primary` yellow, `--danger`) is the one button.
- **Source colours** (`--color-src-*`, plain `:root` properties because the name is built at runtime and Tailwind would drop an unused `@theme` variable): chosen by a type's `color` (see `type-engine.md`), resolved with `sourceColorStyle`/`useSourceColor`, applied as `--src`/`--on-src`.
- **Header**: every page is the slim bar (`ChamberHeader`: back square, mono eyebrow, heavy Fraunces title, actions); Home uses the nameplate. Chat has its own header with the same look.
- **Lists stay quiet**: rows are hairlines, only things you can press as an object (cards, buttons, unread notifications) carry a shadow. Dense full views (Calendar, Map, Health) get a frame and no shadow.
- No radius anywhere; the only round things are the chat spinner and the Leaflet map.
