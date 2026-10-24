# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Congress is a personal, self-hosted productivity system for a single user, deployed at `congress.marinprusac.com`. It's a monorepo with one service and a few shared packages. The full design intent is in `docs/congress-project-brief.md`; read it for the "why" behind anything that looks unusual. Note that two things have changed since that brief was written: the brief specifies Tailscale-only private access, but the deployed system now uses public access gated by a master-password session cookie instead (see `infra/README.md`, "Access control"); and the brief describes independent Chamber services with one widget each in an iframe, but the system is now one service with a ranked "For You" home feed (the AI lives in the Chats tab) and no widgets or per-source navigation — see `docs/frontend.md` and `docs/writing-a-connector.md`. Trust `infra/README.md` and this file over the brief on deployment/access and homepage details respectively.

Three names are used consistently in code, folders, and package names:

- **Congress** — both the whole system and its one service: `services/congress` is session auth, the **type engine** (runtime record types, records, search, bindings), the **connectors** (hand-written sync code: Google Calendar, Gmail, Hevy, Apple Health, Traccar, WhatsApp), Congress's own **views** (Calendar, Health, Map, WhatsApp chats), the **home screen** (the feed, pinned views, Search, "+"), the **event log/notification center** (see `docs/events-and-notifications.md`), the system's one **AI** (see `docs/ai.md`), and the PWA shell. One process (`congress-core`), and the only thing Caddy ever points at.
- **Capitol** and **Logs** no longer exist as Chambers — they were folded into Congress as core features (the home screen at `/`, the Notifications tab, event settings/history under Settings → Logs). The name "Capitol" survives only in a few legacy identifiers (`CapitolMark`, `useCapitolSettings`, `capitolSettingsSchema`). The one-time importers of the old Logs and Deputy data have run in production and are removed (see git history).
- **Chamber** — retired. Congress used to load independent modules called Chambers; Notes, Tasks, Documents, Calendar, Mail, Fitness, Map and WhatsApp all became premade types plus connectors and views (phase 7, finished 2026-10-01), and the machinery that ran them (chamber-kit, the registry, gateway dispatch, `ChamberHost`, remote builds, `create-chamber`) is gone. The name survives in identifiers (`ChamberHeader`, `ChamberMark`, `chamber` fields that now mean a record's source namespace such as `e`) and in the folder `services/chamber-whatsapp`, which holds only the Go reader daemon. To add something new: a type (builder mode or a premade), a connector, a view; see `docs/writing-a-connector.md`.

## Commands

There's no root-level dev/build orchestration (no turbo/nx); the app is one service, `congress`, plus the shared `packages/*`.

```bash
pnpm install                                   # once, from repo root

pnpm --filter congress dev:server              # backend, watch mode
pnpm --filter congress dev:web                 # frontend, Vite dev server (proxies the API to :3000)
pnpm --filter congress build:web               # frontend production build -> frontend/dist
pnpm --filter congress typecheck               # tsc --noEmit, server + frontend tsconfig

pnpm -r typecheck                              # typecheck every package/service — run this after any change
pnpm typecheck                                 # the above, plus the root tests/ directory

pnpm test                                      # vitest, whole monorepo — run this after any change
pnpm test services/congress/src/typeEngine   # any path fragment filters
pnpm test:watch                                # vitest in watch mode

pnpm --filter congress db:generate               # after editing src/db/schema.ts -> drizzle-kit generate (each connector DB has its own drizzle.<name>.config.ts)
pnpm --filter congress db:migrate                # apply migrations locally (also auto-applied on boot)
```

There is no lint config in this repo — `pnpm typecheck` and `pnpm test` are the two automated checks, and both are expected to pass cleanly before committing.

**A new feature ships with tests for it, in the same change** — not as a follow-up, and not only when asked. This matters more here than in most repos because pushing to `main` is the deploy (see Deployment below): there is no stage between a regression and production. Aim them at stateful and cross-service logic — state machines, caches, matching rules, auth wiring — rather than plain CRUD route handlers, which `strict` + `noUncheckedIndexedAccess` already protect well; the point is to cover what typecheck cannot reach, not to hit every line.

Tests are Vitest, configured once at the root (`vitest.config.mts`) rather than per service, and live beside the code they cover as `src/**/*.test.ts` (plus `tests/` at the root for cross-service checks like the migration smoke test). They run in a Node environment only — there is no jsdom setup, so frontend coverage is limited to `congress-ui`'s pure string helpers, not component rendering. Shared helpers live in `packages/test-support` (`@congress/test-support`) — a workspace package rather than a plain folder, so each service's own `typecheck` (which pins `rootDir` to its own `src/`) can still see them. A few things make this work and are worth knowing before adding a suite:

- Congress opens its SQLite handle and parses its env **at module load** (`src/db/client.ts`, `src/env.ts`). `packages/test-support/src/env.ts` is a Vitest `setupFile`, so it runs before any of that and points `DB_PATH` at a fresh temp file — one per test file, since Vitest gives each test file its own module registry. A test that needs several databases in one file resets with `vi.resetModules()` after moving `process.env.DB_PATH`.
- `runMigrations()`'s default migrations path is relative to the process cwd (the repo root under Vitest), so tests pass an absolute one via `migrationsDir(<service>)`.
- Connector tests run against fake upstreams (`gmail/fakeGmail.ts`, a unix-socket fake reader for WhatsApp, a fake Hevy) and record-source tests register in-process sources; nothing reaches a real service.
- When the logic worth testing is module-private, adding an `export` to it is fine, and pulling a cluster of it into a leaf module next to its caller (the way `geo.ts` and `annotationMatching.ts` sit beside the location connector's `tracking.ts`/`reprocess.ts`) is better still — both are established here, not a workaround.

`infra/deploy/pre-push-hook-checks` enforces both checks before a push, blocking it on failure for fast local feedback. Install it with `cp infra/deploy/pre-push-hook-checks .git/hooks/pre-push && chmod +x .git/hooks/pre-push`. The same two checks also gate the actual deploy in CI (see Deployment below) — a push that skips the local hook (`--no-verify`) still can't reach production without passing them.

The frontend dev server proxies `/api`, `/auth`, `/congress` and `/mcp` to Congress's dev port (`3000`) — see `frontend/vite.config.ts`. The built frontend is one bundle (no import map, no remote entries) served by the backend from `frontend/dist`.

## Architecture

### Repo shape

- `packages/shared-types` — zod schemas and DTOs shared across every service (manifest shape, record search/resolve contracts, settings types). Types and schemas only, never logic — kept small enough that a Chamber written in another language could reimplement its shape from the JSON Schema alone.
- `services/congress/src/kit/` — the small backend helpers the code shares: `createDb`/`createLazyDb`, `loadEnv`, `createMcpApp`/`mcpTextResult`/`callChamberTool`, `createSingleRowSettings`, wikilink parsing, `interpolate`, `plainTextPreview`/`closeness`, `scoreRecordMatch`, static serving and the Google error classes. (They lived in `packages/chamber-kit` until phase 7e.)
- `packages/congress-ui` — **frontend** components/hooks: `ChamberLayout`/`ChamberHeader` (page chrome), the Record chip/picker/annotated-text system, dark mode (`useAppliedTheme`), stack navigation (`StackLink`/`useStackNav`/`useBackNavigation`), motion, `ChamberMarks` icons. Source-only workspace package, consumed via `@congress/congress-ui` (components) and `@congress/congress-ui/styles.css`.
- `services/congress/src` — backend (Hono + Drizzle + better-sqlite3); `services/congress/frontend` — frontend (React + Vite + Tailwind v4 + TanStack Query), built to `frontend/dist`.
- `infra/` — the one systemd unit (`congress-core`), Caddy site block, the deploy scripts. See `infra/README.md` for the full deployment story.
- `docs/writing-a-connector.md` — how to add a connector, a premade type or a view.

### Server shape

Congress is the only service Caddy points at (`server.ts`): `/auth`; `/congress/*` (session-gated: settings, feed, records and types, connectors, AI, notifications; a connector's setup-panel API is `/congress/connectors/<name>/*` and its unauthenticated webhooks `/hook/*`); `/mcp`, `/mcp/types`, `/mcp/builder` and `/mcp/web` (the AI's tools, gated by the internal token `CONGRESS_INTERNAL_TOKEN`); the Health Auto Export Shortcut's old URL `/api/fitness/health/ingest`; view icons at `/congress/chambers/:name/icon` (`CORE_ICONS` in `gateway.ts`); then the SPA from `frontend/dist` (`kit/static.ts`). Any other `/api/*` is a JSON 404.

The frontend is one bundle. Views are ordinary routes in `App.tsx`, and Congress's own view cards (`views/coreViews.ts`) are real components in the same document. Old Chamber URLs (`/mail/...`, `/notes/...`) are redirects there. The service worker's shell allowlist (`sw.ts`) must list every top-level path `App.tsx` serves.


### Deeper docs

Read the one that matches the area you are touching; each holds the detailed design, invariants and gotchas for it.

| Area | Doc |
| --- | --- |
| Home feed, views, tab bar/shell, stack navigation, settings & theming | `docs/frontend.md` |
| Runtime record types: storage, operations, field kinds, files, relations, keys, triggers, records, builder mode, backups | `docs/type-engine.md` |
| Connectors, bindings, and each shipped connector (Gmail, Hevy/Health, Location, WhatsApp, Google Calendar) | `docs/connectors.md` |
| Adding a connector, premade type or view | `docs/writing-a-connector.md` |
| Record references (`[[record:e:<id>]]`), search, connections | `docs/records.md` |
| Event bus, log rules, event settings, notifications | `docs/events-and-notifications.md` |
| The AI: engine, queue, chat, asks, builder/internet mode, memory, proactive | `docs/ai.md` |
| Google sign-in/accounts, the wa-reader daemon and the never-send rule | `docs/google-and-whatsapp.md` |
| Original design intent (partly superseded, see above) | `docs/congress-project-brief.md` |

**Naming:** these are called "records" everywhere. The word "exhibit" survives only where stored data needs it: the `exhibit_cache`/`exhibit_refs` tables, the legacy `[[exhibit:e:<id>]]` token prefix (still read, never written; new tokens are `[[record:e:<id>]]`), the legacy `exhibit` ask-field type, and the `EXHIBITS_DB_PATH`/`EXHIBIT_FILES_DIR`/`exhibits.sqlite3` names that `env.ts` falls back to for an existing deployment.

Hard rules worth keeping in your head without opening a doc:

- **WhatsApp is read-only, forever.** Nothing may send or upload anything to WhatsApp, in the UI or for the AI.
- **Definitions change only through operations**; the AI changes types only via owner-granted builder mode.
- **Connectors never write type records**; they emit source changes that bindings pull in.
- **Feed items carry their information inline**; a list of records is never a view.
- **Every AI run is isolated from the machine** (MCP tools only, fixed empty cwd); keep it that way.
- People are created only from direct contact by the owner, never from guests or senders.
- Pushing to `main` is the deploy.

### Frontend: mobile-first, always

This is a PWA used on an iPhone first (see `docs/congress-project-brief.md`) — every UI change is designed for a mobile-sized viewport first, with a `@media (min-width: 641px)` override adding desktop chrome on top, never the other way around. Concretely:

- Any new floating/positioned element (a dropdown, popover, panel) defaults to `position: fixed` anchored to the viewport, not `position: absolute` anchored to whatever small trigger button opened it — a trigger near a screen edge is a bad anchor for a panel that can be taller or wider than the space next to it on a phone. `.record-picker-dropdown`/`.record-ref-add-popover`/`.notification-panel` in `packages/congress-ui/src/styles.css` are the reference idiom: fixed to the viewport with `left`/`right: 0.5rem` and `bottom: calc(var(--mobile-nav-height, 0px) + 0.5rem)` by default, switched to a conventional anchored dropdown only inside the desktop media query.
- Before calling any UI change done, actually load it in a browser at a mobile viewport width (~375px) — not just skim the CSS — and check the specific thing you touched still fits and works. A change that only gets checked at desktop width has not been verified.

## Deployment

Full details in `infra/README.md`. Key points to know before pushing to `main`:

- Deploy is push-based, driven by GitHub Actions (`.github/workflows/deploy.yml`), not a server-side poll — **there is no separate deploy step**, pushing to `main` is the deploy. CI builds and tests, then pushes the finished tree to the VPS (`178.105.180.7`) over rsync+SSH and tells it to install runtime deps and restart. The server itself never runs git or a build tool — see `infra/README.md`'s "Deploy: GitHub Actions → server" section for the full flow.
- Congress is the only process (`congress-core`), on port `8000` in production (not `3000`, since that VPS runs other unrelated projects too). The wa-reader daemon is the one other unit (`congress-wa-reader`); its config lives in `services/chamber-whatsapp/.env` on the server.
