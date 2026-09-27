# Creating a Chamber

This is the practical guide to building your own Chamber — a new module
(own folder and package, own SQLite file, own `.env`, own frontend build, own
MCP tools) that Congress loads into its own process. For the *why* behind
Exhibits and the rest of the design intent, read
`docs/congress-project-brief.md` first — but note that the brief's
"every Chamber is a separate process" is no longer true: Chambers are
modules inside Congress now (see CLAUDE.md, "The Chamber contract").

If you just want to start: skip to [Quickstart](#quickstart).

## 1. What a Chamber is

Every Chamber's `src/module.ts` default-exports a `defineChamber({...})`:

- `manifest` — self-description (name, routes, views, exhibitTypes, events).
- `app` — a Hono app with your REST API under `/api/*`: exhibit editor
  routes, `GET /api/feed` (what of yours belongs on the home feed, §5.1), the
  Exhibit search/resolve contract (§4), an optional settings API.
- `registerTools` — your MCP tools.
- `dir` and `initEnv` — your folder, and your config loader.
- `start()` / `stop()` — migrations plus any pollers/timers you run.

Congress imports every module listed in
`services/congress/src/chambers/modules.ts` and, at boot, hands each one its
own `.env`, calls `start()`, and registers its manifest. Your API is then
reachable at `/api/<name>/*` (dispatched in-process), your MCP tools at
`/mcp/<name>`, and your built frontend at `/<name>/*`. A Chamber whose config
or `start()` throws is marked `offline` and skipped — it can't take Congress
down. See §5 for what else that buys you for free.

Two packages exist specifically so you almost never write this contract by
hand:

- **`@congress/chamber-kit`** — backend factories: `defineChamber`, lazy DB
  setup, per-Chamber config, MCP tools, the Exhibit content contract,
  settings, manual references, wikilink parsing, and the calls back into
  Congress (events, exhibit sync).
- **`@congress/congress-ui`** — the shared frontend surface: page layout,
  Exhibit chips/picker/annotated text, dark mode, the Chamber icon set,
  form primitives, the view-card body.

A handful of frontend files (`Layout.tsx`, `main.tsx`, `App.tsx`,
`remote.tsx`, `src/feedRules.ts`, `frontend/src/views/*.tsx`) are
*deliberately* kept as small, per-Chamber files rather than further
abstracted — routing, copy, and what counts as urgent are genuinely
Chamber-specific. Everything that was ever
pure copy-paste boilerplate (icons, DB/env/MCP wiring, the
exhibits/settings/route-mounting pattern) has already been factored into
the two packages above.

## 2. Quickstart

```
pnpm create-chamber <name> "<Display Name>"
# e.g.
pnpm create-chamber budget "Budget"
pnpm install
```

This generates `services/chamber-budget/` — a complete, working Chamber
with a generic single-entity example ("Items": a name + a body, searchable,
cross-referenceable via `[[...]]`, with view/new/settings pages, an example
home-feed rule in `src/feedRules.ts`, and no views) and its own placeholder
icon (`frontend/public/icons/mark.svg`, ready to swap for real artwork
whenever you like — see §5). It also adds the Chamber to Congress's module
list (`services/congress/src/chambers/modules.ts` plus a workspace
dependency in `services/congress/package.json`), seeds
`services/chamber-budget/.env` from `.env.example` (untracked, like every
other Chamber's `.env`), and prints a checklist of what to edit next.

The generator validates your chosen name (lowercase kebab-case) against
every existing service's `package.json`.

Bring it up locally — there's no Chamber process to start; Congress runs it:

```
pnpm --filter chamber-budget db:generate   # the template ships no migrations yet
pnpm --filter congress dev:server          # Congress + every Chamber, one process
```

To iterate on the frontend with hot reload, `pnpm --filter chamber-budget
dev:web` runs your Chamber's Vite dev server, which proxies `/api`, `/auth`
and `/congress` to Congress on `:3000`.

## 3. What's generated vs. what you write by hand

The scaffold gives you a real, running skeleton — not a stub. What you'll
actually edit to turn "Budget" into your real domain:

| File | What to change |
|---|---|
| `src/db/schema.ts` | Replace the generic `items` table with your real columns. Keep the `<entity>Refs` table and single-row `settings` table shapes — every Chamber has both, even if settings starts empty. |
| `src/types.ts` | Replace `ItemSummary`/`CreateItemRequest`/etc. with your entity's real request/response zod schemas. |
| `src/items.ts` (rename it) | Your domain CRUD — the one genuinely hand-written backend file in any Chamber. Keep the `syncXExhibit` pattern (unions wikilink refs + manual refs, pushes to Congress) if this entity should be cross-referenceable. |
| `src/exhibits.ts` | Update `idPrefix`, `type`, `urlFor`, and the search/resolve/toContent callbacks for your real table/columns. |
| `src/mcp/tools.ts` | Your entity's MCP tools — usually a thin wrapper around the same functions the REST routes call. |
| `frontend/src/pages/*.tsx` | The actual UI. Keep using the shared primitives (see the table below) rather than hand-rolling list/form chrome. |
| `src/feedRules.ts` | What of yours belongs on Congress's home feed right now, scored with a reason and an inline preview — see §5.1. Pure, so unit-test it against a fixed `now`. |
| `src/manifest.ts`'s `exhibitTypes` | What the home screen's "+" can create here (`type`/`label`/`createPath`). |
| `src/manifest.ts`'s `views` + `frontend/src/views/` | Only if your Chamber has a *genuine screen* (a map, an agenda, charts) — see §5.1. Most Chambers have none. |
| `frontend/src/components/Layout.tsx` | Title/icon only — Chambers have no navigation of their own. |
| `frontend/public/icons/mark.svg` | Optional — swap the placeholder diamond for real artwork whenever you like. Not required for anything else to work; see §5. |

After any `db/schema.ts` change: `pnpm --filter chamber-<name> db:generate`
(drizzle-kit generates the migration; it's applied automatically on next
boot, or manually via `db:migrate`).

`chamber-kit`'s factories cover everything else — you compose them, you
don't reimplement them:

| Factory | What it gives you |
|---|---|
| `defineChamber({...})` | Your `src/module.ts` — what Congress loads (see §1). |
| `createLazyDb(() => env.DB_PATH, schema, migrationsFolder)` | better-sqlite3 + WAL + drizzle, opened on first use rather than on import, migrations wired up. |
| `defineChamberEnv(name, schema)` | Your zod-validated config, parsed from the source Congress hands `initEnv` (your own `.env`), never the shared `process.env`. Resolve relative paths against your folder (see any Chamber's `src/env.ts`). |
| `registerTools` + `mcpTextResult` | Your MCP tools; Congress mounts the transport at `/mcp/<name>` — you only write `server.registerTool(...)` calls. |
| `createTableBackedExhibits(config)` | Implements the whole Exhibit content contract (search/resolve) for a table-backed entity from a handful of callbacks. |
| `createPushExhibitSync({ chamber })` | Hands Congress an exhibit create/update/delete, in-process. |
| `createPublishEvent({ chamber })` | Publishes a domain event to Congress's relay, in-process — see §5.3. |
| `resolveExhibitsServerSide(refs)` | Resolve exhibit tokens to their current labels from your backend. |
| `createSingleRowSettings(config)` | The "id is always 1, select-then-upsert" settings pattern every Chamber uses. |
| `createManualRefs`/`createManualRefsByExhibitId` | CRUD for the "Connections" side-panel's manually-added refs, separate from wikilinks parsed out of body text. |
| `extractOutgoingExhibitRefs(text)` | Parses `[[...]]` tokens out of body text into an exhibit-id list. |
| `mountFeedRoute(app, getCandidates)`, `formatDuration`, `closeness`, `plainTextPreview` | `GET /api/feed` for Congress's home feed, plus helpers for phrasing a candidate's reason and flattening a body into its inline preview — see §5.1. |
| `actorMiddleware`, `mountExhibitSearchRoutes`, `mountSettingsRoutes`, `mountManualRefsRoutes` | One-line Hono route mounting for each of the above; `app.use("/api/*", actorMiddleware)` first, so events you publish are attributed to whoever made the request. |

And `congress-ui`'s frontend surface:

| Export | What it's for |
|---|---|
| `ChamberLayout`, `ChamberHeader`, `ChamberMark`, `getChamberIcon` | Page shell (header with a back button) + the Chamber icon system (see §5 for the fallback behavior). |
| `ChamberIndexRedirect`, `useBackNavigation` | Your index route when your Chamber has no view at its root (sends the owner home), and "back" for anything custom. |
| `useAppliedTheme` | Applies Congress's dark-mode setting; call once in `App()`. |
| `useShellHosted`, `resolveChamberPath`, `navigateToExhibit` | Tell whether you're rendered standalone or shell-hosted inside Congress, and build correct links either way — use these instead of hand-writing absolute paths. |
| `ExhibitTextarea`, `ExhibitAnnotatedText`, `ExhibitChip`, `ExhibitMarkdown` | The `[[` picker/autocomplete, rendering body text with resolved exhibit chips, and (optionally) Markdown rendering. |
| `ExhibitActionBar`, `ExhibitLinksLayout` | Detail-page chrome: edit/delete actions, undirected Connections panel. |
| `useSearchableList`, `useListRowPrefetch`, `ListSearchInput`, `ListLoadingState`, `ListErrorState`, `ListEmptyState` | Search + loading/error/empty states + hover-prefetch, for a view that genuinely needs a list. |
| `PageHeader`, `FormLabel`, `FormTextInput`, `FormErrorMessage`, `FormSubmitButton` | Generic page/form chrome. |
| `ViewCard` | Loading/error/empty body for a view's feed card — see §5.1. |
| `createQueryClient`, `resolveApiBase`, `parseJsonResponse`, `assertDeleteOk`, `confirmDelete` | Per-Chamber isolated TanStack Query client, your API base (`/api/<name>`), fetch helpers. |

## 4. The Exhibit contract (cross-Chamber search & linking)

If your Chamber's content is worth referencing from notes, other Chambers,
or Congress's Search, wire `createTableBackedExhibits` (§3) — the
generated scaffold already does this for the generic "Items" entity, so in
most cases you're just updating the callbacks to match your real schema,
not writing this from scratch. Every create/update/delete should call
`pushExhibitSync` so Congress's `exhibit_cache`/`exhibit_refs` stay current;
the undirected Connections panel is computed live from that graph, nothing
is duplicated.

If your Chamber's content genuinely isn't table-backed (Calendar's
exhibits are Google Calendar events, not a local table — see
`services/chamber-calendar/src/exhibits.ts`), implement the same two
endpoints (`GET /api/exhibits/search`, `POST /api/exhibits/resolve`) by
hand instead of using the factory.

## 5. Plugging into Congress

Once your module is in Congress's module list (the generator does this), the
rest is automatic: `/api/<name>/*` dispatch, `/mcp/<name>`, serving your
built frontend at `/<name>/*`, the chamber registry, the home feed, Search,
the "+" sheet, and shell-hosting (`ChamberHost` dynamically `import()`ing
your `remote-entry.js`) all pick your Chamber up at boot.

### 5.1 The home screen: feed, "+", Search and views

Congress's home screen is a ranked "For You" feed; the owner gets around
with a tab bar (Home · Search · + · Notifications · Settings). **Your
Chamber has no navigation and no list pages of its own** — its exhibits
reach the owner three ways, all driven by what you declare:

**The feed.** Mount `mountFeedRoute` and return candidates from a pure rule
module (`src/feedRules.ts` in the scaffold):

```ts
mountFeedRoute(app, async (now) => itemFeedCandidates(await listRecentItems(20), now));
```

Each candidate is an exhibit (or one of your views, below) with a 0-100
`score`, a short `reason` ("Due in 40 min"), and — for an exhibit — a
`preview`: `title?`, `time?` (`{ label?, start, end?, allDay? }`, ISO — the
browser formats it in the owner's own zone), `fields?` (a few short facts)
and `body?` (`plainTextPreview(yourBody)`). **Feed items show their
information inline** — a candidate with no preview is just a link, and the
owner learns nothing without tapping. Only return what's genuinely time-
relevant; Congress merges every Chamber's candidates and ranks them.

**"+".** Declare what the owner can create here, and where your editor for a
new one lives:

```ts
exhibitTypes: [{ type: "item", label: "Item", createPath: "/new" }],
```

**Search** finds your exhibits through the Exhibit contract (§4) — nothing
extra to do.

**Views** are for *genuine screens* only — a map, an agenda, charts —
never a list of your exhibits (those already reach the feed and Search).
Most Chambers have none. A view has a `fullPath` (its full-screen page in
your app) and/or a feed card:

```ts
views: [{ id: "today-map", label: "Today's map", fullPath: "/", card: true }],
```

With `card: true`, export the card component from `frontend/src/remote.tsx`'s
`views` map (keyed by `id`, wrapped in your `QueryClientProvider`), built on
`congress-ui`'s `ViewCard` for loading/error/empty states. Congress draws the
frame (your icon, the label, the feed reason, an "Open" link) and resolves
the component straight out of your already-built `remote-entry.js` — no
separate build, no iframe. A view without a card never appears in the feed;
it's reached through Search and the owner's pinned row. Any links inside a
card go through `resolveChamberPath`/`useShellHosted`, same as any other
Chamber-owned link. Your index route is your main view if you have one (Map,
Calendar's Timeline) and `ChamberIndexRedirect` otherwise.

Icons work the same way: your Chamber serves its own, Congress fetches it —
**nothing about creating or icon-branding a Chamber ever means editing a
shared package or Congress itself.** Drop your own artwork at
`frontend/public/icons/mark.svg` (the scaffold already ships a placeholder
there, so this "just works" from the moment you generate the Chamber,
generic diamond and all) — a plain `<svg viewBox="0 0 256 256"
fill="currentColor">...</svg>`, the `fill="currentColor"` being what lets it
inherit the ink/dust palette and respond to hover/dark-mode like every other
mark. It's served as a static asset exactly like the existing
`icons/icon-192.png` favicon beside it — no build step required for it to
resolve locally, and no manifest field either. Congress's gateway fetches it
generically at `GET /congress/chambers/:name/icon` (see `proxyToChamberIcon`
in `services/congress/src/gateway.ts`, which proxies to whatever Chamber
`:name` resolves to in the live registry) and `congress-ui`'s `ChamberMark`/
`getChamberIcon` fetch-and-cache it at runtime, inlining the real SVG markup
so it keeps the `currentColor` behavior. A Chamber that's offline, or one
that never got around to shipping its own `mark.svg`, falls back to a
generic mark everywhere its icon would appear — never broken, just plain.

Everything else — including your MCP tools at `/mcp/<name>` (gated by
`CONGRESS_INTERNAL_TOKEN`, not a session cookie, since MCP clients are
machines) — just works once the manifest is correct and the module is in
Congress's module list.

### 5.2 Settings tab

If your Chamber has anything the owner might want to configure (an API key,
a poll interval, thresholds — anything editable via `GET`/`PUT /api/settings`
and `createSingleRowSettings`), it gets its own tab on Congress's unified
Settings page (`services/congress/frontend/src/pages/SettingsPage.tsx`)
automatically — as long as `frontend/src/remote.tsx` exports it:

```ts
export const settings: ComponentType = withQueryClient(SettingsPage);
```

wrapping your `frontend/src/pages/SettingsPage.tsx` in your own
`QueryClientProvider`, the same way a view card is. **This is not automatic just because
`SettingsPage.tsx` exists** — the scaffold generates that file for you, but
Congress's Settings hub only shows a tab for a Chamber whose remote entry
actually exports `settings`; a Chamber with nothing configurable is meant to
omit it, but for
every other Chamber, forgetting this one line is easy to do and easy to
miss, since your own Chamber's `/‹name›/settings` route still works
standalone — only the *unified* tab silently disappears, with nothing
broken or logged anywhere. Check this first if a Chamber's settings ever
seem to have "gone missing" from the hub.

### 5.3 Publishing and receiving events

If your Chamber has a background check that decides "the owner should know
about this" (a due date, an incoming webhook, anything else only your
Chamber can detect) — or that something should happen elsewhere in
response — don't invent your own alert UI, don't push a notification
directly, and don't call another Chamber's API yourself. Publish a domain
event instead, and let Congress's own log rules (Settings → Logs) and its AI (which sees
every event, and acts on items it was asked to watch) decide whether/what to do about it. This keeps the "should this even fire, and what happens" decision
editable without a code change, and means your Chamber has no idea whether
anything is listening at all.

```ts
import { createPublishEvent } from "@congress/chamber-kit";

const publishEvent = createPublishEvent({ chamber: "budget" });

await publishEvent({
  type: "budget.overspent",
  payload: { categoryId: 4, categoryName: "Groceries", url: "/c/4" },
});
```

`type` is conventionally `"<chamber>.<event>"` (e.g. `budget.overspent`) so
it's self-namespacing without a separate chamber filter downstream. Congress
never stores this or inspects `type`/`payload` — it hands it, in-process, to
Congress's own log rules and AI and to every active Chamber whose
subscriptions match (see "Receiving events" below). Publishing works the
same whether or not anything happens to be subscribed.

Optionally declare the event types you may publish in your manifest's
`events` array (`type`/`label`/`description?`):

```ts
events: [
  {
    type: "budget.overspent",
    label: "Category overspent",
    description: "A budget category's spend exceeded its monthly limit.",
  },
],
```

This is purely a declared catalog — it's what populates the trigger-event
picker on Congress's Logs settings and the AI's watched events (read live off
`GET /congress/registry`, never hardcoded to a specific chamber name), not a
subscription or a requirement to actually fire that event. Defaulted to
`[]`, so most Chambers never touch this field at all.

**Receiving events** is two optional fields on your module:

```ts
// module.ts
export default defineChamber({
  // ...manifest, app, registerTools, dir, initEnv, start, stop...
  subscriptions: () => [{ type: "budget.overspent" }],
  onEvent: async (event) => {
    if (event.type !== "budget.overspent") return;
    // ...react to event.payload...
  },
});
```

`subscriptions()` is read fresh on every publish, so it can reflect
owner-editable state and changes take effect immediately. `type: "*"`
subscribes to every event type. Congress's filter is only a coarse gate; do
your own precise matching inside `onEvent`. A throwing handler is logged and
never affects the publisher or other subscribers. A Chamber that never
reacts to events omits both.

### 5.4 Being called through MCP

Any MCP tool your Chamber registers via `registerTools` (§4) is automatically
callable by Congress's AI (and any MCP client, with the internal token) at
`/mcp/<name>` — there's nothing to opt into or declare separately. A clear `description`
and per-property `description`s in your `inputSchema` are what the agent
sees when deciding how to use your tools, so they're worth the same care
as your REST API's own request validation.

## 6. Local dev workflow

```
pnpm --filter congress dev:server           # Congress + every Chamber, tsx watch mode
pnpm --filter chamber-<name> dev:web        # your frontend, Vite dev server
pnpm --filter chamber-<name> typecheck      # tsc --noEmit, server + frontend
pnpm typecheck && pnpm test                 # the whole repo - run before committing
```

Your Chamber's config comes from its own `services/chamber-<name>/.env`. The
dev frontend proxies `/api`, `/auth` and `/congress` to Congress's dev port
(`3000`) — see `CONGRESS_PROXY_TARGET` at the top of
`frontend/vite.config.ts`. A new feature ships with tests in the same change
(see CLAUDE.md).

## 7. Shipping to production

Your frontend needs its normal build plus the shell-hosting artifact:

```
pnpm --filter chamber-<name> build:web      # normal production build
pnpm --filter chamber-<name> build:remote   # shell-hosting artifact, run after build:web
```

`infra/deploy/build-artifacts.sh` (run by the GitHub Actions deploy on every
push to `main`) already discovers and builds every `services/chamber-*/`
directory, and the deploy restarts `congress-core`, which loads your module.
The only manual step, one time: if your Chamber needs config, create
`services/chamber-<name>/.env` on the server (untracked) from its
`.env.example`. See `infra/README.md`.

## 8. Self-hosting the whole system from scratch

If you're setting up Congress on a brand-new server rather than adding one
more Chamber to an existing deployment, `infra/README.md` is the source of
truth — it covers the full VPS layout, the systemd/Caddy setup, the
push-based GitHub Actions → rsync deploy mechanism, and the master-password
access-control model (public HTTPS + a signed session cookie, not
Tailscale/network-level access — see that doc for why). Its "First-time
server bootstrap" section is a literal, copy-pasteable script.

The short version: one VPS, one `systemd` unit (`congress-core`, bound to
`127.0.0.1`) running Congress and every Chamber in one process, Caddy as the
only public listener, and a GitHub Actions workflow that builds, rsyncs and
restarts it. There's no separate "deploy" step — pushing to `main` *is* the
deploy.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| New Chamber never appears in Search, the "+" sheet or the home feed | It isn't in `services/congress/src/chambers/modules.ts`, or it failed to start — check Congress's log for `[<name>] failed to start`. |
| Chamber shows as `offline` in the registry | Its config (`.env`) failed validation or its `start()` threw at boot. Fix it and restart Congress. |
| `chamber_offline` 503 from Congress's gateway | The Chamber is offline (above) or the owner detached it. |
| Exhibit chips render as a generic diamond icon everywhere | That Chamber hasn't shipped `frontend/public/icons/mark.svg` yet, is offline, or the fetch to `/congress/chambers/<name>/icon` failed — see §5. Not a bug, just unbranded. |
| 404s or empty responses only in production, not dev | Almost always a chamber-name-string mismatch somewhere production-only touches — `resolveApiBase("<name>")` in `frontend/src/lib/api.ts`, `name` in `src/manifest.ts`, the Vite `base: "/<name>/"` in both `vite.config.ts` and `vite.remote.config.ts`, or `ownChamber`/`ChamberMark name=` in `Layout.tsx`. The scaffold generator keeps these in sync automatically; if you're hand-editing an existing Chamber's name after the fact, grep for the old name across `src/`, `frontend/src/`, and `infra/`. |
