# Congress — Project Brief

This document is the founding spec for **Congress**, a personal, self-hosted productivity system. Read it in full before writing any code. It describes the architecture, the technology choices, the module contract, deployment, and the visual/UX direction. Where this document is silent on a detail, prefer the simplest option consistent with the principles below, and ask rather than guess if the choice would be expensive to reverse.

## 1. What Congress is

Congress is a single user's personal operating layer: task management, note-taking, workout analysis, career planning, budget tracking, and more, unified under one system with an AI layer that can read across all of it and help plan the user's time. It runs entirely on infrastructure the user owns (a VPS), is accessed from an iPhone and a Linux laptop as an installed PWA, and is never exposed to the public internet — only reachable over a private network (Tailscale).

Three names matter throughout the codebase and should be used consistently, in code, folder names, and package names:

- **Congress** — the whole system. The umbrella name; not itself a running service.
- **Capitol** — the central orchestrating module. Owns the module registry, the request gateway/forwarding layer, the homepage, and settings. Capitol is itself built to the same module contract every other module follows, plus extra orchestration powers.
- **Chamber** — any individual module (tasks, notes, budget, health, career, etc.). Each Chamber is an independently running process with its own database, its own API, its own MCP server, and its own frontend surface.

The naming theme (Congress/Capitol/Chamber) should be used moderately — enough to give the system identity, not so much that internal jargon (session, roll call, convene, etc.) leaks into UI copy or code. Keep status vocabulary plain: a Chamber is `active` or `offline`, not "convened" or "adjourned."

## 2. Core architectural principle: real modularity

This is the single most important technical property of the system: **Chambers must be genuinely independent processes**, not just logically separated code within one app. This is a hard requirement, not an aspiration, for three reasons:

1. **Fault isolation.** If one Chamber crashes, hangs, or is mid-deploy, no other Chamber and no core Capitol functionality should be affected. A crash in the budget Chamber must never take down the tasks Chamber or the homepage.
2. **Independent lifecycle.** Any Chamber must be startable, stoppable, updatable, or replaced entirely without restarting Capitol or any other Chamber. This should be true operationally (`systemctl restart chamber-tasks` affects nothing else) and architecturally (no shared in-memory state, no shared database, no import of one Chamber's code into another).
3. **Technical heterogeneity must be possible, even if unused in practice.** A Chamber is defined by a network contract (HTTP API + a manifest + optionally an MCP server), not by a shared runtime. It must be technically possible for one Chamber to be written in a completely different language or framework than the others — e.g. a future Chamber written in Python with a Postgres database, or a Go binary, should be able to register with Capitol and function identically to a TypeScript/Hono/SQLite Chamber, with zero changes to Capitol's code. In practice, every Chamber built in this project will use the standard stack described below (consistency is a choice, not a constraint) — but nothing in Capitol's implementation should assume a Chamber is written in any particular language, and no Chamber should import another Chamber's source code or share a process, a port, or a database file with anything else. The only contract between Capitol and a Chamber is over the network: HTTP for the API, and the manifest shape described in section 4.

Consequence: do not build a monorepo where Chambers are just route handlers mounted into one big server process. Build Capitol and every Chamber as **separate deployable services**, each with its own entry point, its own port, its own `package.json` (or equivalent), and its own database file. A shared `packages/` workspace for common types/utilities is fine and encouraged (see section 6), but it must be a library that gets imported, never a shared runtime the services execute inside of.

## 3. Technology stack

Chosen deliberately for a single-developer, single-user, low-traffic personal system. Use these unless a specific Chamber's requirements genuinely call for something else later.

- **Language:** TypeScript everywhere — backend, frontend, MCP servers. One language across the whole system minimizes context-switching for a solo builder.
- **Backend framework:** [Hono](https://hono.dev/) for every service (Capitol and every Chamber). Lightweight, fast, first-class TypeScript, works equally well for a tiny Chamber API and Capitol's gateway logic.
- **Database:** SQLite, one file per service, no exceptions. Use [`better-sqlite3`](https://github.com/WiskiCzevu/better-sqlite3) as the driver and [Drizzle ORM](https://orm.drizzle.team/) for schema and queries — Drizzle is TypeScript-first, lightweight, and its migration story fits a per-service SQLite file well. No Postgres, no shared database server, no Docker required for the DB layer.
- **Frontend:** React, built with **Vite** (not Next.js — this is a client-side PWA hitting our own APIs, not a server-rendered site, so Vite's simpler build model is the better fit). Use `vite-plugin-pwa` to generate the web app manifest and service worker.
- **Frontend data fetching:** TanStack Query, so that a Chamber being offline degrades gracefully (retries, stale-while-revalidate, clear loading/error states) rather than crashing a page.
- **UI components:** Tailwind CSS + shadcn/ui as a base, then themed per the design direction in section 7 — do not ship shadcn's default look unstyled.
- **MCP servers:** the official `@modelcontextprotocol/sdk` (TypeScript) with `zod` for argument schemas. Every Chamber that exposes AI-relevant data or actions runs its own MCP server as a small persistent HTTP service (Streamable HTTP transport), not a stdio-spawned process, since Chambers are already long-running services.
- **Process management:** `systemd`, one unit file per service (Capitol + each Chamber). No Docker, no container orchestration — this is a single VPS running a fixed, small set of long-lived Node processes, and systemd is sufficient and simpler.
- **Reverse proxy / TLS:** Caddy, but with a deliberately minimal job — see section 5. All path-based routing between Chambers happens inside Capitol's own code, not in Caddy config.

## 4. The Chamber contract

Every Chamber (including Capitol, which follows this same contract in addition to its orchestration role) must expose:

1. **A manifest**, served at a well-known path (e.g. `GET /manifest`), describing itself:
   ```json
   {
     "name": "tasks",
     "displayName": "Tasks",
     "version": "1.0.0",
     "routes": {
       "home": "/tasks",
       "settings": "/tasks/settings",
       "widget": "/tasks/widget"
     },
     "apiBase": "http://localhost:8010/api",
     "mcpUrl": "http://localhost:8010/mcp",
     "healthUrl": "http://localhost:8010/health"
   }
   ```
2. **A homepage route** — the Chamber's full page view.
3. **A settings route** — the Chamber's own configuration UI, independent of Capitol's settings.
4. **A widget route/endpoint** — a compact summary view/data payload Capitol's homepage can render inline (e.g. "3 tasks due today"). Widgets should degrade to a simple empty/error state if the Chamber has no data yet, never throw.
5. **A REST API** under its own `apiBase`, doing the actual CRUD/business logic for that Chamber's domain.
6. **A health endpoint** (`GET /health`) returning quickly with basic liveness info, used by Capitol's heartbeat/health-check mechanism.
7. **Optionally, an MCP server** exposing tools for the AI layer, wrapping the same REST API rather than touching the database directly, so validation and business logic live in one place.

**Registration:** on startup, a Chamber calls `POST` to Capitol's `/capitol/register` with its manifest. On graceful shutdown, it calls `/capitol/deregister`. If Capitol is not yet reachable, the Chamber retries registration on a backoff — start order between Capitol and Chambers must never matter. Registration/heartbeat requests are authenticated with a shared secret (an env var, e.g. `CONGRESS_INTERNAL_TOKEN`, identical across all services) passed as a header — this is not meant to be strong auth, just enough to stop a stray local process from registering itself, since everything is already confined to localhost/Tailscale.

**Heartbeat:** each Chamber pings `POST /capitol/heartbeat` on an interval (e.g. every 30s). If Capitol misses a Chamber's heartbeat for longer than a threshold, it marks that Chamber `offline` in its registry, independent of whether a clean deregister happened (covers crashes).

**Database isolation:** a Chamber's SQLite file lives in its own service directory and is opened by nothing but that Chamber's own process. No other service, including Capitol, ever opens another service's database file directly. All cross-Chamber data access happens over HTTP, through the Chamber's own API.

## 5. Capitol's extra responsibilities

Capitol is a Chamber (it has its own manifest, home, settings, widget-less homepage, DB, and MCP server for meta-tools like `list_chambers`/`get_chamber_status`) plus these orchestration duties:

- **Module registry** — a table in Capitol's own SQLite DB: `chambers(name, display_name, version, routes_json, api_base, mcp_url, health_url, status, last_heartbeat_at, registered_at)`.
- **Request gateway** — Capitol is the *only* service Caddy forwards to. Caddy's entire config is effectively one reverse-proxy block pointing at Capitol's port; Caddy does no path-based routing. Capitol itself implements a path-based forwarder, e.g. `ALL /api/:chamber/*`, that looks up the Chamber in its registry and proxies the request to that Chamber's `apiBase`, returning a clean `503` with a clear body if the Chamber is missing or `offline`. This means: no Chamber port is ever reachable from outside the VPS's internal network; only Capitol's port is fronted by Caddy.
- **Homepage composition** — Capitol's homepage fetches each active Chamber's widget data (via the same internal forwarding) and renders them together. A Chamber that's offline should render a clearly visible "offline" state in its widget slot, never be silently omitted — this system should never let a problem go unnoticed by hiding it.
- **MCP aggregation** — Capitol can optionally forward MCP traffic the same way it forwards REST traffic (`/mcp/:chamber` → the Chamber's `mcpUrl`), so external MCP clients (Claude Code) only need to know about Capitol, not individual Chamber ports. This is not strictly required (Claude Code can also be configured to hit each Chamber's MCP URL directly on localhost), but is the cleaner long-term shape and matches "everything through Capitol."

## 6. Repository shape

Use a monorepo for developer convenience, but remember from section 2 that this is a *build-time* convenience, not a runtime coupling — nothing here should result in Chambers sharing a process.

```
congress/
  packages/
    shared-types/       # manifest shape, common DTOs, zod schemas shared across services
  services/
    capitol/
      src/
        server.ts        # Hono app: registry, gateway, homepage API
        registry.ts
        gateway.ts
        db/               # Drizzle schema + SQLite file for Capitol only
        mcp/              # Capitol's own MCP server (meta-tools)
      frontend/            # Vite + React app for Capitol's own pages
      package.json
    chamber-tasks/          # placeholder / first real Chamber, details TBD later
      src/
      frontend/
      package.json
  infra/
    systemd/                # one .service unit file per service
    caddy/
      Caddyfile             # single reverse_proxy block to Capitol
  docs/
    congress-project-brief.md   # this document
```

Each service directory is independently `npm install`-able and independently deployable. `packages/shared-types` should contain only types/schemas (e.g. the manifest zod schema), never logic, and should be small enough that a Chamber written in a different language later could reimplement its shape from the JSON Schema alone rather than needing the TypeScript package.

## 7. Deployment and access

- **Host:** a single Hetzner VPS the user already owns and administers (previously used for Obsidian WebDAV sync, now being repurposed). Ubuntu LTS, already has SSH hardening and Caddy installed.
- **Process model:** each service (Capitol, each Chamber) runs as its own `systemd` unit, binding to `127.0.0.1:<port>` only — never `0.0.0.0`. Assign each Chamber a fixed local port during development (e.g. Capitol `3000`, tasks `8010`, notes `8011`, ...) and record it in that Chamber's manifest and systemd unit.
- **No Docker.** Plain Node processes managed by systemd. This is a deliberate simplicity choice for a single-user system — revisit only if a specific future Chamber genuinely needs dependency isolation Node/systemd can't provide.
- **Network access:** the VPS is reachable only via **Tailscale** (or WireGuard) — no public HTTPS listener exposed to the open internet. The iPhone and Linux laptop both join the same Tailscale network; Caddy serves Capitol only to that private network. There is no public login page and no app-level authentication system to build — network membership is the access control.
- **TLS:** Caddy still handles HTTPS termination (required for PWA installability and service workers), using either Tailscale's own TLS certs for its MagicDNS name, or Caddy's automatic HTTPS against an internal domain — confirm current best practice for HTTPS-over-Tailscale at build time, since this detail is easy to get subtly wrong.
- **Client installation:** on iPhone, open the Tailscale-reachable URL in Safari and use "Add to Home Screen." On the Linux laptop, use Chrome/Chromium's "Install app." Both then behave as installed apps, including offline shell caching and (once implemented) Web Push notifications — iOS requires the PWA to already be installed to Home Screen before push will work.
- **Backups:** each service's SQLite file should be backed up independently (e.g. periodic `cp` to a backup directory, or [Litestream](https://litestream.io/) for continuous replication) — there is no central database to back up, so backups must be enumerated per Chamber.

## 8. UI/UX and visual direction

The design should read as **elegant, professional, ambitious, productive, and sharp** — closer to institutional/legislative print material (letterhead, ledgers, engraved seals) than to a typical soft SaaS dashboard. Avoid rounded, friendly, gradient-heavy design entirely. The Congress/Capitol/Chamber naming should be reflected moderately — present in structure and a few visual choices, not narrated everywhere in copy.

**Color** — neutral, warm-stone palette with a single restrained accent, not gray-on-white and not a bright SaaS blue:
- `#F7F6F3` — background ("parchment")
- `#1C1C1A` — primary text ("ink")
- `#3A3936` — secondary text / structural lines ("slate")
- `#8B8880` — muted text, borders, disabled state ("dust")
- `#2B4A3E` — the single accent color, used sparingly (primary actions, active states)
- `#A6231F` — reserved for alerts/errors only, never decorative

**Typography:**
- Display/headers: a serif with real presence (e.g. Fraunces or Source Serif 4), used restrained — Chamber names, page titles, not body copy.
- Body: a sharp, clean sans (e.g. IBM Plex Sans) — avoid soft/rounded geometric sans faces.
- Data/utility (IDs, timestamps, code, manifests): a monospace face (e.g. IBM Plex Mono) — reinforces that this is a real system with a ledger of state, not just a pretty UI.

**Layout conventions:**
- Sharp corners — max `2px` border-radius anywhere, no pill shapes, no soft cards.
- Hairline rules (1px, dust-colored) as the primary structural device between sections, instead of drop shadows or heavy card boundaries.
- Chambers listed with a short docket-style label carrying real information, e.g. `CH.01 — TASKS`, rather than icon tiles — the numbering should map to actual registration order or a stable ID, not be decorative.
- Status is always shown plainly (`active` / `offline`) next to a Chamber, never hidden — an offline Chamber should be visibly, unmissably marked as such on the homepage, consistent with the system's general philosophy of never quietly hiding a problem.

**Signature element:** Capitol's homepage opens with a plain **status overview** of all registered Chambers — name, docket label, status, last-heartbeat timestamp in monospace — functioning as both the literal module registry and the visual centerpiece of the homepage. This should feel like a well-kept ledger, not a marketing dashboard: dense, precise, quietly confident, no decorative empty space or illustration filling it out.

Respect standard quality floor throughout: responsive down to mobile (this is a PWA used on an iPhone first), visible keyboard focus states, and `prefers-reduced-motion` respected for any animation.

## 9. Suggested build order

1. `packages/shared-types` — manifest zod schema, common DTOs.
2. Capitol: registry table + register/deregister/heartbeat endpoints, gateway forwarder, minimal homepage that lists registered Chambers (even with zero Chambers registered, this should render cleanly).
3. One real Chamber (tasks is the natural first pick — simplest domain, most immediately useful) built to the full contract: manifest, API, DB, frontend (home/settings/widget), MCP server. This proves the whole pattern end-to-end.
4. Verify the full loop: Chamber registers with Capitol on boot, Capitol's homepage renders its widget, Capitol forwards API calls to it, Claude Code can call its MCP tools, killing the Chamber process causes Capitol to mark it offline within one missed heartbeat and show that clearly on the homepage.
5. Second Chamber (notes is a good second pick) to confirm the pattern generalizes without any changes to Capitol's code.
6. Only after two Chambers work cleanly, proceed to systemd unit files, Caddy config, and Tailscale-gated deployment onto the VPS.

Do not build a third or fourth Chamber, the AI/scheduling layer, or any external integrations (Gmail, gym API, banking, WhatsApp, Health export) until steps 1–5 are solid — those are explicitly out of scope for this initial build and will be specified separately per Chamber when their turn comes.
