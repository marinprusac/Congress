# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Congress is a personal, self-hosted productivity system for a single user, deployed at `congress.marinprusac.com`. It's a monorepo of **genuinely independent services** — not a single app with logical modules. The full design intent is in `docs/congress-project-brief.md`; read it for the "why" behind anything that looks unusual. Note that one thing has changed since that brief was written: the brief specifies Tailscale-only private access, but the deployed system now uses public access gated by a master-password session cookie instead (see `infra/README.md`, "Access control"). Trust `infra/README.md` over the brief on deployment/access details.

Three names are used consistently in code, folders, and package names:

- **Congress** — the whole system; not itself a running service.
- **Capitol** (`services/capitol`) — the central orchestrator: module registry, request gateway, homepage, cross-cutting settings (dark mode), global search, Exhibit Sharing. Follows the same Chamber contract as everyone else, plus these extra duties.
- **Chamber** — any individual module (`services/chamber-notes`, `services/chamber-calendar`, `services/chamber-documents`, `services/chamber-tasks`). Each is a fully separate process: own port, own SQLite file, own frontend build, own MCP server. No Chamber imports another Chamber's source, shares a database, or shares a process.

Status vocabulary stays plain in UI/code: a Chamber is `active` or `offline`, never "convened"/"adjourned" — the Congress/Capitol/Chamber theme is structural, not narrated.

## Commands

There's no root-level dev/build orchestration (no turbo/nx) — work one service at a time with `pnpm --filter <service>`, e.g. `chamber-notes`, `chamber-calendar`, `chamber-documents`, `chamber-tasks`, `capitol`.

```bash
pnpm install                                   # once, from repo root

pnpm --filter <service> dev:server             # backend, watch mode (tsx watch)
pnpm --filter <service> dev:web                # frontend, Vite dev server
pnpm --filter <service> build:web              # frontend production build -> frontend/dist
pnpm --filter <service> build:remote           # every Chamber: remote-entry.js/.css for shell-hosting, run after build:web
pnpm --filter capitol build:vendor             # Capitol only: shared React/router/query-client build the above resolves against
pnpm --filter <service> typecheck              # tsc --noEmit, server + frontend tsconfig

pnpm -r typecheck                              # typecheck every package/service — run this after any change

pnpm --filter <service> db:generate            # after editing src/db/schema.ts -> drizzle-kit generate
pnpm --filter <service> db:migrate             # apply migrations locally (also auto-applied on service boot)
```

There is no test suite and no lint config in this repo — `pnpm -r typecheck` is the only automated check, and it's expected to pass cleanly before committing.

A Chamber's frontend dev server proxies `/api`, `/manifest`, `/health`, `/mcp` to its own backend port, and exhibit search/resolve/sharing calls to Capitol's dev port (`3000`) — see the `PROXY_TARGET`/`CAPITOL_PROXY_TARGET` constants at the top of each `frontend/vite.config.ts`. In production everything is same-origin through Capitol's proxy instead (see Gateway below), which is also why each frontend build sets `base: "/<chamber-name>/"`.

## Architecture

### Repo shape

- `packages/shared-types` — zod schemas and DTOs shared across every service (manifest shape, exhibit search/resolve/content contracts, sharing types, settings types). Types and schemas only, never logic — kept small enough that a Chamber written in another language could reimplement its shape from the JSON Schema alone.
- `packages/chamber-kit` — **backend** boilerplate every service composes rather than inherits: `createDb`/`loadEnv`/`createCapitolRegistration`/`createMcpApp`/`createTableBackedExhibits`/`createPushExhibitSync`/`createSingleRowSettings`/the `mount*Routes` Hono helpers. When adding a new Chamber or a new cross-cutting backend concern, check here first for an existing factory before hand-rolling the pattern again.
- `packages/congress-ui` — **frontend** components/hooks shared across every React app: `ChamberLayout`, the Exhibit chip/picker/annotated-text system, Exhibit Sharing UI, dark mode (`useAppliedTheme`), global search, the canonical `ChamberMarks` icon set, `WidgetPreviewShell`. Source-only workspace package, consumed via `@congress/congress-ui` (components) and `@congress/congress-ui/styles.css`.
- `services/<name>/src` — backend (Hono + Drizzle + better-sqlite3).
- `services/<name>/frontend` — frontend (React + Vite + Tailwind v4 + TanStack Query), built to `frontend/dist` and served by that service's own Hono app in production.
- `infra/` — systemd unit templates, Caddy site block, the VPS sync script. See `infra/README.md` for the full deployment story.
- `scripts/create-chamber.mjs` — scaffolds a new Chamber (`pnpm create-chamber <name> "<Display Name>" <port>`) from `scripts/create-chamber/template/`. See `docs/creating-a-chamber.md` for the full guide to building your own Chamber, including what the generator gives you vs. what you write by hand, and how to ship it to production.

**Per-frontend duplication is intentional in a few specific places**, not an oversight: `Layout.tsx`, `main.tsx`, `App.tsx`, `remote.tsx`, and `WidgetPreviewPage.tsx` are deliberately small per-Chamber files (routing/nav/copy is genuinely Chamber-specific) rather than another shared abstraction — don't try to collapse these into `chamber-kit`/`congress-ui` further. Everything that *was* pure copy-paste (icons, DB/env/MCP/registration boilerplate, the exhibits/settings/route-mounting pattern) has already been factored out; if you find yourself copying a whole file between two Chambers unchanged, that's a signal something belongs in one of the shared packages instead.

### The Chamber contract

Every service — Capitol included — implements the same contract (defined in `docs/congress-project-brief.md` section 4, scaffolded by `chamber-kit`):

- `GET /manifest` — self-description (name, routes, apiBase, mcpUrl, healthUrl).
- `GET /health` — liveness, used by Capitol's heartbeat sweep.
- Home / settings / widget frontend routes.
- A REST API under `/api/*`.
- An MCP server at `/mcp` (Streamable HTTP transport, official `@modelcontextprotocol/sdk`), wrapping the same REST logic rather than touching the DB directly.

On boot, a Chamber calls `POST /capitol/register` with its manifest (retrying with backoff if Capitol isn't up yet — start order must never matter), then heartbeats `POST /capitol/heartbeat` on an interval; Capitol marks it `offline` in its registry if a heartbeat is missed past a threshold. Registration/heartbeat/exhibit-sync calls are authenticated with a shared `CONGRESS_INTERNAL_TOKEN` header (`requireInternalToken` in `services/capitol/src/auth.ts`) — this is a "stop stray local processes" gate, not real auth.

Each service owns exactly one SQLite file, opened only by its own process. Cross-Chamber data access always goes over HTTP through the owning Chamber's own API — never a shared DB, never one service importing another's Drizzle schema.

### Gateway

Capitol is the only service Caddy ever points at. Its `gateway.ts` proxies `/api/:chamber/*` (session-gated) to that Chamber's registered `apiBase`, and proxies each Chamber's frontend through at `/<chamberName>/*`. No Chamber port is reachable from outside Capitol's own process — a Chamber is only ever hit directly in dev, or by Capitol itself in production.

### Shell-hosted Chamber navigation

Capitol's frontend is a persistent shell: navigating to a Chamber, or between Chambers, never does a full page load — Capitol's `ChamberHost` (`services/capitol/frontend/src/components/ChamberHost.tsx`) dynamically `import()`s that Chamber's own build as a real ES module and mounts it directly into Capitol's existing React tree and Router, instead of the browser following a link to `/<chamberName>/*`. This layers on top of the "fully separate process" independence above, not a replacement for it — a Chamber still owns its build/port/DB/backend entirely; the only new coupling is Chamber → Capitol (each Chamber emits one extra build artifact and agrees to a few shared conventions), which is deliberately looser than Chamber ↔ Chamber independence.

- Each Chamber's `frontend/vite.remote.config.ts` (`build:remote`) builds `frontend/src/remote.tsx` — mirrors `main.tsx` minus `StrictMode`/`createRoot`/`BrowserRouter` — into `remote-entry.js`/`remote-entry.css`, with `react`/`react-dom`/`react-router-dom`/`@tanstack/react-query` left external. Additive to `build:web`'s output (same `dist/`, run after it), not a replacement — standalone/dev access is unaffected.
- Capitol's `frontend/vite.vendor.config.ts` (`build:vendor`) builds the one shared copy of those externalized packages, served at `/vendor/*.js` and wired into `index.html` via an import map — required so a dynamically-mounted Chamber shares React's live module state with the shell instead of crashing with "invalid hook call" from two separate copies of "the same" React.
- A Chamber's own components can't always tell whether they're rendered standalone (under their own `BrowserRouter basename="/<chamber>"`) or shell-hosted (nested under Capitol's basename-less Router at `/:chamber/*`) — `useShellHosted()`/`resolveChamberPath()` (`packages/congress-ui/src/ShellHostContext.tsx`) is the one signal that tells them apart, used anywhere a Chamber writes an absolute-looking path (`ChamberPicker`, `ChamberHeader`'s `titleHref`, `navigateToExhibit`'s same-Chamber branch). It's a plain `window` flag, not React Context — `congress-ui` is source-only and recompiled independently into every bundle, so a Context object created in one bundle isn't recognized by `useContext` in another.
- A registered-but-actually-unreachable Chamber (stale heartbeat, a genuine bug in that Chamber's own code) is caught by an error boundary in `ChamberHost`, not left to blank the whole shell.
- `infra/deploy/sync.sh` runs `build:vendor`/`build:remote` alongside `build:web` for every service — both artifacts have to exist for shell-hosting to work in production.

### Exhibits: the cross-Chamber reference/search system

An "Exhibit" is any addressable piece of content in any Chamber (`note-42`, `document-7`, `event-3:cal:evt123`, ...). This is the one piece of real cross-cutting product logic in the system, worth understanding before touching notes/calendar/documents content code:

- Every Chamber implements a small **content contract** (`GET /api/exhibits/search`, `POST /api/exhibits/resolve`, `GET`/`PATCH /api/exhibits/:id/content`) — see `packages/chamber-kit/src/exhibits.ts`'s `createTableBackedExhibits` for the pattern notes/documents both use (Calendar's exhibits are Google Calendar events, not a local table, so it implements the same contract by hand in `services/chamber-calendar/src/exhibits.ts` / `google/events.ts`).
- Capitol's own SQLite DB (`services/capitol/src/db/schema.ts`) keeps `exhibit_cache` and `exhibit_refs` — a cache of every known Exhibit's name/url and a reverse-reference graph, populated whenever a Chamber calls `POST /capitol/exhibits/sync` after a create/update/delete. `services/capitol/src/exhibits.ts` fans search/resolve calls out to every active Chamber in parallel.
- In note/document/event bodies, `[[exhibit:chamber:id|Label]]` tokens (`packages/congress-ui/src/token.ts`) render as clickable chips (`ExhibitChip`) via `ExhibitAnnotatedText`/`useResolvedExhibits`. Backlinks/frontlinks panels are computed live from `exhibit_refs`, not stored redundantly.

### Exhibit Sharing

A Capitol-owned feature for granting outside access (a person, or an AI agent via plain HTTP) to one Exhibit and everything it recursively references, without a Congress login:

- `services/capitol/src/shares.ts` — a `shares` table (bearer token as PK, root exhibit, max depth, permission, expiry) plus `computeShareClosure`, a live BFS over `exhibit_refs` — inheritance is dynamic, not a snapshot, so editing a shared note to reference something new makes that new Exhibit reachable immediately.
- `services/capitol/src/shareAuth.ts` — `requireShareToken`, a third auth tier alongside the owner session cookie and the internal-token header, gating everything under `/capitol/shared/:token/*`.
- The public viewer lives at `/shared/:token` (`services/capitol/frontend/src/pages/SharedViewPage.tsx`), the one route in Capitol's frontend that intentionally sits outside `LoginGate`.

### Settings & theming

Chamber-wide (not per-device) preferences use a single-row settings table — `id` always `1`, select-then-insert-or-update — via `chamber-kit`'s `createSingleRowSettings`. Capitol's dark mode setting is applied everywhere (including inside each Chamber's own frontend and the homepage's iframed widgets) through `useAppliedTheme`/`useCapitolSettings` in `congress-ui`, plus a pre-paint inline bootstrap script in every `frontend/index.html` that applies a cached `localStorage` theme value before first render to avoid a flash of the wrong theme.

### Frontend: mobile-first, always

This is a PWA used on an iPhone first (see `docs/congress-project-brief.md`) — every UI change is designed for a mobile-sized viewport first, with a `@media (min-width: 641px)` override adding desktop chrome on top, never the other way around. Concretely:

- Any new floating/positioned element (a dropdown, popover, panel) defaults to `position: fixed` anchored to the viewport, not `position: absolute` anchored to whatever small trigger button opened it — a trigger near a screen edge is a bad anchor for a panel that can be taller or wider than the space next to it on a phone. `.exhibit-picker-dropdown`/`.exhibit-ref-add-popover`/`.notification-panel` in `packages/congress-ui/src/styles.css` are the reference idiom: fixed to the viewport with `left`/`right: 0.5rem` and `bottom: calc(var(--mobile-nav-height, 0px) + 0.5rem)` by default, switched to a conventional anchored dropdown only inside the desktop media query.
- Before calling any UI change done, actually load it in a browser at a mobile viewport width (~375px) — not just skim the CSS — and check the specific thing you touched still fits and works. A change that only gets checked at desktop width has not been verified.

## Deployment

Full details in `infra/README.md`. Key points to know before pushing to `main`:

- The VPS (`178.105.180.7`) polls `origin/main` every 30s (`infra/deploy/sync.sh` via a systemd timer) and fast-forwards, reinstalls, rebuilds, and restarts automatically — **there is no separate deploy step**, pushing to `main` is the deploy.
- Production ports differ from dev defaults: Capitol `8000` (not `3000`, since that VPS runs other unrelated projects too), Notes `8011`, Calendar `8012`, Documents `8013`, Tasks `8014` — same as dev for the Chambers, different for Capitol. Don't assume Capitol is on `3000` when checking anything server-side.
- If you're running as an on-server AI (not the case in normal laptop-driven sessions), a `pre-push` hook blocks pushing to `main`/`master` directly — server-side work must go to a `server-ai/*` branch for review.
