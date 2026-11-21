# Adding to Congress: a type or a connector

Congress is one service. There are no plug-in modules: what used to be
"Chambers" are now three kinds of thing, all code (or data) in
`services/congress`. This is how to add each.

## 1. A record type (no code)

A type is a SQLite table with real columns, defined at runtime and rendered
generically (list, editor, search, feed, AI tools). Ask the AI: it creates
and changes types itself with its builder tools. Every type is data; the
built-in ones' batches in `src/typeEngine/premade/` only seed a fresh install
(`seed.ts`, then they're detached), so a change to a deployed type is an
operation the AI publishes (or a one-time boot step), never a new batch.

You get for free: `/e/<id>` pages, Search, `[[record:e:<id>|Title]]` chips,
relations, feed rules, time triggers, events (`<prefix>.created|updated|deleted`)
and MCP tools (`list_/get_/create_/update_/delete_/search_<type>`).

## 2. A connector (code)

A connector is hand-written sync code with its own cache DB, declared with
`defineConnector` (`src/connectors/contract.ts`). Look at `whatsapp/` (tiny: no
records, AI tools only), `gmail/` (same, plus a history-cursor poll that publishes events) or `hevy/` (push) as
templates.

- **Source schema**: `source: [{ kind, fields, facts }]` - what it can give a
  type. A type is bound to it by a `set_binding` op: each field is `sync`
  (pulled and pushed back), `pull` (read-only on the record) or local.
- **`sync(ctx)`** pulls into the connector's own DB and calls
  `ctx.emitChange(kind, key, deleted, quiet)`; bindings turn changes into
  record writes. `intervalMs` sets the schedule. A first backfill should be
  `quiet` (no events).
- **`read`**: `get`/`list` (the cache), and optionally `detail` (live content
  for a record page and the AI), `search` (the whole source), `fetch`
  (one item into the cache, for on-demand records), `series` (time series
  that never become records).
- **`push`**: `create`/`update`/`delete`/`act`. Omit what the source must never
  receive: the binding's `delete: "never"` and refusing in `push` are how a
  read-only source stays read-only (WhatsApp has no push at all, and a test
  asserts it).
- **People**: don't link or create them in code. Expose who's involved as an
  unmapped source value (Calendar's `attendees`) or let the AI read them
  through its tools (Gmail's `gmail_search` marks "you wrote to them") and the AI
  linker does the rest. `ctx.people.find`
  is fine for deduplication (WhatsApp skips contacts a Person already has).
- **Extras**: `routes(ctx)` (setup-panel API at `/congress/connectors/<name>/*`),
  `hooks(ctx)` (unauthenticated webhook at `.../hook/*` - check your own
  token), `events` (catalog) + `ctx.publish`, `tools(ctx, server)` (AI tools
  that aren't per-record), `feed(now)` (feed records), `onRecordChange` and
  `ctx.records.list(type)` (react to records), `googleScopes`.
- Register it in `connectors/list.ts`. Its cache DB uses `createLazyDb` and
  its own `drizzle.<name>.config.ts`.

## 3. Frontend pieces

A route goes in `App.tsx` (and its top-level path in the service worker's shell
allowlist, `sw.ts`); a source's colour comes from `CHAMBER_COLORS` in
`congress-ui/src/sourceColor.ts`, its icon from `gateway.ts`'s `CORE_ICONS`. A live renderer
for a connector's `read.detail` goes in `connectors/live/` (keyed
`connector:kind`), and its setup panel in `connectors/panels.tsx`.

## Rules that apply to all of it

- Ship tests with it (CLAUDE.md, "Commands"): fake the upstream, assert the stateful bits.
- Verify the UI at 375px.
- Nothing is ever sent to WhatsApp; Gmail is never sent or deleted from.
- Production checks are read-only.
