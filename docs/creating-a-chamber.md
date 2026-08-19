# Creating a Chamber

This is the practical guide to building your own Chamber — a new, fully
independent module (own process, own port, own SQLite file, own frontend
build, own MCP server) that plugs into Congress. For the *why* behind this
architecture (why Chambers are genuinely separate processes rather than
modules in one app, why Exhibits work the way they do, the full design
intent), read `docs/congress-project-brief.md` first — this doc assumes
that context and focuses on the *how*.

If you just want to start: skip to [Quickstart](#quickstart).

## 1. What a Chamber is

Every Chamber — Capitol included — implements the same small contract:

- `GET /manifest` — self-description (name, routes, apiBase, mcpUrl, healthUrl, widgets).
- `GET /health` — liveness.
- Home / settings frontend routes, plus one or more homepage widgets.
- A REST API under `/api/*`.
- An MCP server at `/mcp`.

On boot, a Chamber `POST`s its manifest to `/congress/register` (retrying
with backoff so start order never matters), then heartbeats on an interval.
Congress marks it `offline` if a heartbeat is missed. That's the entire
handshake — there is no second step where you register a Chamber with
Congress by editing Congress's own code. See §5 for exactly what that buys
you for free.

Two packages exist specifically so you almost never write this contract by
hand:

- **`@congress/chamber-kit`** — backend factories: DB setup, env loading,
  the registration/heartbeat/shutdown lifecycle, MCP transport, the Exhibit
  content contract, settings, manual references, wikilink parsing.
- **`@congress/congress-ui`** — the shared frontend surface: page layout,
  Exhibit chips/picker/annotated text, dark mode, global
  search, the Chamber icon set, list/form primitives.

A handful of frontend files (`Layout.tsx`, `main.tsx`, `App.tsx`,
`remote.tsx`, `frontend/src/widgets/*.tsx`) are *deliberately* kept as small,
per-Chamber files rather than further abstracted — routing, nav copy, and
widget content are genuinely Chamber-specific. Everything that was ever
pure copy-paste boilerplate (icons, DB/env/MCP/registration wiring, the
exhibits/settings/route-mounting pattern) has already been factored into
the two packages above.

## 2. Quickstart

```
pnpm create-chamber <name> "<Display Name>" <port>
# e.g.
pnpm create-chamber budget "Budget" 8015
pnpm install
```

This generates `services/chamber-budget/` — a complete, working Chamber
with a generic single-entity example ("Items": a name + a body, searchable,
cross-referenceable via `[[...]]`, with list/view/new/settings pages and one
example homepage widget), its own placeholder icon
(`frontend/public/icons/mark.svg`, ready to swap for real artwork whenever
you like — see §5) — plus `infra/systemd/congress-chamber-budget.service`
for later production rollout. It also seeds `services/chamber-budget/.env`
from `.env.example` (untracked, like every other Chamber's `.env`) and
prints a checklist of what to edit next.

The generator validates your chosen name (lowercase kebab-case) and port
against every existing service's `package.json` and `.env.example`, so a
collision fails immediately instead of silently colliding with a running
Chamber later.

Bring it up locally:

```
pnpm --filter chamber-budget dev:server   # backend, watch mode
pnpm --filter chamber-budget dev:web      # frontend, separate terminal
```

Visit `http://localhost:8015` — the generated Chamber runs standalone.
Registration with Congress happens automatically on backend boot as long as
Congress itself is running (`pnpm dev:congress` from repo root) — see §5.

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
| `frontend/src/widgets/*.tsx` + `frontend/src/widgets/index.ts` | Your homepage widget(s) for Capitol's canvas — see §5.1. Add a new file + a `widgets` map entry per widget; each one needs a matching entry in `src/manifest.ts`'s `widgets` array (`id`/`width`/`height`/`label`). |
| `frontend/src/components/Layout.tsx` | Nav links specific to your Chamber. |
| `frontend/public/icons/mark.svg` | Optional — swap the placeholder diamond for real artwork whenever you like. Not required for anything else to work; see §5. |

After any `db/schema.ts` change: `pnpm --filter chamber-<name> db:generate`
(drizzle-kit generates the migration; it's applied automatically on next
boot, or manually via `db:migrate`).

`chamber-kit`'s factories cover everything else — you compose them, you
don't reimplement them:

| Factory | What it gives you |
|---|---|
| `createDb(dbPath, schema)` | better-sqlite3 + WAL + drizzle, migrations wired up. |
| `loadEnv(schema)` | zod-validated env loading; extend `chamberEnvSchema` with your own `PORT`/`DB_PATH` defaults. |
| `createChamberBootstrap({...})` | The entire boot sequence — migrate, listen, register + heartbeat with Congress, clean shutdown on SIGINT/SIGTERM. Your `src/index.ts` is ~7 lines that call this once. |
| `createMcpApp(name, registerTools, internalToken)` | The full MCP transport/session/error plumbing, plus gating `/mcp` behind the same shared-secret header used for register/heartbeat/events - you only write `server.registerTool(...)` calls. |
| `fetchRegistry(capitolUrl, internalToken)` | Server-side counterpart to congress-ui's own `fetchRegistry` - resolves another Chamber's `apiBase`/`mcpUrl` out of the live registry, e.g. before calling one of its tools. |
| `listChamberTools(mcpUrl, internalToken)` / `callChamberTool(mcpUrl, internalToken, name, args)` | A short-lived MCP *client* against another Chamber's own `mcpUrl` - `tools/list`/`tools/call`, gated the same way. What Automation Chamber's automations use to actually do something, see §5.3. |
| `createTableBackedExhibits(config)` | Implements the whole Exhibit content contract (search/resolve) for a table-backed entity from a handful of callbacks. |
| `createPushExhibitSync(opts)` | Fire-and-forget `POST /congress/exhibits/sync` after create/update/delete. |
| `createPublishEvent(opts)` | Fire-and-forget `POST /congress/events/publish` for a domain event another Chamber's rules or automations might react to - see §5.2. |
| `mountEventReceiveRoute(app, internalToken, onEvent)` | Mounts `POST /api/events/receive`, the push counterpart to `createPublishEvent` - Congress calls this directly the moment a publish matches your own declared subscriptions, instead of you polling for it. See §5.2. |
| `createSingleRowSettings(config)` | The "id is always 1, select-then-upsert" settings pattern every Chamber uses. |
| `createManualRefs`/`createManualRefsByExhibitId` | CRUD for the "Connections" side-panel's manually-added refs, separate from wikilinks parsed out of body text. |
| `extractOutgoingExhibitRefs(text)` | Parses `[[...]]` tokens out of body text into an exhibit-id list. |
| `mountManifestAndHealth`, `mountExhibitSearchRoutes`, `mountSettingsRoutes`, `mountManualRefsRoutes`, `mountStaticFrontend` | One-line Hono route mounting for each of the above. Mount `mountStaticFrontend` last — it's the SPA fallback; it also serves `frontend/public/*` directly (falling through from `frontend/dist`) so assets like your icon resolve even before `build:web` has run. |

And `congress-ui`'s frontend surface:

| Export | What it's for |
|---|---|
| `ChamberLayout`, `ChamberHeader`, `ChamberMark`, `getChamberIcon` | Page shell + the Chamber icon system (see §5 for the fallback behavior). |
| `useAppliedTheme` | Applies Congress's dark-mode setting; call once in `App()`. |
| `useShellHosted`, `resolveChamberPath`, `navigateToExhibit` | Tell whether you're rendered standalone or shell-hosted inside Congress, and build correct links either way — use these instead of hand-writing absolute paths. |
| `ExhibitTextarea`, `ExhibitAnnotatedText`, `ExhibitChip`, `ExhibitMarkdown` | The `[[` picker/autocomplete, rendering body text with resolved exhibit chips, and (optionally) Markdown rendering. |
| `ExhibitActionBar`, `ExhibitLinksLayout` | Detail-page chrome: edit/delete actions, undirected Connections panel. |
| `useSearchableList`, `useListRowPrefetch`, `ListSearchInput`, `ListLoadingState`, `ListErrorState`, `ListEmptyState` | List-page search + loading/error/empty states + hover-prefetch. |
| `PageHeader`, `FormLabel`, `FormTextInput`, `FormErrorMessage`, `FormSubmitButton` | Generic page/form chrome. |
| `WidgetPreviewShell` | Shared chrome (label, "+ New" link, loading/error/empty states) for a homepage widget's own content — see §5.1. |
| `createQueryClient`, `resolveApiBase`, `parseJsonResponse`, `assertDeleteOk`, `confirmDelete` | Per-Chamber isolated TanStack Query client, dev/prod API base resolution, fetch helpers. |

## 4. The Exhibit contract (cross-Chamber search & linking)

If your Chamber's content is worth referencing from notes, other Chambers,
or the global search bar, wire `createTableBackedExhibits` (§3) — the
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

This is automatic. `gateway.ts`'s `/api/:chamber/*` and `/<chamberName>/*`
proxying, the chamber registry, Capitol's homepage canvas, the nav picker,
and Congress's shell-hosting (`ChamberHost` dynamically `import()`ing your
Chamber's `remote-entry.js`) are all driven by the `/congress/registry` API
— they pick up a new Chamber the moment it successfully registers and
heartbeats. **There is no Congress-side code to edit** to make a new Chamber
appear.

### 5.1 Homepage widgets

Capitol's homepage is a cell-based canvas the owner can edit to place and
move widgets (see `services/chamber-capitol/frontend/src/components/
Canvas.tsx`). A Chamber can register any number of widgets, each with a
fixed footprint in canvas cells declared in `src/manifest.ts`:

```ts
widgets: [{ id: "recent", width: 2, height: 2, label: "Recent" }],
```

`id` is a stable, never-shown identifier — it's the key into
`frontend/src/widgets/index.ts`'s `widgets` map, and part of how Capitol
stores this widget's canvas position. `width`/`height` are fixed by you, not
user-resizable; the owner can only place and move whole widgets on the
canvas, never resize them. `label` is what the owner sees in the edit-mode
overlay and the "add widget" tray — the *only* place a widget's identity is
ever shown, since the canvas itself draws no per-widget header (see below).

A widget's content is an ordinary React component — `frontend/src/widgets/
RecentItemsWidget.tsx` in the scaffold — exported from `frontend/src/
widgets/index.ts` and re-exported (wrapped in this Chamber's own
`QueryClientProvider`) from `frontend/src/remote.tsx`. Capitol's canvas
resolves it directly out of your already-built `remote-entry.js` (the same
artifact `build:remote` produces for full shell-hosted navigation — no
separate build step, no URL, no iframe) via `loadRemoteModule` from
`@congress/congress-ui`. Wrap your widget's content in `WidgetPreviewShell`
for the standard label/"+ New"/loading/empty chrome, but beyond that its
content is entirely your own discretion — Capitol only ever draws a plain
border around it, never a chamber name/icon header. Any in-widget links
should go through `resolveChamberPath`/`useShellHosted` (the widget is
mounted directly into Capitol's own React tree, not an isolated document),
same as any other Chamber-owned link.

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

Everything else — including `mcpUrl`, which is what makes your Chamber's
tools reachable at `/mcp` (gated by `CONGRESS_INTERNAL_TOKEN`, not a
session cookie, since MCP clients are machines) — just works once the
manifest is correct and the process is heartbeating.

### 5.2 Publishing and receiving events

If your Chamber has a background check that decides "the owner should know
about this" (a due date, an incoming webhook, anything else only your
Chamber can detect) — or that something should happen elsewhere in
response — don't invent your own alert UI, don't push a notification
directly, and don't call another Chamber's API yourself. Publish a domain
event instead, and let Logs Chamber's own rules and Automation Chamber's
own automations (both Exhibits the owner edits) decide whether/what to do
about it. This keeps the "should this even fire, and what happens" decision
editable without a code change, and means your Chamber has no idea whether
anything is listening at all.

```ts
import { createPublishEvent } from "@congress/chamber-kit";

const publishEvent = createPublishEvent({
  chamber: "budget",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

await publishEvent({
  type: "budget.overspent",
  payload: { categoryId: 4, categoryName: "Groceries", url: "/c/4" },
});
```

`type` is conventionally `"<chamber>.<event>"` (e.g. `budget.overspent`) so
it's self-namespacing without a separate chamber filter downstream. Congress
never stores this or inspects `type`/`payload` — `POST
/congress/events/publish` immediately push-relays it to every currently-
active Chamber whose own declared subscriptions match (see "Receiving
events" below), retrying a briefly-unreachable one with increasing delays
rather than storing anything durably. Publishing works the same whether or
not anything happens to be subscribed, or even registered. If `payload`
includes a `priority` field, set it to one of `PRIORITY_LEVELS`
(`shared-types`: `"low" | "normal" | "high" | "urgent"`) - a convention,
not enforced - so a receiving Chamber's own rules and priority-filtered
widgets can tell an urgent firing from a routine one; anything else
defaults to `"normal"`.

Optionally declare the event types you may publish in your manifest's
`events` array (mirrors `widgets`, but keyed by `type`/`label`/
`description?` rather than `id`/`width`/`height`/`label`):

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
picker on Logs Chamber's and Automation Chamber's own editors (read live off
`GET /congress/registry`, never hardcoded to a specific chamber name), not a
subscription or a requirement to actually fire that event. Defaulted to
`[]` like `widgets`, so most Chambers never touch this field at all.

**Receiving events** is symmetric, and just as generic — every Chamber gets
it via `chamber-kit`, whether or not it ever ends up used. There are two
halves: a fixed-convention route that Congress pushes to, and a dynamic
subscription list carried on your existing heartbeat that tells Congress
what you actually want pushed.

```ts
// server.ts
import { mountEventReceiveRoute } from "@congress/chamber-kit";

mountEventReceiveRoute(app, env.CONGRESS_INTERNAL_TOKEN, async (event) => {
  if (event.type !== "budget.overspent") return;
  // ...react to event.payload...
});
```

```ts
// index.ts
const { heartbeatNow } = createChamberBootstrap({
  // ...displayName, manifest, app, env, runMigrations, closeDb...
  getSubscriptions: () => [{ type: "budget.overspent", minPriority: "high" }],
});
```

`getSubscriptions` is read fresh on every heartbeat (not baked into the
static manifest), so it can — and for Logs/Automation Chamber, does —
reflect owner-editable state: recompute it from whatever rules/automations
currently reference a trigger type, aggregating to one entry per type using
the *loosest* `minPriority` among them if several rules watch the same type
at different thresholds (see `chamber-logs/src/subscriptions.ts` for the
worked pattern). `type: "*"` subscribes to every event type regardless of
what it's called — used by a Chamber whose own logic doesn't filter by type
at all (Deputy Chamber). Congress's own filter is only ever a coarse "could
this possibly interest this Chamber" gate; do your own precise per-rule
matching (exact `minPriority`, condition fields, whatever else you need)
inside `onEvent` after receiving, same as before this system moved off
polling. If a rule/automation mutation changes what `getSubscriptions()`
would now return, call the returned `heartbeatNow()` right after the
mutation so Congress's copy updates immediately instead of waiting up to
`HEARTBEAT_INTERVAL_MS` for the next scheduled beat.

A Chamber that never expects to react to another Chamber's events omits
`getSubscriptions` and `mountEventReceiveRoute` entirely — there's nothing
to opt into structurally, and Congress simply never has anything to push to
it.

### 5.3 Being called by an automation

Any MCP tool your Chamber registers via `registerTools` (§4) is automatically
callable by an Automation Chamber automation — there's nothing to opt into
or declare separately, since Automation Chamber just resolves your
`mcpUrl` off the registry and calls whatever `tools/list` returns. Write
your tools the same way regardless of who's calling them (a human via
Claude Code, or an automation reacting to an event): a clear `description`
and per-property `description`s in your `inputSchema` are what the owner
sees when building an automation against your Chamber in the editor, so
they're worth the same care as your REST API's own request validation.

## 6. Local dev workflow

```
pnpm --filter chamber-<name> dev:server     # backend, tsx watch mode
pnpm --filter chamber-<name> dev:web        # frontend, Vite dev server
pnpm --filter chamber-<name> typecheck      # tsc --noEmit, server + frontend
pnpm -r typecheck                           # the whole repo - run before committing
```

There's no test suite in this repo — `pnpm -r typecheck` is the one
automated check, and it's expected to pass cleanly. The dev frontend proxies
`/api`, `/manifest`, `/health`, `/mcp` to your Chamber's own backend port,
and exhibit search/resolve calls to Congress's dev port (`3000`) —
see the `PROXY_TARGET`/`CAPITOL_PROXY_TARGET` constants at the top of
`frontend/vite.config.ts` if you ever need to point dev at a non-default
port.

## 7. Shipping to production

Two extra build artifacts are required for shell-hosting (Congress embedding
your Chamber's frontend directly, not just proxying to it) beyond the
normal `build:web`:

```
pnpm --filter chamber-<name> build:web      # normal production build
pnpm --filter chamber-<name> build:remote   # shell-hosting artifact, run after build:web
```

`infra/deploy/sync-deploy.sh` (which the server's sync timer runs on every
push to `main`) already discovers and builds every `services/chamber-*/`
directory this way automatically — a new Chamber needs **zero edits** to
that script. What's still manual, on the server, one time per Chamber:

1. Copy the systemd unit the scaffold already generated for you
   (`infra/systemd/congress-chamber-<name>.service`) to
   `/etc/systemd/system/` and `daemon-reload`.
2. Create `services/chamber-<name>/.env` on the server (untracked) with
   production values — critically, `CAPITOL_URL=http://127.0.0.1:8000`
   (the `.env.example` default of `:3000` is the dev value).
3. `sudo systemctl enable --now congress-chamber-<name>`.

Full detail (including the passwordless-sudo requirement `sync-deploy.sh`
depends on) is in `infra/README.md`'s "Adding a new Chamber's infra"
section.

## 8. Self-hosting the whole system from scratch

If you're setting up Congress on a brand-new server rather than adding one
more Chamber to an existing deployment, `infra/README.md` is the source of
truth — it covers the full VPS layout, the systemd/Caddy setup, the
poll-based `git push` → auto-deploy sync mechanism, and the master-password
access-control model (public HTTPS + a signed session cookie, not
Tailscale/network-level access — see that doc for why). Its "First-time
server bootstrap" section is a literal, copy-pasteable script.

The short version: one VPS, one `systemd` unit per service (all bound to
`127.0.0.1`), Caddy as the only public listener (reverse-proxying to
Congress alone — no Chamber port is ever exposed), and a 30-second polling
timer that fast-forwards `origin/main`, rebuilds, and restarts affected
services. There's no separate "deploy" step — pushing to `main` *is* the
deploy.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| New Chamber never appears in the nav or on Capitol's homepage | Check its process logs for registration errors — usually a wrong `CAPITOL_URL` or mismatched `CONGRESS_INTERNAL_TOKEN` between the Chamber's `.env` and Congress's. |
| Chamber shows as `offline` in the registry | Missed heartbeats — check the process is actually still running and `HEARTBEAT_INTERVAL_MS` vs. Congress's sweep timeout haven't drifted apart. |
| `chamber_unreachable` 503 from Congress's gateway | The registered `apiBase` in the manifest doesn't actually resolve (typo, wrong port, or the Chamber crashed after registering but before deregistering). |
| Exhibit chips render as a generic diamond icon everywhere | That Chamber hasn't shipped `frontend/public/icons/mark.svg` yet, is offline, or the fetch to `/congress/chambers/<name>/icon` failed — see §5. Not a bug, just unbranded. |
| 404s or empty responses only in production, not dev | Almost always a chamber-name-string mismatch somewhere production-only touches — `resolveApiBase("<name>", ...)` in `frontend/src/lib/api.ts`, the Vite `base: "/<name>/"` in both `vite.config.ts` and `vite.remote.config.ts`, or `ownChamber`/`ChamberMark name=` in `Layout.tsx`. The scaffold generator keeps these in sync automatically; if you're hand-editing an existing Chamber's name after the fact, grep for the old name across `src/`, `frontend/src/`, and `infra/`. |
