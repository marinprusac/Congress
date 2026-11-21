# Frontend: shell, navigation and theming

How the PWA shell, home dashboard, stack navigation and theming fit together. Mobile-first rules live in `CLAUDE.md`.

## Home: dashboard and the shell

Congress's shell has one navigation: a tab bar — Home · Search · + · Chats · Settings (`components/TabBar.tsx`) — fixed to the bottom on a phone (it publishes `--mobile-nav-height`, which every bottom-docked element already offsets by) and a slim left rail on desktop (`--chamber-picker-width`). Pages have **no navigation of their own**: a page has a back button (`ChamberLayout` → `useBackNavigation`).

- **Home** (`pages/HomePage.tsx`): the nameplate (`ChamberHeader` `variant="nameplate"`: wordmark, 5px rule), the "Congress asks" strip, then the **dashboard**: `GET /congress/dashboard` (`services/congress/src/dashboard.ts`) returns the cards, top first, expired ones swept. **The dashboard is entirely the AI's**: cards are added, changed, reordered and removed only through the `dashboard_*` MCP tools (`mcp/dashboardTools.ts`: `dashboard_list/add/update/remove/reorder`); there is no automatic feed, no ranking, and no UI to add or dismiss a card. The prompt tells the AI to keep it short and current, and the proactive digest lists what is on it so a proactive run can refresh it.
- **Cards** (`shared-types/src/dashboard.ts`, `components/DashboardCard.tsx`): free-form — a kicker, a title, a colour, a size (`wide` spans 8 of 12 columns from 641px; every card is full width on a phone) and up to 12 **blocks**: `text` (Markdown, may hold `[[record:...]]` chips), `record` (a record row, resolved to its current name; a deleted record's block is hidden), `stat`, `facts`, `list`, `time` (formatted in the browser's zone). Cards may carry `expiresAt`; at most 30 exist. Stored blocks that stop parsing are skipped, not fatal. `useFlipList` needs each card wrapper (`.feed-slot`) to stay a direct child of `.home-feed`. A finished AI run invalidates the dashboard query; it also polls every minute.
- **Search** (`pages/SearchPage.tsx`) lists recent records when empty; while typing, matching records. **"+"** (`components/CreateSheet.tsx`) lists every type the owner can create by hand and opens its editor.

## Stack navigation

Navigation is a stack of pages **per tab** (Home, Search, Chats, Settings), with browser history always equal to the active tab's stack — so browser back, the iOS edge-swipe and every in-app back button do the same thing. The model is pure (`congress-ui`'s `navStack.ts`); `navEngine.ts` drives the router and history from it; the shell mounts `StackNavigator` once and publishes the engine on `window` (not Context, for the same reason as `useShellHosted`), so a Chamber bundle reaches the same instance.

- **Push** (`StackLink`, `useStackNav().push`) drills in on the current tab; **pop** (`useStackNav().pop`, `useBackNavigation`) goes back to the page underneath, or the tab's root when there's none. After a Delete/Cancel a page pops — it never navigates "home", which would stack a second root and leave the deleted page one back.
- Chat pages (`/chat/*`) and the four tab roots always belong to their own tab: pushing one from elsewhere switches tabs (Home's "Congress asks" → `[/chat, /chat/5]`). Anything else (a record page, Settings) belongs to the tab it was pushed from.
- A tab tap (`selectNavTab`) restores that tab's stack by stepping history back to the current stack's root and rewriting it as the target's; tapping the active tab pops it to its root. Stacks and scroll positions persist in `sessionStorage` across reloads.
- A cold load of a deep link (bookmark, notification tap) gets its tab's root underneath (`planColdStart`); a notification's tab rides on `?navtab=` and is stripped. With the app open, `sw.ts` posts the URL to the page instead of reloading it (`openInTab`).
- A plain `<Link>`/`navigate()` still works — `StackNavigator` reconciles every committed location — but goes without the push/pop transition, so new code uses `StackLink`/`useStackNav`. A `replace` is fine for swapping the top page (after a create).

## Settings & theming

Owner-wide (not per-device) preferences use a single-row settings table — `id` always `1`, select-then-insert-or-update — via `kit/settings.ts`'s `createSingleRowSettings`. Congress's dark mode setting is applied everywhere (every dashboard card is a real component in the same document, not an iframe) through `useAppliedTheme`/`useCapitolSettings` in `congress-ui`, plus a pre-paint inline bootstrap script in `frontend/index.html` that applies a cached `localStorage` theme value before first render to avoid a flash of the wrong theme.

## Visual language

Newsprint ground, ink, one yellow highlight, and a flat source palette. Tokens are in `packages/congress-ui/src/styles.css`:

- **Ground and paper**: `--color-parchment` is the page; `--color-paper` is the lighter stock cards, sheets and inputs sit on. Dark mode flips both (`:root[data-theme="dark"]`) and the ink becomes cream, so shadows read as cream edges.
- **Hard shadow, never blur**: `--shadow-hard` (4px), `--shadow-hard-sm` (3px), `--shadow-hard-up` for bottom-docked sheets, `--border-heavy` (2px), `--rule-heavy` (5px, under every header and above the tab bar). Pressing something moves it onto its shadow (`translate: 3px 3px; box-shadow: none`); the shared `.btn` (`shared.css`, `--primary` yellow, `--danger`) is the one button.
- **Source colours** (`--color-src-*`, plain `:root` properties because the name is built at runtime and Tailwind would drop an unused `@theme` variable): chosen by a type's `color` (see `type-engine.md`), resolved with `sourceColorStyle`/`useSourceColor`, applied as `--src`/`--on-src`.
- **Header**: every page is the slim bar (`ChamberHeader`: back square, mono eyebrow, heavy Fraunces title, actions); Home uses the nameplate. Chat has its own header with the same look.
- **Lists stay quiet**: rows are hairlines, only things you can press as an object (cards, buttons, unread notifications) carry a shadow. Dense full pages get a frame and no shadow.
- No radius anywhere; the only round things are the chat spinner and the Leaflet map.
